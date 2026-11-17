import { AlertCircle, ArrowRight, BookOpenCheck, CheckCircle2, Loader2, Play, Printer, RotateCcw, Users } from 'lucide-react';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { KpiCard, PageHeader, SegmentedTabs, StatusBadge } from '@shac/ui';
import {
  DEMO_PERSONAS,
  DEMO_SCENARIOS,
  executeLiveScenarioStep,
  SOP_CHEAT_SHEETS,
  type DemoPersona,
  type ScenarioProgressState,
} from '../lib/demoScenarios';
import { PosAudio } from '../lib/posAudio';
import { readApiError, type Phase2ViewProps } from './phase2-format';

interface DemoAndSopCenterViewProps extends Phase2ViewProps {
  onNavigate: (href: string) => void;
}

type CenterTab = 'runner' | 'personas' | 'sop';

/** Interactive Demo Scenario Runner, Industry Persona Switcher & Printable SOP Cheat-Sheets. */
export function DemoAndSopCenterView({ rpc, onNavigate }: DemoAndSopCenterViewProps) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<CenterTab>('runner');
  const [scenarioId, setScenarioId] = useState(DEMO_SCENARIOS[0]!.id);
  const [progressByScenario, setProgressByScenario] = useState<Record<string, ScenarioProgressState>>({});
  const [runningStep, setRunningStep] = useState(false);
  const [switchingPersonaId, setSwitchingPersonaId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const activeScenario = DEMO_SCENARIOS.find((s) => s.id === scenarioId) ?? DEMO_SCENARIOS[0]!;
  const state = progressByScenario[activeScenario.id] ?? { currentStep: 0, logs: [] };
  const pct = Math.round((state.currentStep / activeScenario.steps.length) * 100);

  async function handleRunNext() {
    if (runningStep) return;
    setErrorMsg(null);
    setRunningStep(true);
    try {
      const receiptLine = await executeLiveScenarioStep(rpc, activeScenario.id, state.currentStep);
      PosAudio.playPaymentSuccess();
      setProgressByScenario((prev) => ({
        ...prev,
        [activeScenario.id]: {
          currentStep: Math.min(activeScenario.steps.length, state.currentStep + 1),
          logs: [receiptLine, ...state.logs],
        },
      }));
    } catch (err) {
      PosAudio.playErrorTone();
      setErrorMsg(err instanceof Error ? err.message : 'Error ejecutando paso del escenario.');
    } finally {
      setRunningStep(false);
    }
  }

  function handleReset() {
    PosAudio.playScanBeep();
    setErrorMsg(null);
    setProgressByScenario((prev) => ({
      ...prev,
      [activeScenario.id]: { currentStep: 0, logs: [] },
    }));
  }

  async function handleEnterPersona(p: DemoPersona) {
    setErrorMsg(null);
    setSwitchingPersonaId(p.id);
    try {
      const res = await rpc.api.system['app-store'].toggle.$post({
        json: { switchPreset: p.presetId, presetMode: 'replace' } as never,
      });
      if (!res.ok) throw await readApiError(res);
      await qc.invalidateQueries({ queryKey: ['auth', 'bootstrap'] });
      onNavigate(p.route);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'No se pudo cambiar de vertical.');
    } finally {
      setSwitchingPersonaId(null);
    }
  }

  return (
    <section className="space-y-5" data-slot="demo-sop-center-view">
      <PageHeader
        title="Simulador Demo, Personas & Guías SOP"
        description="Recorridos guiados por industria, cambio rápido de rol y manuales operativos imprimibles."
        actions={
          <button type="button" onClick={() => window.print()} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium shadow-xs hover:bg-muted">
            <Printer className="size-3.5" /><span>Imprimir SOP</span>
          </button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard title="Escenarios Guiados" value={DEMO_SCENARIOS.length} />
        <KpiCard title="Personas de Industria" value={DEMO_PERSONAS.length} />
        <KpiCard title="Progreso Escenario Activo" value={`${pct}%`} />
      </div>

      <SegmentedTabs
        activeId={tab}
        onSelect={(id) => setTab(id as CenterTab)}
        tabs={[
          { id: 'runner', label: 'Simulador Demo', count: DEMO_SCENARIOS.length, icon: <Play className="size-3.5" /> },
          { id: 'personas', label: 'Personas / Verticales', count: DEMO_PERSONAS.length, icon: <Users className="size-3.5" /> },
          { id: 'sop', label: 'Guías SOP & Atajos', count: SOP_CHEAT_SHEETS.length, icon: <BookOpenCheck className="size-3.5" /> },
        ]}
      />

      {errorMsg ? (
        <div role="alert" className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-xs font-medium text-destructive">
          <AlertCircle className="size-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      ) : null}

      {tab === 'runner' ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <div className="space-y-2">
            {DEMO_SCENARIOS.map((sc) => (
              <button
                key={sc.id}
                type="button"
                onClick={() => setScenarioId(sc.id)}
                className={`w-full rounded-xl border p-3.5 text-left transition-colors ${
                  sc.id === activeScenario.id ? 'border-primary bg-primary/[0.04]' : 'border-border bg-card hover:bg-muted/40'
                }`}
              >
                <p className="text-[11px] font-medium text-primary">{sc.vertical}</p>
                <p className="mt-0.5 text-xs font-semibold text-foreground">{sc.title}</p>
              </button>
            ))}
          </div>

          <div className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-xs lg:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
              <div>
                <h3 className="text-sm font-semibold">{activeScenario.title}</h3>
                <p className="font-mono text-xs text-muted-foreground tabular-nums">
                  Paso {Math.min(state.currentStep + 1, activeScenario.steps.length)} de {activeScenario.steps.length} · {pct}% completado
                </p>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={handleReset} className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-background px-2.5 text-xs font-medium hover:bg-muted">
                  <RotateCcw className="size-3.5" /><span>Reiniciar</span>
                </button>
                <button
                  type="button"
                  disabled={runningStep || state.currentStep >= activeScenario.steps.length}
                  onClick={() => void handleRunNext()}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-45"
                >
                  {runningStep ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
                  <span>{runningStep ? 'Ejecutando...' : 'Ejecutar Paso'}</span>
                </button>
              </div>
            </div>

            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
            </div>

            <div className="space-y-2">
              {activeScenario.steps.map((step, idx) => {
                const done = idx < state.currentStep;
                return (
                  <div key={step.label} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/25 px-3 py-2.5 text-xs">
                    <div className="flex items-center gap-2.5">
                      <CheckCircle2 className={`size-4 shrink-0 ${done ? 'text-emerald-600' : 'text-muted-foreground/40'}`} />
                      <div>
                        <p className="font-medium text-foreground">{step.label}</p>
                        <p className="font-mono text-[10px] text-muted-foreground">{step.endpointSummary}</p>
                      </div>
                    </div>
                    <button type="button" onClick={() => onNavigate(step.route)} className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium hover:bg-muted">
                      <span>Abrir</span><ArrowRight className="size-3" />
                    </button>
                  </div>
                );
              })}
            </div>

            {state.logs.length > 0 ? (
              <div className="rounded-lg border border-border bg-muted/40 p-3 font-mono text-[11px] text-foreground space-y-1">
                {state.logs.map((line, i) => <div key={i}>{line}</div>)}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {tab === 'personas' ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {DEMO_PERSONAS.map((p) => (
            <div key={p.id} className="flex flex-col justify-between rounded-xl border border-border bg-card p-4 shadow-xs">
              <div className="space-y-1.5">
                <StatusBadge label={p.vertical} tone="info" />
                <h3 className="text-sm font-semibold">{p.roleTitle}</h3>
                <p className="text-xs text-muted-foreground">{p.summary}</p>
              </div>
              <button
                type="button"
                disabled={switchingPersonaId === p.id}
                onClick={() => void handleEnterPersona(p)}
                className="mt-4 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-primary text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {switchingPersonaId === p.id ? <Loader2 className="size-3.5 animate-spin" /> : null}
                <span>{switchingPersonaId === p.id ? 'Cambiando vertical...' : `Entrar como ${p.roleTitle}`}</span>
                <ArrowRight className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {tab === 'sop' ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {SOP_CHEAT_SHEETS.map((sheet) => (
            <div key={sheet.id} className="space-y-3 rounded-xl border border-border bg-card p-5 shadow-xs">
              <h3 className="text-sm font-semibold">{sheet.title}</h3>
              <div className="space-y-1.5">
                {sheet.shortcuts.map((sc) => (
                  <div key={sc.keys} className="flex items-center justify-between border-b border-border/60 pb-1 text-xs">
                    <span className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] font-semibold">{sc.keys}</span>
                    <span className="text-muted-foreground">{sc.action}</span>
                  </div>
                ))}
              </div>
              <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                {sheet.checklist.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
