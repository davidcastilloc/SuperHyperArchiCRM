import { Loader2, Sparkles, X } from 'lucide-react';
import { cn } from '../lib/cn.js';

export interface AiCopilotBannerProps {
  title: string;
  summary: string;
  prompts: readonly string[];
  onRunPrompt: (prompt: string) => void;
  reply?: string | null;
  onClearReply?: () => void;
  loading?: boolean;
  className?: string;
}

/** Compact Operate-mode AI Copilot strip with 1-click domain prompt pills. */
export function AiCopilotBanner({
  title,
  summary,
  prompts,
  onRunPrompt,
  reply,
  onClearReply,
  loading = false,
  className,
}: AiCopilotBannerProps) {
  return (
    <div
      data-slot="ai-copilot-banner"
      className={cn(
        'rounded-xl border border-primary/20 bg-primary/[0.03] px-4 py-3 shadow-xs',
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          </div>
          <div>
            <h2 className="text-xs font-semibold text-foreground">{title}</h2>
            <p className="text-[11px] text-muted-foreground">{summary}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {prompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              disabled={loading}
              onClick={() => onRunPrompt(prompt)}
              className="inline-flex h-7 items-center gap-1 rounded-full border border-border bg-background px-2.5 text-[11px] font-medium text-foreground shadow-xs transition-colors hover:border-primary/40 hover:bg-primary/5 disabled:opacity-50"
            >
              <Sparkles className="size-3 text-primary" />
              <span>{prompt}</span>
            </button>
          ))}
        </div>
      </div>
      {reply ? (
        <div className="mt-2.5 flex items-start justify-between gap-2 rounded-lg border border-border bg-card p-3 text-xs text-foreground">
          <pre className="whitespace-pre-wrap font-sans leading-relaxed">{reply}</pre>
          {onClearReply ? (
            <button
              type="button"
              onClick={onClearReply}
              aria-label="Cerrar respuesta IA"
              className="rounded p-0.5 text-muted-foreground hover:bg-muted"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
