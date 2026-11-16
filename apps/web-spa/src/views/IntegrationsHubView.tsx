import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CreditCard, Globe, Mail, Plus, Truck, Webhook } from 'lucide-react';
import { DataTable, PageHeader, StatusBadge, type DataTableColumn } from '@shac/ui';
import { INPUT_CLS, readApiError, type Phase2ViewProps } from './phase2-format';

type ConnectorKind =
  | 'payment_gateway'
  | 'messaging_channel'
  | 'carrier_sync'
  | 'web_research'
  | 'webhook_endpoint'
  | 'excel_sync';

const PRESET_CATALOG = [
  { kind: 'payment_gateway' as const, label: 'Stripe / Autopay / Tpay', Icon: CreditCard, sample: 'stripe://live-checkout' },
  { kind: 'messaging_channel' as const, label: 'Resend / SMTP / Gmail / Discord / FCM / APNs / Expo', Icon: Mail, sample: 'resend://notifications' },
  { kind: 'carrier_sync' as const, label: 'InPost Carrier & Akeneo PIM Sync', Icon: Truck, sample: 'akeneo://pim-catalog-sync' },
  { kind: 'web_research' as const, label: 'Web Research (Exa / Tavily / Firecrawl / SearXNG / Serp)', Icon: Globe, sample: 'tavily://company-enrichment' },
  { kind: 'webhook_endpoint' as const, label: 'Webhooks HMAC & Excel/CSV Sync', Icon: Webhook, sample: 'https://hooks.empresa.com/shac' },
];

/** Open Mercato DS v3 Part B Satellite Connectors Hub (Gateways, Messaging, Carriers, Webhooks, Research). */
export function IntegrationsHubView({ rpc }: Phase2ViewProps) {
  const queryClient = useQueryClient();
  const [recordKind, setRecordKind] = useState<ConnectorKind>('payment_gateway');
  const [providerOrUrl, setProviderOrUrl] = useState('stripe://live-checkout');
  const [events, setEvents] = useState('order.paid,invoice.stamped');

  const connQuery = useQuery({
    queryKey: ['system', 'connectors'],
    queryFn: async () => {
      const res = await rpc.api.system.connectors.$get();
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const addMutation = useMutation({
    mutationFn: async (override?: { kind: ConnectorKind; provider: string }) => {
      const res = await rpc.api.system.connectors.$post({
        json: {
          recordKind: override?.kind ?? recordKind,
          providerOrUrl: (override?.provider ?? providerOrUrl).trim(),
          events: events.split(',').map((s) => s.trim()).filter(Boolean),
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['system', 'connectors'] }),
  });

  const items = connQuery.data?.items ?? [];
  type ConnRow = (typeof items)[number];
  const columns: DataTableColumn<ConnRow>[] = [
    { id: 'kind', header: 'Categoría', cell: (c) => <StatusBadge label={c.recordKind} tone="info" /> },
    { id: 'url', header: 'Proveedor / Endpoint', cell: (c) => <span className="font-mono text-xs font-medium">{c.providerOrUrl}</span> },
    { id: 'ev', header: 'Eventos Suscritos', cell: (c) => <span className="font-mono text-[11px] text-muted-foreground">{c.subscribedEventsJson}</span> },
    { id: 'st', header: 'Estado', cell: (c) => <StatusBadge label={c.status} tone="success" appearance="dot" /> },
  ];

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!providerOrUrl.trim()) return;
    addMutation.mutate(undefined);
  }

  return (
    <section className="space-y-5" data-slot="integrations-hub-view">
      <PageHeader title="Hub de Integraciones, Gateways & Webhooks" description="Conectores unificados para pasarelas de pago, mensajería omnicanal, carriers, PIM Akeneo, Web Research y Webhooks." onRefresh={() => void connQuery.refetch()} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {PRESET_CATALOG.map(({ kind, label, Icon, sample }) => (
          <button
            key={kind}
            type="button"
            onClick={() => addMutation.mutate({ kind, provider: sample })}
            className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 text-left shadow-xs transition-colors hover:bg-muted/35"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/60">
              <Icon className="size-4 text-foreground" />
            </span>
            <div className="min-w-0 space-y-1">
              <p className="text-xs font-semibold">{label}</p>
              <p className="truncate font-mono text-[11px] text-muted-foreground">+ Activar {sample}</p>
            </div>
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-2.5 rounded-xl border border-border bg-card p-4 shadow-xs md:grid-cols-4">
        <select value={recordKind} onChange={(e) => setRecordKind(e.target.value as ConnectorKind)} className={INPUT_CLS}>
          <option value="payment_gateway">Pasarela de Pago</option>
          <option value="messaging_channel">Canal Mensajería / Push</option>
          <option value="carrier_sync">Carrier / Akeneo PIM</option>
          <option value="web_research">Web Research (Exa/Tavily)</option>
          <option value="webhook_endpoint">Webhook HMAC</option>
          <option value="excel_sync">Excel / CSV Sync</option>
        </select>
        <input value={providerOrUrl} onChange={(e) => setProviderOrUrl(e.target.value)} placeholder="URL o URI del proveedor" className={`${INPUT_CLS} font-mono text-xs`} />
        <input value={events} onChange={(e) => setEvents(e.target.value)} placeholder="Eventos" className={`${INPUT_CLS} font-mono text-xs`} />
        <button type="submit" disabled={addMutation.isPending} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground"><Plus className="size-3.5" /><span>Conectar</span></button>
      </form>

      <DataTable columns={columns} data={items} getRowId={(c) => c.id} loading={connQuery.isLoading} emptyTitle="Sin conectores configurados" />
    </section>
  );
}
