import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarOff, Clock, Plus, UserCheck } from 'lucide-react';
import { DataTable, PageHeader, StatusBadge, type DataTableColumn } from '@shac/ui';
import { formatMinorUnits, INPUT_CLS, parseNonNegInt, readApiError, type Phase2ViewProps } from './phase2-format';

/** Open Mercato DS v3 Staff Profiles, Teams, Leave Requests, and Time-Tracking view. */
export function StaffHubView({ rpc }: Phase2ViewProps) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'profiles' | 'timesheets'>('profiles');
  const [userId, setUserId] = useState('usr_admin');
  const [dept, setDept] = useState('Operaciones');
  const [jobTitle, setJobTitle] = useState('Gerente de Sucursal');
  const [recordType, setRecordType] = useState<'timesheet' | 'leave_request'>('timesheet');
  const [minutes, setMinutes] = useState('120');
  const [rateMinor, setRateMinor] = useState('2500');

  const profilesQuery = useQuery({
    queryKey: ['staff', 'profiles'],
    queryFn: async () => {
      const res = await rpc.api.staff.profiles.$get();
      if (!res.ok) throw await readApiError(res);
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

  const addProfileMutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.staff.profiles.$post({
        json: { userId: userId.trim(), departmentName: dept.trim(), jobTitle: jobTitle.trim(), hourlyRateMinor: parseNonNegInt(rateMinor, 0) },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['staff', 'profiles'] }),
  });

  const addTimeMutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.staff.timesheets.$post({
        json: {
          recordType,
          staffId: profilesQuery.data?.items[0]?.id ?? userId.trim(),
          durationMinutes: parseNonNegInt(minutes, 60),
          hourlyRateMinor: parseNonNegInt(rateMinor, 0),
          status: 'submitted',
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['staff', 'timesheets'] }),
  });

  const profiles = profilesQuery.data?.items ?? [];
  const timesheets = timesheetsQuery.data?.items ?? [];
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
    { id: 'staff', header: 'Colaborador', cell: (t) => <span className="font-mono text-xs">{t.staffId}</span> },
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
        onRefresh={() => {
          void profilesQuery.refetch();
          void timesheetsQuery.refetch();
        }}
      />

      <div className="flex gap-4 border-b border-border">
        <button type="button" onClick={() => setTab('profiles')} className={`inline-flex items-center gap-1.5 border-b-2 pb-2.5 text-xs font-medium ${tab === 'profiles' ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground'}`}>
          <UserCheck className="size-3.5" />
          <span>Equipo ({profiles.length})</span>
        </button>
        <button type="button" onClick={() => setTab('timesheets')} className={`inline-flex items-center gap-1.5 border-b-2 pb-2.5 text-xs font-medium ${tab === 'timesheets' ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground'}`}>
          <Clock className="size-3.5" />
          <span>Timesheets & Permisos ({timesheets.length})</span>
        </button>
      </div>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-2.5 rounded-xl border border-border bg-card p-4 shadow-xs md:grid-cols-4">
        {tab === 'profiles' ? (
          <>
            <input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="User ID" className={`${INPUT_CLS} font-mono text-xs`} />
            <input value={dept} onChange={(e) => setDept(e.target.value)} placeholder="Departamento / Equipo" className={INPUT_CLS} />
            <input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="Cargo" className={INPUT_CLS} />
            <button type="submit" className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground"><Plus className="size-3.5" /><span>Agregar Miembro</span></button>
          </>
        ) : (
          <>
            <select value={recordType} onChange={(e) => setRecordType(e.target.value as 'timesheet' | 'leave_request')} className={INPUT_CLS}>
              <option value="timesheet">Registro de Horas (Timesheet)</option>
              <option value="leave_request">Solicitud de Ausencia (Leave)</option>
            </select>
            <input value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder="Minutos" className={`${INPUT_CLS} font-mono tabular-nums`} />
            <input value={rateMinor} onChange={(e) => setRateMinor(e.target.value)} placeholder="Tarifa/h (centavos)" className={`${INPUT_CLS} font-mono tabular-nums`} />
            <button type="submit" className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground"><CalendarOff className="size-3.5" /><span>Registrar</span></button>
          </>
        )}
      </form>

      {tab === 'profiles' ? (
        <DataTable columns={profCols} data={profiles} getRowId={(p) => p.id} loading={profilesQuery.isLoading} emptyTitle="Sin perfiles de staff" />
      ) : (
        <DataTable columns={timeCols} data={timesheets} getRowId={(t) => t.id} loading={timesheetsQuery.isLoading} emptyTitle="Sin horas ni permisos registrados" />
      )}
    </section>
  );
}
