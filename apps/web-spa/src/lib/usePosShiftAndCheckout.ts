import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { enqueueOfflineMutation, flushOfflineQueue } from './offlineQueue';
import { PosAudio } from './posAudio';
import { parseMajorToMinor, readApiError, ShacApiError, type Phase2ViewProps } from '../views/phase2-format';
import type { PosCartLine } from '../views/PosReceiptPanel';

export interface PersistedPosState {
  shiftId: string;
  registerId: string;
  cart: PosCartLine[];
}

export interface ZReportSummary {
  expectedBalancesMinor: Record<string, number>;
  actualCountedBalancesMinor?: Record<string, number>;
  discrepancyBalancesMinor: Record<string, number>;
  plainTextReport: string;
}

export interface PosCheckoutPayloadInput {
  shiftId: string;
  orderCurrency: string;
  cart: PosCartLine[];
  usdMinor: number;
  vesMinor: number;
  rateMicros: number;
  usdAccountId: string;
  vesAccountId: string;
  usdMethod: 'USD_CASH' | 'ZELLE' | 'POS_DEBIT';
  couponCode?: string;
  clientMutationId?: string;
}

const memoryPosState = new Map<string, string>();

export function savePersistedPosState(scopeKey: string, state: PersistedPosState): void {
  const raw = JSON.stringify(state);
  memoryPosState.set(scopeKey, raw);
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(`shac_pos_state:${scopeKey}`, raw);
    }
  } catch {
    // ignore storage quota errors
  }
}

