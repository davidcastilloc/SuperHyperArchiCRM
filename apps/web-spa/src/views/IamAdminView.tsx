import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Key, KeyRound, Plus, Users } from 'lucide-react';
import { DataTable, PageHeader, StatusBadge, type DataTableColumn } from '@shac/ui';
import { INPUT_CLS, readApiError, type Phase2ViewProps } from './phase2-format';

export const STAFF_ROLE_PRESETS: Record<string, { label: string; perms: string[] }> = {
  cashier: { label: 'Cajero POS', perms: ['pos.sales.read', 'pos.sales.write', 'pos.kiosk.read', 'catalog.products.read', 'customers.read'] },
  warehouse: { label: 'Almacenista WMS', perms: ['wms.pickings.read', 'wms.pickings.write', 'catalog.products.read', 'catalog.products.write', 'customers.read'] },
  clinician: { label: 'Médico / Clínico', perms: ['cases.read', 'cases.write', 'customers.read', 'customers.write', 'spaces.read'] },
  legal: { label: 'Abogado / Legal', perms: ['cases.read', 'cases.write', 'customers.read', 'customers.write', 'finance.read'] },
  frontdesk: { label: 'Recepción / PMS', perms: ['spaces.read', 'spaces.write', 'leases.read', 'leases.write', 'customers.read', 'customers.write'] },
  guard: { label: 'Guardia Garita IoT', perms: ['physical.read', 'physical.write', 'spaces.read', 'customers.read'] },
  finance: { label: 'Finanzas GAAP', perms: ['finance.read', 'finance.write', 'customers.read'] },
  admin: { label: 'Administrador Total', perms: ['*'] },
};

