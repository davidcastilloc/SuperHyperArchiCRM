import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Percent, Plus, Ticket } from 'lucide-react';
import { DataTable, PageHeader, StatusBadge, type DataTableColumn } from '@shac/ui';
import { INPUT_CLS, parsePercentToBps, readApiError, type Phase2ViewProps } from './phase2-format';

/** Open Mercato DS v3 Promotions & Coupon Codes management view. */
export function PromotionsView({ rpc }: Phase2ViewProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('Descuento Apertura 15%');
  const [couponCode, setCouponCode] = useState('APERTURA15');
  const [discountPercent, setDiscountPercent] = useState('15');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const promosQuery = useQuery({
    queryKey: ['catalog', 'promotions'],
    queryFn: async () => {
      const res = await rpc.api.catalog.promotions.$get();
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const bps = Math.max(100, parsePercentToBps(discountPercent));
      const res = await rpc.api.catalog.promotions.$post({
        json: { name: name.trim(), couponCode: couponCode.trim().toUpperCase(), discountBps: bps, maxUses: 200 },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: () => {
      setErrorMsg(null);
      void queryClient.invalidateQueries({ queryKey: ['catalog', 'promotions'] });
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  const items = promosQuery.data?.items ?? [];
  type PromoRow = (typeof items)[number];
  const columns: DataTableColumn<PromoRow>[] = [
    { id: 'name', header: 'Campaña / Regla', cell: (p) => <span className="font-medium">{p.name}</span> },
    { id: 'code', header: 'Cupón', cell: (p) => <StatusBadge label={p.couponCode ?? 'AUTO'} tone="info" icon={<Ticket className="size-3" />} /> },
    {
      id: 'disc',
      header: 'Descuento',
      align: 'right',
      cell: (p) => {
        let bps = 0;
        try {
          const parsed = JSON.parse(p.benefitsJson || '{}') as { discountBps?: number };
          bps = typeof parsed.discountBps === 'number' ? parsed.discountBps : 0;
        } catch {
          bps = 0;
        }
        return <span className="font-mono text-xs font-semibold tabular-nums">{(bps / 100).toFixed(1).replace(/\.0$/, '')}%</span>;
      },
    },
    { id: 'uses', header: 'Usos', align: 'right', cell: (p) => <span className="font-mono text-xs tabular-nums">{p.usedCount} / {p.maxUses ?? '∞'}</span> },
    { id: 'st', header: 'Estado', cell: (p) => <StatusBadge label={p.isActive ? 'Activa' : 'Pausada'} tone={p.isActive ? 'success' : 'neutral'} appearance="dot" /> },
  ];

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !couponCode.trim()) return;
    createMutation.mutate();
  }

  return (
    <section className="space-y-5" data-slot="promotions-view">
      <PageHeader title="Promociones & Cupones" description="Reglas comerciales, códigos promocionales y límites de redención." actions={<StatusBadge label="Motor 5-Capas" tone="info" icon={<Percent className="size-3" />} />} />

      {errorMsg ? (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {errorMsg}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="grid grid-cols-1 items-end gap-3 rounded-xl border border-border bg-card p-4 shadow-xs md:grid-cols-4">
        <label className="space-y-1 text-xs">
          <span className="font-medium text-muted-foreground">Nombre de campaña</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Descuento VIP" className={`${INPUT_CLS} w-full`} />
        </label>
        <label className="space-y-1 text-xs">
          <span className="font-medium text-muted-foreground">Código de cupón</span>
          <input value={couponCode} onChange={(e) => setCouponCode(e.target.value)} placeholder="VIP10" className={`${INPUT_CLS} w-full font-mono uppercase text-xs`} />
        </label>
        <label className="space-y-1 text-xs">
          <span className="font-medium text-muted-foreground">Descuento (%)</span>
          <input value={discountPercent} onChange={(e) => setDiscountPercent(e.target.value)} placeholder="15" className={`${INPUT_CLS} w-full font-mono tabular-nums`} />
        </label>
        <button type="submit" disabled={createMutation.isPending} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground"><Plus className="size-3.5" /><span>Crear Cupón</span></button>
      </form>

      <DataTable columns={columns} data={items} getRowId={(p) => p.id} loading={promosQuery.isLoading} emptyTitle="Sin promociones activas" />
    </section>
  );
}
