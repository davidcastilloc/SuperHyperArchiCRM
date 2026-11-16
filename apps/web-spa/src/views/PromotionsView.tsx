import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Percent, Plus, Ticket } from 'lucide-react';
import { DataTable, PageHeader, StatusBadge, type DataTableColumn } from '@shac/ui';
import { INPUT_CLS, parseNonNegInt, readApiError, type Phase2ViewProps } from './phase2-format';

/** Open Mercato DS v3 Promotions & Coupon Codes management view. */
export function PromotionsView({ rpc }: Phase2ViewProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('Descuento Apertura 15%');
  const [couponCode, setCouponCode] = useState('APERTURA15');
  const [discountBps, setDiscountBps] = useState('1500');

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
      const res = await rpc.api.catalog.promotions.$post({
        json: { name: name.trim(), couponCode: couponCode.trim(), discountBps: Math.max(100, parseNonNegInt(discountBps, 1000)), maxUses: 200 },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['catalog', 'promotions'] }),
  });

  const items = promosQuery.data?.items ?? [];
  type PromoRow = (typeof items)[number];
  const columns: DataTableColumn<PromoRow>[] = [
    { id: 'name', header: 'Campaña / Regla', cell: (p) => <span className="font-medium">{p.name}</span> },
    { id: 'code', header: 'Cupón', cell: (p) => <StatusBadge label={p.couponCode ?? 'AUTO'} tone="info" icon={<Ticket className="size-3" />} /> },
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

      <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-2.5 rounded-xl border border-border bg-card p-4 shadow-xs md:grid-cols-4">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre de campaña" className={INPUT_CLS} />
        <input value={couponCode} onChange={(e) => setCouponCode(e.target.value)} placeholder="CÓDIGO" className={`${INPUT_CLS} font-mono uppercase text-xs`} />
        <input value={discountBps} onChange={(e) => setDiscountBps(e.target.value)} placeholder="Descuento bps (1500 = 15%)" className={`${INPUT_CLS} font-mono tabular-nums`} />
        <button type="submit" disabled={createMutation.isPending} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground"><Plus className="size-3.5" /><span>Crear Cupón</span></button>
      </form>

      <DataTable columns={columns} data={items} getRowId={(p) => p.id} loading={promosQuery.isLoading} emptyTitle="Sin promociones activas" />
    </section>
  );
}
