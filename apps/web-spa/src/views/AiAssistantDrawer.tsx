import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Bot, Send, Sparkles, X } from 'lucide-react';
import { readApiError } from './phase2-format';
import type { createRpcClient } from '../lib/rpc';

interface AiAssistantDrawerProps {
  open: boolean;
  onClose: () => void;
  rpc: ReturnType<typeof createRpcClient>;
}

/** Open Mercato DS v3 side-panel AI Assistant connected to live D1 tenant telemetry. */
export function AiAssistantDrawer({ open, onClose, rpc }: AiAssistantDrawerProps) {
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; text: string }>>([
    { role: 'assistant', text: 'Hola, soy el asistente operativo de SHAC. Pregúntame por ventas, clientes o pipeline.' },
  ]);

  const chatMutation = useMutation({
    mutationFn: async (text: string) => {
      const res = await rpc.api.automation['ai-chat'].$post({ json: { prompt: text } });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (data) => {
      setMessages((prev) => [...prev, { role: 'assistant', text: data.reply }]);
    },
    onError: (err) => {
      setMessages((prev) => [...prev, { role: 'assistant', text: err.message }]);
    },
  });

  if (!open) return null;

  function handleSend(e: FormEvent) {
    e.preventDefault();
    const clean = prompt.trim();
    if (!clean || chatMutation.isPending) return;
    setMessages((prev) => [...prev, { role: 'user', text: clean }]);
    setPrompt('');
    chatMutation.mutate(clean);
  }

  return (
    <aside
      data-slot="ai-assistant-drawer"
      className="fixed bottom-4 right-4 z-40 flex h-[28rem] w-full max-w-sm flex-col overflow-hidden rounded-xl border border-border bg-card shadow-lg"
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-foreground" />
          <p className="text-xs font-semibold">Open Mercato AI Assistant</p>
        </div>
        <button type="button" aria-label="Cerrar asistente AI" onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-muted">
          <X className="size-4" />
        </button>
      </div>

      <div className="flex-1 space-y-2.5 overflow-y-auto p-3.5 text-xs">
        {messages.map((m, i) => (
          <div key={i} className={`flex gap-2 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {m.role === 'assistant' ? <Bot className="mt-0.5 size-4 shrink-0 text-muted-foreground" /> : null}
            <p className={`whitespace-pre-line rounded-lg px-3 py-2 ${m.role === 'user' ? 'bg-primary text-primary-foreground' : 'border border-border bg-muted/40 text-foreground'}`}>
              {m.text}
            </p>
          </div>
        ))}
      </div>

      <form onSubmit={handleSend} className="flex items-center gap-2 border-t border-border p-2.5">
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Pregunta sobre tus datos..."
          className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-xs focus:outline-none focus:ring-2 focus:ring-ring/50"
        />
        <button type="submit" disabled={chatMutation.isPending || !prompt.trim()} className="inline-flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:opacity-45">
          <Send className="size-3.5" />
        </button>
      </form>
    </aside>
  );
}
