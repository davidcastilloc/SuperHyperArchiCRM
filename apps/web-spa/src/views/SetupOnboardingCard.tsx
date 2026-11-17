import { useState, type FormEvent } from 'react';
import { Rocket } from 'lucide-react';
import type { EditionPresetId, RegionPackId } from '@shac/kernel';
import { setAuthSession, type AuthSession } from '../lib/authSession';
import type { createRpcClient } from '../lib/rpc';
import { INPUT_CLS, readApiError } from './phase2-format';

interface SetupOnboardingCardProps {
  rpc: ReturnType<typeof createRpcClient>;
  hasProvisionedProfile?: boolean;
  initialPreset?: EditionPresetId;
  onInitialized: () => void;
}

const PRESET_OPTIONS: Array<{ id: EditionPresetId; label: string }> = [
  { id: 'retail-pos', label: 'Retail POS (Tiendas / Farmacias)' },
  { id: 'distro-wms', label: 'Distro & WMS (Mayoristas / 3PL)' },
  { id: 'tech-service', label: 'Tech Service (Talleres / RMA)' },
  { id: 'hospitality-pms', label: 'Hospitality PMS (Hoteles / Posadas)' },
  { id: 'property-condo', label: 'Property & Condo (Condominios)' },
  { id: 'clinic-practice', label: 'Clinic Practice (Clínicas EHR)' },
  { id: 'legal-psa', label: 'Legal & PSA (Bufetes / IOLTA)' },
  { id: 'industrial-gate', label: 'Industrial Gate (Garita IoT / LPR)' },
  { id: 'omni-enterprise', label: 'Omni Enterprise (Holding Multi-Unidad)' },
];

const REGION_OPTIONS: Array<{ id: RegionPackId; label: string }> = [
  { id: 've', label: 'Venezuela (USD / VES BCV)' },
  { id: 'co', label: 'Colombia (COP)' },
  { id: 'mx', label: 'México (MXN)' },
  { id: 'us', label: 'Estados Unidos (USD)' },
  { id: 'global', label: 'Global (USD / EUR)' },
];

/** Day-1 Cold-Start Setup Wizard when iam_users is empty. */
export function SetupOnboardingCard({
  rpc,
  hasProvisionedProfile = false,
  initialPreset = 'retail-pos',
  onInitialized,
}: SetupOnboardingCardProps) {
  const [companyName, setCompanyName] = useState('Mi Empresa');
  const [branchName, setBranchName] = useState('Casa Matriz');
  const [editionPreset, setEditionPreset] = useState<EditionPresetId>(initialPreset);
  const [regionPack, setRegionPack] = useState<RegionPackId>('ve');
  const [rateInput, setRateInput] = useState('54.75');
  const [adminName, setAdminName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [floorPin, setFloorPin] = useState('1234');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const parsedRate = Number.parseFloat(rateInput);
      const res = await rpc.api.auth.setup.$post({
        json: {
          companyName: companyName.trim(),
          branchName: branchName.trim(),
          editionPreset,
          regionPack,
          adminName: adminName.trim(),
          email: email.trim(),
          password,
          ...(floorPin.trim().length === 4 ? { floorPin: floorPin.trim() } : {}),
          ...(regionPack === 've' && Number.isFinite(parsedRate) && parsedRate > 0
            ? { initialUsdToLocalRate: parsedRate }
            : {}),
        },
      });
      if (!res.ok) throw await readApiError(res);
      const session = (await res.json()) as AuthSession;
      setAuthSession(session);
      onInitialized();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al inicializar sistema');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl rounded-xl border border-border bg-card p-6 shadow-sm space-y-5">
      <div className="space-y-1">
        <div className="inline-flex items-center gap-2 text-primary text-xs font-semibold uppercase tracking-wide">
          <Rocket className="size-4" />
          <span>Configuración Inicial Día 1</span>
        </div>
        <h1 className="text-xl font-semibold tracking-tight">Inicializar SuperHyperArchiCRM</h1>
        <p className="text-xs text-muted-foreground">
          {hasProvisionedProfile
            ? `Perfil pre-aprovisionado (${initialPreset}). Crea tu sede matriz y cuenta administradora inicial.`
            : 'Configura tu empresa, industria vertical y usuario administrador para comenzar a operar.'}
        </p>
      </div>

      {error ? (
        <p className="rounded-md border border-status-error-border bg-status-error-bg px-3 py-2 text-xs font-medium text-status-error-text">
          {error}
        </p>
      ) : null}

      <form onSubmit={(e) => void handleSubmit(e)} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-xs">
          <span className="font-medium text-muted-foreground">Nombre de Empresa</span>
          <input required value={companyName} onChange={(e) => setCompanyName(e.target.value)} className={INPUT_CLS} />
        </label>
        <label className="space-y-1 text-xs">
          <span className="font-medium text-muted-foreground">Sede Matriz</span>
          <input required value={branchName} onChange={(e) => setBranchName(e.target.value)} className={INPUT_CLS} />
        </label>
        <label className="space-y-1 text-xs">
          <span className="font-medium text-muted-foreground">Vertical de Industria</span>
          <select
            disabled={hasProvisionedProfile}
            value={editionPreset}
            onChange={(e) => setEditionPreset(e.target.value as EditionPresetId)}
            className={INPUT_CLS}
          >
            {PRESET_OPTIONS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs">
          <span className="font-medium text-muted-foreground">Región & Moneda</span>
          <select
            disabled={hasProvisionedProfile}
            value={regionPack}
            onChange={(e) => setRegionPack(e.target.value as RegionPackId)}
            className={INPUT_CLS}
          >
            {REGION_OPTIONS.map((r) => (
              <option key={r.id} value={r.id}>{r.label}</option>
            ))}
          </select>
        </label>
        {regionPack === 've' ? (
          <label className="space-y-1 text-xs sm:col-span-2">
            <span className="font-medium text-muted-foreground">Tasa Inicial BCV (Bs por 1 USD)</span>
            <input value={rateInput} onChange={(e) => setRateInput(e.target.value)} className={`${INPUT_CLS} font-mono`} />
          </label>
        ) : null}
        <label className="space-y-1 text-xs">
          <span className="font-medium text-muted-foreground">Nombre Administrador</span>
          <input required value={adminName} onChange={(e) => setAdminName(e.target.value)} placeholder="Ej. María Pérez" className={INPUT_CLS} />
        </label>
        <label className="space-y-1 text-xs">
          <span className="font-medium text-muted-foreground">Correo Electrónico</span>
          <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@empresa.com" className={INPUT_CLS} />
        </label>
        <label className="space-y-1 text-xs">
          <span className="font-medium text-muted-foreground">Contraseña (mín. 8 caracteres)</span>
          <input required minLength={8} type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={INPUT_CLS} />
        </label>
        <label className="space-y-1 text-xs">
          <span className="font-medium text-muted-foreground">PIN de Piso / Caja (4 dígitos)</span>
          <input maxLength={4} pattern="\d{4}" value={floorPin} onChange={(e) => setFloorPin(e.target.value.replace(/\D/g, '').slice(0, 4))} className={`${INPUT_CLS} font-mono`} />
        </label>
        <button
          type="submit"
          disabled={loading}
          className="sm:col-span-2 mt-1 inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-xs hover:bg-primary-hover disabled:opacity-50"
        >
          <Rocket className="size-4" />
          <span>{loading ? 'Inicializando...' : 'Crear Sede y Entrar al Sistema'}</span>
        </button>
      </form>
    </div>
  );
}
