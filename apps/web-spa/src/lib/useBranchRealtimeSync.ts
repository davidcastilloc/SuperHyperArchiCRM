import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

/**
 * Connects to BranchInventoryDO WebSocket hibernation (/api/branch/:branchId/realtime/ws?sinceSeq=...)
 * with bounded exponential backoff + jitter reconnection and polling fallback.
 */
export function useBranchRealtimeSync(
  branchId: string | undefined,
  tenantId = 'ten_1',
): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!branchId || typeof window === 'undefined') return;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let fallbackPollTimer: ReturnType<typeof setInterval> | null = null;
    let disposed = false;
    let attempt = 0;
    let lastSeqId = 0;

    const invalidateBranchQueries = () => {
      void queryClient.invalidateQueries({ queryKey: ['pos'] });
      void queryClient.invalidateQueries({ queryKey: ['wms'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    };

    const startFallbackPolling = () => {
      if (fallbackPollTimer !== null) return;
      fallbackPollTimer = setInterval(invalidateBranchQueries, 30_000);
    };

    const stopFallbackPolling = () => {
      if (fallbackPollTimer !== null) {
        clearInterval(fallbackPollTimer);
        fallbackPollTimer = null;
      }
    };

    const connect = () => {
      if (disposed || typeof WebSocket === 'undefined') {
        startFallbackPolling();
        return;
      }
      const url = `${proto}//${window.location.host}/api/branch/${encodeURIComponent(branchId)}/realtime/ws?tenantId=${encodeURIComponent(tenantId)}&sinceSeq=${lastSeqId}`;
      try {
        ws = new WebSocket(url);
        ws.onopen = () => {
          attempt = 0;
          stopFallbackPolling();
        };
        ws.onmessage = (ev) => {
          try {
            const parsed = JSON.parse(String(ev.data)) as { seqId?: number };
            if (typeof parsed.seqId === 'number' && parsed.seqId > lastSeqId) {
              lastSeqId = parsed.seqId;
            }
          } catch {
            // Non-JSON frame still triggers cache invalidation
          }
          invalidateBranchQueries();
        };
        ws.onclose = () => {
          if (disposed) return;
          startFallbackPolling();
          const baseMs = Math.min(30_000, 500 * Math.pow(2, attempt));
          const jitterMs = Math.floor(Math.random() * 500);
          attempt += 1;
          reconnectTimer = setTimeout(connect, baseMs + jitterMs);
        };
      } catch {
        startFallbackPolling();
      }
    };

    connect();
    return () => {
      disposed = true;
      stopFallbackPolling();
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
      }
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        ws.close();
      }
    };
  }, [branchId, tenantId, queryClient]);
}
