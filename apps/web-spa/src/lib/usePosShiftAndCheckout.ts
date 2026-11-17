import { useMutation, useQueryClient } from '@tanstack/react-query';
import { enqueueOfflineMutation, flushOfflineQueue } from './offlineQueue';
import { PosAudio } from './posAudio';
import { parseMajorToMinor, readApiError, ShacApiError, type Phase2ViewProps } from '../views/phase2-format';
import type { PosCartLine } from '../views/PosReceiptPanel';

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
}

/** Encapsulates POS shift open/close, offline-queued checkout, and queue sync mutations. */
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
}: UsePosShiftParams) {
  const queryClient = useQueryClient();

  const openShiftMutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.pos.shifts.open.$post({
        json: {
          clientMutationId: crypto.randomUUID(),
          registerId: registerId.trim(),
          cashierName: cashierName.trim() || 'Cajero',
          initialBalancesMinor: { USD: 0, VES: 0 },
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (data) => {
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
    onSuccess: () => {
      setShiftId('');
      setCart([]);
      setStatusMsg(`Caja ${registerId} cerrada con arqueo`);
    },
    onError: (err) => setStatusMsg(err.message),
  });

  const checkoutMutation = useMutation({
    mutationFn: async () => {
      const clientMutationId = crypto.randomUUID();
      const usdPay = parseMajorToMinor(usdInput);
      const vesPay = parseMajorToMinor(vesInput);
      const payments = [
        ...(usdPay > 0 ? [{ financialAccountId: 'acc_usd_cash', currency: 'USD', methodCode: 'USD_CASH', amountMinor: usdPay }] : []),
        ...(vesPay > 0 ? [{ financialAccountId: 'acc_ves_pm', currency: 'VES', methodCode: 'PAGO_MOVIL', amountMinor: vesPay }] : []),
      ];
      const payload = {
        clientMutationId,
        shiftId: shiftId.trim(),
        orderCurrency: 'USD',
        items: cart.map((line) => ({ productId: line.productId, qty: line.qty })),
        payments,
      };
      try {
        const res = await rpc.api.pos.sales.checkout.$post({ json: payload });
        if (res.status >= 500) {
          await enqueueOfflineMutation({ clientMutationId, endpoint: '/api/pos/sales/checkout', kind: 'pos.sales.checkout', payload });
          return { queued: true as const };
        }
        if (!res.ok) throw await readApiError(res);
        return { queued: false as const, sale: await res.json() };
      } catch (err) {
        if (err instanceof TypeError) {
          await enqueueOfflineMutation({ clientMutationId, endpoint: '/api/pos/sales/checkout', kind: 'pos.sales.checkout', payload });
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
  });

  return { openShiftMutation, closeShiftMutation, checkoutMutation, syncMutation };
}