/** Open Mercato DS v3 IAM Admin: Users with Floor/Delegation PINs, Branches, and API Keys. */
export function IamAdminView({ rpc }: Phase2ViewProps) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'users' | 'orgs' | 'keys'>('users');
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [floorPin, setFloorPin] = useState('');
  const [rolePreset, setRolePreset] = useState<string>('cashier');
  const [defaultOrgId, setDefaultOrgId] = useState('');
  const [delegationPinOut, setDelegationPinOut] = useState<string | null>(null);
  const [orgName, setOrgName] = useState('');
  const [orgSlug, setOrgSlug] = useState('');
  const [keyName, setKeyName] = useState('');
  const [feedback, setFeedback] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);

  const usersQuery = useQuery({
    queryKey: ['iam', 'users'],
    queryFn: async () => {
      const res = await rpc.api.iam.users.$get();
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const orgsQuery = useQuery({
    queryKey: ['iam', 'orgs'],
    queryFn: async () => {
      const res = await rpc.api.iam.orgs.$get({ query: {} });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const keysQuery = useQuery({
    queryKey: ['iam', 'api-keys'],
    queryFn: async () => {
      const res = await rpc.api.iam['api-keys'].$get();
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const createUserMutation = useMutation({
    mutationFn: async () => {
      const role = STAFF_ROLE_PRESETS[rolePreset] ?? STAFF_ROLE_PRESETS.cashier!;
      const res = await rpc.api.iam.users.$post({
        json: {
          email: email.trim(),
          fullName: fullName.trim(),
          realm: rolePreset === 'admin' ? 'admin' : 'staff',
          defaultOrgId: defaultOrgId || orgs[0]?.id,
          password: password || undefined,
          floorPin: floorPin.trim().length === 4 ? floorPin.trim() : undefined,
          perms: role.perms,
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (u) => {
      setEmail('');
      setFullName('');
      setPassword('');
      setFloorPin('');
      setFeedback({ kind: 'info', text: `Usuario ${u.email} guardado (${STAFF_ROLE_PRESETS[rolePreset]?.label ?? rolePreset})` });
      void queryClient.invalidateQueries({ queryKey: ['iam', 'users'] });
    },
    onError: (err) => setFeedback({ kind: 'error', text: err.message }),
  });

  const delegationPinMutation = useMutation({
    mutationFn: async () => {
      const targetUser = users[0];
      if (!targetUser) throw new Error('Crea al menos un usuario primero.');
      const res = await rpc.api.iam.delegation.pins.$post({
        json: {
          clientMutationId: crypto.randomUUID(),
          redeemerUserId: targetUser.id,
          scopePermissions: ['pos.sales.write', 'pos.returns.approve'],
          ttl: '4h',
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json() as Promise<{ pin: string }>;
    },
    onSuccess: (d) => {
      setDelegationPinOut(d.pin);
      setFeedback({ kind: 'info', text: `PIN de delegación emitido (válido 60 min): ${d.pin}` });
    },
    onError: (err) => setFeedback({ kind: 'error', text: err.message }),
  });

  const createOrgMutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.iam.orgs.$post({
        json: { clientMutationId: crypto.randomUUID(), name: orgName.trim(), slug: orgSlug.trim() || orgName.trim().toLowerCase().replace(/\s+/g, '-') },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (o) => {
      setOrgName('');
      setOrgSlug('');
      setFeedback({ kind: 'info', text: `Sucursal ${o.name} (${o.treePath}) creada` });
      void queryClient.invalidateQueries({ queryKey: ['iam', 'orgs'] });
    },
    onError: (err) => setFeedback({ kind: 'error', text: err.message }),
  });

  const createKeyMutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.iam['api-keys'].$post({
        json: { clientMutationId: crypto.randomUUID(), name: keyName.trim(), permissions: ['customers.read', 'catalog.products.read'] },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (k) => {
      setKeyName('');
      setFeedback({ kind: 'info', text: `API Key creada (cópiala ahora): ${k.plainTextKey}` });
      void queryClient.invalidateQueries({ queryKey: ['iam', 'api-keys'] });
    },
    onError: (err) => setFeedback({ kind: 'error', text: err.message }),
  });

  const users = usersQuery.data?.items ?? [];
  const orgs = orgsQuery.data?.items ?? [];
  const keys = keysQuery.data?.items ?? [];

  type UserRow = (typeof users)[number];
  type OrgRow = (typeof orgs)[number];
  type KeyRow = (typeof keys)[number];

  const userCols: DataTableColumn<UserRow>[] = [
    { id: 'name', header: 'Usuario', sortValue: (u) => u.fullName, cell: (u) => <div><p className="font-medium">{u.fullName}</p><p className="font-mono text-xs text-muted-foreground">{u.email}</p></div> },
    { id: 'realm', header: 'Realm / Rol', cell: (u) => <StatusBadge label={u.realm} tone="info" /> },
    { id: 'status', header: 'Estado', cell: (u) => <StatusBadge label={u.isActive ? 'Activo' : 'Inactivo'} tone={u.isActive ? 'success' : 'neutral'} appearance="dot" /> },
  ];
  const orgCols: DataTableColumn<OrgRow>[] = [
    { id: 'name', header: 'Sucursal / Org', sortValue: (o) => o.name, cell: (o) => <span className="font-medium">{o.name}</span> },
    { id: 'path', header: 'Árbol orgPath', cell: (o) => <span className="font-mono text-xs text-muted-foreground">{o.treePath}</span> },
    { id: 'kind', header: 'Tipo', cell: (o) => <StatusBadge label={o.orgKind} tone="neutral" /> },
  ];
  const keyCols: DataTableColumn<KeyRow>[] = [
    { id: 'name', header: 'Nombre', cell: (k) => <span className="font-medium">{k.name}</span> },
    { id: 'prefix', header: 'Prefijo', cell: (k) => <span className="font-mono text-xs">{k.keyPrefix}***</span> },
    { id: 'perms', header: 'Permisos', cell: (k) => <span className="font-mono text-xs text-muted-foreground">{k.permissionsJson}</span> },
  ];

  function handleForm(e: FormEvent) {
    e.preventDefault();
    if (tab === 'users' && email.trim() && fullName.trim()) createUserMutation.mutate();
    if (tab === 'orgs' && orgName.trim()) createOrgMutation.mutate();
    if (tab === 'keys' && keyName.trim()) createKeyMutation.mutate();
  }

  return (
    <section className="space-y-5" data-slot="iam-admin-view">
      <PageHeader
        title="Directorio IAM, Sucursales & API Keys"
        description="Administración de personal con PIN de piso, delegación supervisada y sucursales."
        onRefresh={() => {
          void usersQuery.refetch();
          void orgsQuery.refetch();
          void keysQuery.refetch();
        }}
        actions={
          <button
            type="button"
            disabled={delegationPinMutation.isPending}
            onClick={() => delegationPinMutation.mutate()}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium shadow-xs hover:bg-muted"
          >
            <KeyRound className="size-3.5" />
            <span>Emitir PIN Delegación (6 dígitos)</span>
          </button>
        }
      />

      <div className="flex gap-4 border-b border-border">
        {[
          ['users', `Usuarios (${users.length})`, Users],
          ['orgs', `Sucursales (${orgs.length})`, Building2],
          ['keys', `API Keys (${keys.length})`, Key],
        ].map(([id, label, Icon]) => {
          const IconComp = Icon as typeof Users;
          return (
            <button key={id as string} type="button" onClick={() => setTab(id as 'users' | 'orgs' | 'keys')} className={`inline-flex items-center gap-1.5 border-b-2 pb-2.5 text-xs font-medium ${tab === id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'}`}>
              <IconComp className="size-3.5" />
              <span>{label as string}</span>
            </button>
          );
        })}
      </div>

      {delegationPinOut ? (
        <div className="flex items-center justify-between rounded-lg border border-status-success-border bg-status-success-bg px-4 py-3 text-xs text-status-success-text">
          <span>PIN de delegación activo para supervisor:</span>
          <span className="font-mono text-lg font-bold tracking-widest tabular-nums">{delegationPinOut}</span>
        </div>
      ) : null}

      {feedback ? (
        <p className={`rounded-md border px-3 py-2 font-mono text-xs ${feedback.kind === 'error' ? 'border-status-error-border bg-status-error-bg text-status-error-text' : 'border-status-info-border bg-status-info-bg text-status-info-text'}`}>
          {feedback.text}
        </p>
      ) : null}

      <form onSubmit={handleForm} className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-card p-4 shadow-xs md:grid-cols-3">
        {tab === 'users' ? (
          <>
            <label className="space-y-1 text-xs">
              <span className="font-medium text-muted-foreground">Nombre completo</span>
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Ana Morales" className={INPUT_CLS} />
            </label>
            <label className="space-y-1 text-xs">
              <span className="font-medium text-muted-foreground">Correo electrónico</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="correo@empresa.com" className={INPUT_CLS} />
            </label>
            <label className="space-y-1 text-xs">
              <span className="font-medium text-muted-foreground">Contraseña (mín. 8)</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className={INPUT_CLS} />
            </label>
            <label className="space-y-1 text-xs">
              <span className="font-medium text-muted-foreground">Rol / Permisos</span>
              <select value={rolePreset} onChange={(e) => setRolePreset(e.target.value)} className={INPUT_CLS}>
                {Object.entries(STAFF_ROLE_PRESETS).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs">
              <span className="font-medium text-muted-foreground">Sucursal asignada</span>
              <select value={defaultOrgId || orgs[0]?.id || ''} onChange={(e) => setDefaultOrgId(e.target.value)} className={INPUT_CLS}>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </label>
            <div className="flex items-end gap-2">
              <label className="flex-1 space-y-1 text-xs">
                <span className="font-medium text-muted-foreground">PIN Piso (4 dígitos)</span>
                <input maxLength={4} value={floorPin} onChange={(e) => setFloorPin(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="4829" className={`${INPUT_CLS} font-mono`} />
              </label>
              <button type="submit" className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">
                <Plus className="size-3.5" /><span>Guardar</span>
              </button>
            </div>
          </>
        ) : tab === 'orgs' ? (
          <>
            <label className="space-y-1 text-xs">
              <span className="font-medium text-muted-foreground">Nombre de sucursal</span>
              <input value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="Sucursal Norte" className={INPUT_CLS} />
            </label>
            <label className="space-y-1 text-xs">
              <span className="font-medium text-muted-foreground">Slug URL</span>
              <input value={orgSlug} onChange={(e) => setOrgSlug(e.target.value)} placeholder="sucursal-norte" className={`${INPUT_CLS} font-mono text-xs`} />
            </label>
            <div className="flex items-end">
              <button type="submit" className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground"><Plus className="size-3.5" /><span>Crear Sucursal</span></button>
            </div>
          </>
        ) : (
          <>
            <label className="space-y-1 text-xs md:col-span-2">
              <span className="font-medium text-muted-foreground">Nombre de API Key</span>
              <input value={keyName} onChange={(e) => setKeyName(e.target.value)} placeholder="ERP Sync" className={INPUT_CLS} />
            </label>
            <div className="flex items-end">
              <button type="submit" className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground"><Plus className="size-3.5" /><span>Generar API Key</span></button>
            </div>
          </>
        )}
      </form>

      {tab === 'users' ? (
        <DataTable columns={userCols} data={users} getRowId={(u) => u.id} loading={usersQuery.isLoading} emptyTitle="Sin usuarios" />
      ) : tab === 'orgs' ? (
        <DataTable columns={orgCols} data={orgs} getRowId={(o) => o.id} loading={orgsQuery.isLoading} emptyTitle="Sin sucursales" />
      ) : (
        <DataTable columns={keyCols} data={keys} getRowId={(k) => k.id} loading={keysQuery.isLoading} emptyTitle="Sin API Keys generadas" />
      )}
    </section>
  );
}