export function loadPersistedPosState(scopeKey: string): PersistedPosState | null {
  try {
    const raw =
      typeof window !== 'undefined' && window.localStorage
        ? window.localStorage.getItem(`shac_pos_state:${scopeKey}`) ?? memoryPosState.get(scopeKey)
        : memoryPosState.get(scopeKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedPosState>;
    if (typeof parsed.shiftId !== 'string' || typeof parsed.registerId !== 'string' || !Array.isArray(parsed.cart)) {
      return null;
    }
    return { shiftId: parsed.shiftId, registerId: parsed.registerId, cart: parsed.cart };
  } catch {
    return null;
  }
}

export function buildPosCheckoutPayload(input: PosCheckoutPayloadInput) {
  const clientMutationId = input.clientMutationId ?? crypto.randomUUID();
  const payments: Array<{
    financialAccountId: string;
    currency: string;
    methodCode: string;
    amountMinor: number;
    exchangeRateMicros: number;
  }> = [];

  if (input.usdMinor > 0) {
    payments.push({
      financialAccountId: input.usdAccountId,
      currency: 'USD',
      methodCode: input.usdMethod,
      amountMinor: input.usdMinor,
      exchangeRateMicros: 1_000_000,
    });
  }
  if (input.vesMinor > 0) {
    payments.push({
      financialAccountId: input.vesAccountId,
      currency: 'VES',
      methodCode: 'PAGO_MOVIL',
      amountMinor: input.vesMinor,
      exchangeRateMicros: input.rateMicros,
    });
  }

  return {
    clientMutationId,
    shiftId: input.shiftId.trim(),
    orderCurrency: input.orderCurrency,
    exchangeRateMicros: input.rateMicros,
    items: input.cart.map((line) => ({
      productId: line.productId,
      qty: line.qty,
      manualDiscountBps: line.discountBps ?? 0,
    })),
    payments,
    ...(input.couponCode ? { couponCode: input.couponCode } : {}),
  };
}

interface UsePosShiftParams {
  rpc: Phase2ViewProps['rpc'];
  registerId: string;
  cashierName: string;
  shiftId: string;
  setShiftId: (id: string) => void;
  setCart: (cart: PosCartLine[]) => void;
  setUsdInput: (val: string) => void;
  setVesInput: (val: string) => void;
  setStatusMsg: (msg: string | null) => void;
  cart: PosCartLine[];
  usdInput: string;
  vesInput: string;
  rateMicros?: number;
  usdMethod?: 'USD_CASH' | 'ZELLE' | 'POS_DEBIT';
  openingUsdMinor?: number;
  openingVesMinor?: number;
}

/** Encapsulates POS shift open/close, offline-queued checkout, Z-report state, and queue sync mutations. */
export function usePosShiftAndCheckout({
  rpc,
  registerId,
  cashierName,
  shiftId,
  setShiftId,
  setCart,
  setUsdInput,
  setVesInput,
  setStatusMsg,
  cart,
  usdInput,
  vesInput,
  rateMicros = 54_750_000,
  usdMethod = 'USD_CASH',
  openingUsdMinor = 0,
  openingVesMinor = 0,
}: UsePosShiftParams) {
  const queryClient = useQueryClient();
  const [lastClosedReport, setLastClosedReport] = useState<ZReportSummary | null>(null);

  const finAccountsQuery = useQuery({
    queryKey: ['pos', 'finAccounts'],
    queryFn: async () => {
      const res = await rpc.api.finance.overview.$get();
      if (!res.ok) return { accounts: [] as Array<{ id: string; code: string; currency: string }> };
      const data = await res.json();
      return { accounts: (data.accounts ?? []) as Array<{ id: string; code: string; currency: string }> };
    },
    staleTime: 60_000,
  });

  const accounts = finAccountsQuery.data?.accounts ?? [];
  const usdAccountId = accounts.find((a) => a.currency === 'USD')?.id ?? 'acc_usd_cash';
  const vesAccountId = accounts.find((a) => a.currency === 'VES')?.id ?? 'acc_ves_pm';

  const openShiftMutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.pos.shifts.open.$post({
        json: {
          clientMutationId: crypto.randomUUID(),
          registerId: registerId.trim(),
          cashierName: cashierName.trim() || 'Cajero',
          initialBalancesMinor: { USD: openingUsdMinor, VES: openingVesMinor },
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (data) => {
      setLastClosedReport(null);
      setShiftId(data.shiftId);
      setStatusMsg(`Caja ${data.registerId} abierta`);
    },
    onError: (err) => {
      if (err instanceof ShacApiError && err.code === 'SHIFT_ALREADY_OPEN') {
        const openId = err.details?.openShiftId;
        if (typeof openId === 'string' && openId.length > 0) {
          setShiftId(openId);
          setStatusMsg(`Sesión activa recuperada en ${registerId}`);
          return;
        }
      }
      setStatusMsg(err.message);
    },
  });

  const closeShiftMutation = useMutation({
    mutationFn: async (counted: { USD: number; VES: number }) => {
      const res = await rpc.api.pos.shifts.close.$post({
        json: {
          clientMutationId: crypto.randomUUID(),
          shiftId: shiftId.trim(),
          actualCountedBalancesMinor: counted,
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (data) => {
      setLastClosedReport({
        expectedBalancesMinor: data.expectedBalancesMinor ?? {},
        actualCountedBalancesMinor: data.actualCountedBalancesMinor ?? {},
        discrepancyBalancesMinor: data.discrepancyBalancesMinor ?? {},
        plainTextReport: data.plainTextReport ?? '',
      });
      setShiftId('');
      setCart([]);
      setStatusMsg(`Caja ${registerId} cerrada con arqueo`);
    },
    onError: (err) => setStatusMsg(err.message),
  });

  const checkoutMutation = useMutation({
    mutationFn: async () => {
      const payload = buildPosCheckoutPayload({
        shiftId,
        orderCurrency: 'USD',
        cart,
        usdMinor: parseMajorToMinor(usdInput),
        vesMinor: parseMajorToMinor(vesInput),
        rateMicros,
        usdAccountId,
        vesAccountId,
        usdMethod,
      });
      try {
        const res = await rpc.api.pos.sales.checkout.$post({ json: payload });
        if (res.status >= 500) {
          await enqueueOfflineMutation({ clientMutationId: payload.clientMutationId, endpoint: '/api/pos/sales/checkout', kind: 'pos.sales.checkout', payload });
          return { queued: true as const };
        }
        if (!res.ok) throw await readApiError(res);
        return { queued: false as const, sale: await res.json() };
      } catch (err) {
        if (err instanceof TypeError) {
          await enqueueOfflineMutation({ clientMutationId: payload.clientMutationId, endpoint: '/api/pos/sales/checkout', kind: 'pos.sales.checkout', payload });
          return { queued: true as const };
        }
        throw err;
      }
    },
    onSuccess: (res) => {
      PosAudio.playPaymentSuccess();
      void queryClient.invalidateQueries({ queryKey: ['pos', 'offlineQueue'] });
      setCart([]);
      setUsdInput('0.00');
      setVesInput('0.00');
      setStatusMsg(res.queued ? 'Ticket encolado offline (IndexedDB)' : `Venta #${res.sale.orderNumber} cobrada`);
    },
    onError: (err) => {
      PosAudio.playErrorTone();
      setStatusMsg(err.message);
    },
  });

  const syncMutation = useMutation({
    mutationFn: () =>
      flushOfflineQueue((item) =>
        rpc.api.pos.sales.checkout.$post({
          json: item.payload as Parameters<typeof rpc.api.pos.sales.checkout.$post>[0]['json'],
        }),
      ),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['pos', 'offlineQueue'] });
      setStatusMsg(`Cola sincronizada: ${res.settled} liquidados, ${res.retained} pendientes`);
    },
    onError: (err) => setStatusMsg(err.message),
  });

  return {
    openShiftMutation,
    closeShiftMutation,
    checkoutMutation,
    syncMutation,
    lastClosedReport,
    clearLastClosedReport: () => setLastClosedReport(null),
  };
}
