import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Key, Plus, Users } from 'lucide-react';
import { DataTable, PageHeader, StatusBadge, type DataTableColumn } from '@shac/ui';
import { INPUT_CLS, readApiError, type Phase2ViewProps } from './phase2-format';

/** Open Mercato DS v3 IAM Admin: Users, Branches (Organizations), and API Keys. */
export function IamAdminView({ rpc }: Phase2ViewProps) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'users' | 'orgs' | 'keys'>('users');
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [orgName, setOrgName] = useState('');
  const [orgSlug, setOrgSlug] = useState('');
  const [keyName, setKeyName] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);

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
      const res = await rpc.api.iam.users.$post({
        json: { email: email.trim(), fullName: fullName.trim(), realm: 'staff', password: password || undefined, perms: ['*'] },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (u) => {
      setEmail('');
      setFullName('');
      setPassword('');
      setFeedback(`Usuario ${u.email} registrado`);
      void queryClient.invalidateQueries({ queryKey: ['iam', 'users'] });
    },
    onError: (err) => setFeedback(err.message),
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
      setFeedback(`Sucursal ${o.name} (${o.treePath}) creada`);
      void queryClient.invalidateQueries({ queryKey: ['iam', 'orgs'] });
    },
    onError: (err) => setFeedback(err.message),
  });

  const createKeyMutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.iam['api-keys'].$post({
        json: { clientMutationId: crypto.randomUUID(), name: keyName.trim(), permissions: ['*'] },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (k) => {
      setKeyName('');
      setFeedback(`API Key creada (cópiala ahora): ${k.plainTextKey}`);
      void queryClient.invalidateQueries({ queryKey: ['iam', 'api-keys'] });
    },
    onError: (err) => setFeedback(err.message),
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
        description="Administración de usuarios del tenant, jerarquía organizacional y llaves Bearer."
        onRefresh={() => {
          void usersQuery.refetch();
          void orgsQuery.refetch();
          void keysQuery.refetch();
        }}
      />

      <div className="flex gap-4 border-b border-border">
        {[
          ['users', `Usuarios (${users.length})`, Users],
          ['orgs', `Sucursales (${orgs.length})`, Building2],
          ['keys', `API Keys (${keys.length})`, Key],
        ].map(([id, label, Icon]) => {
          const IconComp = Icon as typeof Users;
          return (
            <button key={id as string} type="button" onClick={() => setTab(id as 'users' | 'orgs' | 'keys')} className={`inline-flex items-center gap-1.5 border-b-2 pb-2.5 text-xs font-medium ${tab === id ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground'}`}>
              <IconComp className="size-3.5" />
              <span>{label as string}</span>
            </button>
          );
        })}
      </div>

      {feedback ? <p className="rounded-md border border-status-info-border bg-status-info-bg px-3 py-2 font-mono text-xs text-status-info-text">{feedback}</p> : null}

      <form onSubmit={handleForm} className="grid grid-cols-1 gap-2.5 rounded-xl border border-border bg-card p-4 shadow-xs md:grid-cols-4">
        {tab === 'users' ? (
          <>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Nombre completo" className={INPUT_CLS} />
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="correo@empresa.com" className={INPUT_CLS} />
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Contraseña (min 8)" className={INPUT_CLS} />
            <button type="submit" className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground"><Plus className="size-3.5" /><span>Crear Usuario</span></button>
          </>
        ) : tab === 'orgs' ? (
          <>
            <input value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="Nombre de sucursal" className={`${INPUT_CLS} md:col-span-2`} />
            <input value={orgSlug} onChange={(e) => setOrgSlug(e.target.value)} placeholder="slug-sucursal" className={`${INPUT_CLS} font-mono text-xs`} />
            <button type="submit" className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground"><Plus className="size-3.5" /><span>Crear Sucursal</span></button>
          </>
        ) : (
          <>
            <input value={keyName} onChange={(e) => setKeyName(e.target.value)} placeholder="Nombre de API Key (ej. ERP Sync)" className={`${INPUT_CLS} md:col-span-3`} />
            <button type="submit" className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground"><Plus className="size-3.5" /><span>Generar API Key</span></button>
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
