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
  { kind: 'payment_gateway' as const, label: 'Stripe / Autopay / Tpay', Icon: CreditCard, sample: 'stripe://live-checkout', defaultEvents: 'order.paid,invoice.stamped' },
  { kind: 'messaging_channel' as const, label: 'Resend / SMTP / Gmail / Push', Icon: Mail, sample: 'resend://notifications', defaultEvents: 'notification.sent' },
  { kind: 'carrier_sync' as const, label: 'InPost Carrier & Akeneo PIM', Icon: Truck, sample: 'akeneo://pim-catalog-sync', defaultEvents: 'catalog.synced,shipment.dispatched' },
  { kind: 'web_research' as const, label: 'Web Research (Exa / Tavily)', Icon: Globe, sample: 'tavily://company-enrichment', defaultEvents: 'lead.enriched' },
  { kind: 'webhook_endpoint' as const, label: 'Webhooks HMAC & Excel/CSV', Icon: Webhook, sample: 'https://hooks.empresa.com/shac', defaultEvents: 'order.paid,stock.low' },
];

/** Open Mercato DS v3 Part B Satellite Connectors Hub with explicit confirmation before insertion. */
export function IntegrationsHubView({ rpc }: Phase2ViewProps) {
  const queryClient = useQueryClient();
  const [recordKind, setRecordKind] = useState<ConnectorKind>('payment_gateway');
  const [providerOrUrl, setProviderOrUrl] = useState('');
  const [events, setEvents] = useState('order.paid,invoice.stamped');
  const [selectedPresetLabel, setSelectedPresetLabel] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);

  const connQuery = useQuery({
    queryKey: ['system', 'connectors'],
    queryFn: async () => {
      const res = await rpc.api.system.connectors.$get();
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.system.connectors.$post({
        json: {
          recordKind,
          providerOrUrl: providerOrUrl.trim(),
          events: events.split(',').map((s) => s.trim()).filter(Boolean),
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: () => {
      setSelectedPresetLabel(null);
      setProviderOrUrl('');
      setFeedback({ tone: 'info', text: 'Conector configurado y activado correctamente.' });
      void queryClient.invalidateQueries({ queryKey: ['system', 'connectors'] });
    },
    onError: (err) => setFeedback({ tone: 'error', text: err.message }),
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
    if (!providerOrUrl.trim() || addMutation.isPending) return;
    addMutation.mutate();
  }

  return (
    <section className="space-y-5" data-slot="integrations-hub-view">
      <PageHeader title="Hub de Integraciones, Gateways & Webhooks" description="Preselección guiada y configuración explícita de credenciales/endpoints antes de conectar." onRefresh={() => void connQuery.refetch()} />

      {feedback ? (
        <p role={feedback.tone === 'error' ? 'alert' : 'status'} className={`rounded-md border px-3 py-2 text-xs font-medium ${feedback.tone === 'error' ? 'border-destructive/40 bg-destructive/10 text-destructive' : 'border-status-info-border bg-status-info-bg text-status-info-text'}`}>
          {feedback.text}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {PRESET_CATALOG.map(({ kind, label, Icon, sample, defaultEvents }) => (
          <button
            key={kind}
            type="button"
            onClick={() => {
              setRecordKind(kind);
              setProviderOrUrl(sample);
              setEvents(defaultEvents);
              setSelectedPresetLabel(label);
              setFeedback(null);
            }}
            className={`flex items-start gap-3 rounded-xl border p-4 text-left shadow-xs transition-colors ${selectedPresetLabel === label ? 'border-primary bg-primary/[0.04]' : 'border-border bg-card hover:bg-muted/35'}`}
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/60">
              <Icon className="size-4 text-foreground" />
            </span>
            <div className="min-w-0 space-y-1">
              <p className="text-xs font-semibold">{label}</p>
              <p className="truncate font-mono text-[11px] text-muted-foreground">Configurar {sample}</p>
            </div>
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 items-end gap-3 rounded-xl border border-border bg-card p-4 shadow-xs md:grid-cols-4">
        <label className="space-y-1 text-xs">
          <span className="font-medium text-muted-foreground">Categoría del Conector</span>
          <select value={recordKind} onChange={(e) => setRecordKind(e.target.value as ConnectorKind)} className={`${INPUT_CLS} w-full`}>
            <option value="payment_gateway">Pasarela de Pago</option>
            <option value="messaging_channel">Canal Mensajería / Push</option>
            <option value="carrier_sync">Carrier / Akeneo PIM</option>
            <option value="web_research">Web Research (Exa/Tavily)</option>
            <option value="webhook_endpoint">Webhook HMAC</option>
            <option value="excel_sync">Excel / CSV Sync</option>
          </select>
        </label>
        <label className="space-y-1 text-xs">
          <span className="font-medium text-muted-foreground">Endpoint / URI del Proveedor</span>
          <input value={providerOrUrl} onChange={(e) => setProviderOrUrl(e.target.value)} placeholder="https://..." className={`${INPUT_CLS} w-full font-mono text-xs`} />
        </label>
        <label className="space-y-1 text-xs">
          <span className="font-medium text-muted-foreground">Eventos Suscritos (coma)</span>
          <input value={events} onChange={(e) => setEvents(e.target.value)} placeholder="order.paid,invoice.stamped" className={`${INPUT_CLS} w-full font-mono text-xs`} />
        </label>
        <button type="submit" disabled={addMutation.isPending || !providerOrUrl.trim()} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-45">
          <Plus className="size-3.5" /><span>{selectedPresetLabel ? 'Confirmar y Conectar' : 'Conectar'}</span>
        </button>
      </form>

      <DataTable columns={columns} data={items} getRowId={(c) => c.id} loading={connQuery.isLoading} emptyTitle="Sin conectores configurados" />
    </section>
  );
}
