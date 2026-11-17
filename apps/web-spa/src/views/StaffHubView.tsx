import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarOff, Clock, Plus, UserCheck } from 'lucide-react';
import { DataTable, PageHeader, StatusBadge, type DataTableColumn } from '@shac/ui';
import { formatMinorUnits, INPUT_CLS, parseMajorToMinor, parseNonNegInt, readApiError, type Phase2ViewProps } from './phase2-format';

/** Open Mercato DS v3 Staff Profiles, Teams, Leave Requests, and Time-Tracking view. */
export function StaffHubView({ rpc }: Phase2ViewProps) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'profiles' | 'timesheets'>('profiles');
  const [userId, setUserId] = useState('usr_admin');
  const [dept, setDept] = useState('Operaciones');
  const [jobTitle, setJobTitle] = useState('Gerente de Sucursal');
  const [recordType, setRecordType] = useState<'timesheet' | 'leave_request'>('timesheet');
  const [selectedStaffId, setSelectedStaffId] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [minutes, setMinutes] = useState('120');
  const [rateMajor, setRateMajor] = useState('25.00');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const profilesQuery = useQuery({
    queryKey: ['staff', 'profiles'],
    queryFn: async () => {
      const res = await rpc.api.staff.profiles.$get();
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const projectsQuery = useQuery({
    queryKey: ['staff', 'projects', 'staff-select'],
    queryFn: async () => {
      const res = await rpc.api.staff.projects.$get();
      if (!res.ok) return { items: [] as Array<{ id: string; code: string; name: string }> };
      return res.json();
    },
  });

  const timesheetsQuery = useQuery({
    queryKey: ['staff', 'timesheets'],
    queryFn: async () => {
      const res = await rpc.api.staff.timesheets.$get();
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const profiles = profilesQuery.data?.items ?? [];
  const projects = projectsQuery.data?.items ?? [];
  const timesheets = timesheetsQuery.data?.items ?? [];

  const addProfileMutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.staff.profiles.$post({
        json: { userId: userId.trim(), departmentName: dept.trim(), jobTitle: jobTitle.trim(), hourlyRateMinor: parseMajorToMinor(rateMajor) },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: () => {
      setErrorMsg(null);
      void queryClient.invalidateQueries({ queryKey: ['staff', 'profiles'] });
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  const addTimeMutation = useMutation({
    mutationFn: async () => {
      const staffTarget = selectedStaffId || profiles[0]?.id || '';
      if (!staffTarget) throw new Error('Crea primero un perfil de colaborador en la pestaña Perfiles.');
      const res = await rpc.api.staff.timesheets.$post({
        json: {
          recordType,
          staffId: staffTarget,
          projectOrCaseId: selectedProjectId || undefined,
          durationMinutes: parseNonNegInt(minutes, 60),
          hourlyRateMinor: parseMajorToMinor(rateMajor),
          status: 'submitted',
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: () => {
      setErrorMsg(null);
      void queryClient.invalidateQueries({ queryKey: ['staff', 'timesheets'] });
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  const staffNameMap = new Map(profiles.map((p) => [p.id, `${p.jobTitle ?? 'Colaborador'} (${p.userId})`]));
  type ProfRow = (typeof profiles)[number];
  type TimeRow = (typeof timesheets)[number];

  const profCols: DataTableColumn<ProfRow>[] = [
    { id: 'job', header: 'Cargo / Equipo', cell: (p) => <div><p className="font-medium">{p.jobTitle ?? 'Colaborador'}</p><p className="text-xs text-muted-foreground">{p.departmentName ?? 'General'}</p></div> },
    { id: 'uid', header: 'Usuario', cell: (p) => <span className="font-mono text-xs">{p.userId}</span> },
    { id: 'rate', header: 'Tarifa/h', align: 'right', cell: (p) => <span className="font-mono tabular-nums">{formatMinorUnits(p.baseRateMinor, 'USD')}</span> },
    { id: 'status', header: 'Estado', cell: (p) => <StatusBadge label={p.isActive ? 'Activo' : 'Inactivo'} tone={p.isActive ? 'success' : 'neutral'} appearance="dot" /> },
  ];
  const timeCols: DataTableColumn<TimeRow>[] = [
    { id: 'type', header: 'Tipo', cell: (t) => <StatusBadge label={t.recordType === 'leave_request' ? 'Ausencia / Permiso' : 'Timesheet'} tone={t.recordType === 'leave_request' ? 'warning' : 'info'} /> },
    { id: 'staff', header: 'Colaborador', cell: (t) => <span className="text-xs font-medium">{staffNameMap.get(t.staffId) ?? t.staffId}</span> },
    { id: 'dur', header: 'Duración', align: 'right', cell: (t) => <span className="font-mono tabular-nums">{t.durationMinutes} min</span> },
    { id: 'pay', header: 'Importe', align: 'right', cell: (t) => <span className="font-mono font-medium tabular-nums">{formatMinorUnits(t.grossPayMinor, 'USD')}</span> },
    { id: 'st', header: 'Estado', cell: (t) => <StatusBadge label={t.status} tone={t.status === 'approved' ? 'success' : 'info'} appearance="dot" /> },
  ];

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (tab === 'profiles') addProfileMutation.mutate();
    else addTimeMutation.mutate();
  }

  return (
    <section className="space-y-5" data-slot="staff-hub-view">
      <PageHeader
        title="Staff, Ausencias & Time-Tracking"
        description="Perfiles de equipo, tarifas por hora, solicitudes de permisos y partes de trabajo."
        onRefresh={() => { void profilesQuery.refetch(); void timesheetsQuery.refetch(); }}
      />

      {errorMsg ? <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{errorMsg}</div> : null}

      <div className="flex gap-4 border-b border-border">
        <button type="button" onClick={() => setTab('profiles')} className={`inline-flex items-center gap-1.5 border-b-2 pb-2.5 text-xs font-medium ${tab === 'profiles' ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground'}`}>
          <UserCheck className="size-3.5" /><span>Perfiles ({profiles.length})</span>
        </button>
        <button type="button" onClick={() => setTab('timesheets')} className={`inline-flex items-center gap-1.5 border-b-2 pb-2.5 text-xs font-medium ${tab === 'timesheets' ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground'}`}>
          <Clock className="size-3.5" /><span>Timesheets & Permisos ({timesheets.length})</span>
        </button>
      </div>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 items-end gap-2.5 rounded-xl border border-border bg-card p-4 shadow-xs md:grid-cols-5">
        {tab === 'profiles' ? (
          <>
            <label className="space-y-1 text-xs"><span className="font-medium text-muted-foreground">ID Usuario</span><input value={userId} onChange={(e) => setUserId(e.target.value)} className={`${INPUT_CLS} w-full font-mono text-xs`} /></label>
            <label className="space-y-1 text-xs"><span className="font-medium text-muted-foreground">Departamento</span><input value={dept} onChange={(e) => setDept(e.target.value)} className={`${INPUT_CLS} w-full`} /></label>
            <label className="space-y-1 text-xs"><span className="font-medium text-muted-foreground">Cargo</span><input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} className={`${INPUT_CLS} w-full`} /></label>
            <label className="space-y-1 text-xs"><span className="font-medium text-muted-foreground">Tarifa (USD/h)</span><input value={rateMajor} onChange={(e) => setRateMajor(e.target.value)} className={`${INPUT_CLS} w-full font-mono tabular-nums`} /></label>
            <button type="submit" disabled={addProfileMutation.isPending} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground"><Plus className="size-3.5" /><span>Guardar Perfil</span></button>
          </>
        ) : (
          <>
            <label className="space-y-1 text-xs"><span className="font-medium text-muted-foreground">Colaborador</span>
              <select value={selectedStaffId || profiles[0]?.id || ''} onChange={(e) => setSelectedStaffId(e.target.value)} className={`${INPUT_CLS} w-full`}>
                {profiles.length === 0 ? <option value="">Sin perfiles</option> : null}
                {profiles.map((p) => <option key={p.id} value={p.id}>{p.jobTitle ?? 'Staff'} ({p.userId})</option>)}
              </select>
            </label>
            <label className="space-y-1 text-xs"><span className="font-medium text-muted-foreground">Tipo / Proyecto</span>
              <div className="flex gap-1">
                <select value={recordType} onChange={(e) => setRecordType(e.target.value as 'timesheet' | 'leave_request')} className={`${INPUT_CLS} w-1/2`}>
                  <option value="timesheet">Horas</option><option value="leave_request">Permiso</option>
                </select>
                <select value={selectedProjectId} onChange={(e) => setSelectedProjectId(e.target.value)} className={`${INPUT_CLS} w-1/2`}>
                  <option value="">General</option>
                  {projects.map((pr) => <option key={pr.id} value={pr.id}>{pr.code}</option>)}
                </select>
              </div>
            </label>
            <label className="space-y-1 text-xs"><span className="font-medium text-muted-foreground">Minutos</span><input value={minutes} onChange={(e) => setMinutes(e.target.value)} className={`${INPUT_CLS} w-full font-mono tabular-nums`} /></label>
            <label className="space-y-1 text-xs"><span className="font-medium text-muted-foreground">Tarifa (USD/h)</span><input value={rateMajor} onChange={(e) => setRateMajor(e.target.value)} className={`${INPUT_CLS} w-full font-mono tabular-nums`} /></label>
            <button type="submit" disabled={addTimeMutation.isPending} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground"><CalendarOff className="size-3.5" /><span>Registrar Parte</span></button>
          </>
        )}
      </form>

      {tab === 'profiles' ? (
        <DataTable columns={profCols} data={profiles} getRowId={(p) => p.id} loading={profilesQuery.isLoading} emptyTitle="Sin perfiles de staff" />
      ) : (
        <DataTable columns={timeCols} data={timesheets} getRowId={(t) => t.id} loading={timesheetsQuery.isLoading} emptyTitle="Sin partes ni permisos" />
      )}
    </section>
  );
}
