import { useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  formatMinorUnits,
  INPUT_CLS,
  parseNonNegInt,
  readApiError,
  type Phase2ViewProps,
} from './phase2-format';

type CommunityKind =
  | 'announcement'
  | 'pet_registration'
  | 'lost_pet_alert'
  | 'resident_vehicle'
  | 'community_poll'
  | 'community_event'
  | 'marketplace_listing';

/** Leases Split Rent contract activation & Condo Community Hub view. */
export function LeasesView({ vocabulary, rpc }: Phase2ViewProps) {
  const [leaseNumber, setLeaseNumber] = useState('LSE-2026-001');
  const [unitId, setUnitId] = useState('');
  const [primaryPartyId, setPrimaryPartyId] = useState('');
  const [coPartyId, setCoPartyId] = useState('');
  const [monthlyRentMinor, setMonthlyRentMinor] = useState('100001');
  const [escrowMinor, setEscrowMinor] = useState('200000');
  const [primaryShareBps, setPrimaryShareBps] = useState('5000');
  const [itemKind, setItemKind] = useState<CommunityKind>('announcement');
  const [postTitle, setPostTitle] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);

  const rackQuery = useQuery({
    queryKey: ['spaces', 'rack', 'leases-select'],
    queryFn: async () => {
      const res = await rpc.api.spaces.rack.$get({ query: {} });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const partiesQuery = useQuery({
    queryKey: ['customers', 'parties', 'leases-select'],
    queryFn: async () => {
      const res = await rpc.api.customers.parties.$get({ query: { limit: '50' } });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const units = rackQuery.data?.units ?? [];
  const parties = partiesQuery.data?.items ?? [];
  const activeUnitId = unitId || units[0]?.unitId || 'unit_101';
  const activePrimaryId = primaryPartyId || parties[0]?.id || 'party_1';
  const activeCoId = coPartyId || parties[1]?.id || parties[0]?.id || 'party_2';

  const p1Bps = Math.min(10_000, parseNonNegInt(primaryShareBps, 5000));
  const p2Bps = 10_000 - p1Bps;

  const activateMutation = useMutation({
    mutationFn: async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const res = await rpc.api.leases.contracts.activate.$post({
        json: {
          clientMutationId: crypto.randomUUID(),
          leaseNumber: leaseNumber.trim(),
          unitId: activeUnitId.trim(),
          primaryPartyId: activePrimaryId.trim(),
          startDate: nowSec,
          endDate: nowSec + 31_536_000,
          monthlyRentMinor: parseNonNegInt(monthlyRentMinor, 0),
          securityDepositEscrowMinor: parseNonNegInt(escrowMinor, 0),
          autopayEnabled: true,
          autopayDayOfMonth: 5,
          splitRentShares: [
            { partyId: activePrimaryId.trim(), shareBps: p1Bps, label: 'Titular' },
            { partyId: activeCoId.trim(), shareBps: p2Bps, label: 'Co-inquilino' },
          ],
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (data) => {
      const shares = data.splitRentShares
        .map((s) => `${s.partyId}: ${formatMinorUnits(s.amountMinor, 'USD')}`)
        .join(' · ');
      setFeedback(`Contrato ${data.leaseNumber} (${data.status}) · Escrow ${formatMinorUnits(data.securityDepositEscrowMinor, 'USD')} · ${shares}`);
    },
    onError: (err) => setFeedback(err.message),
  });

  const communityMutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.leases.community.$post({
        json: {
          clientMutationId: crypto.randomUUID(),
          itemKind,
          partyId: activePrimaryId.trim(),
          unitId: activeUnitId.trim(),
          title: postTitle.trim(),
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (data) => {
      setPostTitle('');
      setFeedback(`Publicado en Hub (${data.itemKind}): ${data.title}`);
    },
    onError: (err) => setFeedback(err.message),
  });

  function handleActivate(e: FormEvent) {
    e.preventDefault();
    if (!leaseNumber.trim() || activateMutation.isPending) return;
    activateMutation.mutate();
  }

  function handleCommunity(e: FormEvent) {
    e.preventDefault();
    if (!postTitle.trim() || communityMutation.isPending) return;
    communityMutation.mutate();
  }

  return (
    <section className="space-y-4 p-4" data-slot="leases-view">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Leases · Split Rent & Community Hub</h1>
        <p className="text-sm text-muted-foreground">
          Contratos de {vocabulary.spaceSingular.toLowerCase()}, depósito en garantía, Split Rent exacto ({(p1Bps / 100).toFixed(2)}% / {(p2Bps / 100).toFixed(2)}%) y tablero comunitario.
        </p>
      </div>

      <form onSubmit={handleActivate} className="grid grid-cols-1 gap-2 rounded-lg border border-border bg-card p-3 md:grid-cols-4">
        <input type="text" value={leaseNumber} onChange={(e) => setLeaseNumber(e.target.value)} placeholder="Nro Contrato" className={`${INPUT_CLS} font-mono text-xs`} />
        <select value={activeUnitId} onChange={(e) => setUnitId(e.target.value)} className={INPUT_CLS}>
          {units.length === 0 ? (
            <option value="unit_101">unit_101 (demo)</option>
          ) : (
            units.map((u) => <option key={u.unitId} value={u.unitId}>{u.unitNumber}</option>)
          )}
        </select>
        <select value={activePrimaryId} onChange={(e) => setPrimaryPartyId(e.target.value)} className={INPUT_CLS}>
          {parties.length === 0 ? (
            <option value="party_1">party_1 (demo)</option>
          ) : (
            parties.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)
          )}
        </select>
        <select value={activeCoId} onChange={(e) => setCoPartyId(e.target.value)} className={INPUT_CLS}>
          {parties.length === 0 ? (
            <option value="party_2">party_2 (demo)</option>
          ) : (
            parties.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)
          )}
        </select>
        <input type="number" min={0} step={1} value={monthlyRentMinor} onChange={(e) => setMonthlyRentMinor(e.target.value)} placeholder="Renta (minor)" className={`${INPUT_CLS} font-mono tabular-nums`} />
        <input type="number" min={0} step={1} value={escrowMinor} onChange={(e) => setEscrowMinor(e.target.value)} placeholder="Escrow (minor)" className={`${INPUT_CLS} font-mono tabular-nums`} />
        <input type="number" min={0} max={10000} step={1} value={primaryShareBps} onChange={(e) => setPrimaryShareBps(e.target.value)} placeholder="Share bps (0..10000)" className={`${INPUT_CLS} font-mono tabular-nums`} />
        <button type="submit" disabled={activateMutation.isPending} className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground">
          Activar Contrato
        </button>
      </form>

      <form onSubmit={handleCommunity} className="grid grid-cols-1 gap-2 rounded-lg border border-border bg-card p-3 md:grid-cols-3">
        <select value={itemKind} onChange={(e) => setItemKind(e.target.value as CommunityKind)} className={INPUT_CLS}>
          <option value="announcement">Anuncio</option>
          <option value="pet_registration">Registro de Mascota</option>
          <option value="lost_pet_alert">Alerta Mascota Perdida</option>
          <option value="resident_vehicle">Vehículo Residente</option>
          <option value="community_poll">Encuesta</option>
          <option value="community_event">Evento</option>
          <option value="marketplace_listing">Marketplace</option>
        </select>
        <input type="text" value={postTitle} onChange={(e) => setPostTitle(e.target.value)} placeholder="Título en Community Hub" className={INPUT_CLS} />
        <button type="submit" disabled={communityMutation.isPending || !postTitle.trim()} className="h-9 rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-muted disabled:opacity-50">
          Publicar en Hub
        </button>
      </form>

      {feedback ? (
        <p className="rounded-md border border-border bg-muted/60 px-3 py-2 text-xs font-mono">{feedback}</p>
      ) : null}
    </section>
  );
}
