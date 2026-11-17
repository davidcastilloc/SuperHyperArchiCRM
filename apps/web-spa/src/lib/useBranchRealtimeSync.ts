import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

/**
 * Connects to BranchInventoryDO WebSocket hibernation (/ws/branch/:branchId)
 * with bounded exponential backoff + jitter reconnection and invalidates live branch/POS/dashboard queries.
 */
export function useBranchRealtimeSync(
  branchId: string | undefined,
  tenantId = 'ten_1',
): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!branchId || typeof window === 'undefined' || typeof WebSocket === 'undefined') {
      return;
    }
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}/ws/branch/${encodeURIComponent(branchId)}?tenantId=${encodeURIComponent(tenantId)}`;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    let attempt = 0;

    const connect = () => {
      if (disposed) return;
      try {
        ws = new WebSocket(url);
        ws.onopen = () => {
          attempt = 0;
        };
        ws.onmessage = () => {
          void queryClient.invalidateQueries({ queryKey: ['pos'] });
          void queryClient.invalidateQueries({ queryKey: ['wms'] });
          void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
        };
        ws.onclose = () => {
          if (disposed) return;
          const baseMs = Math.min(30_000, 500 * Math.pow(2, attempt));
          const jitterMs = Math.floor(Math.random() * 500);
          attempt += 1;
          reconnectTimer = setTimeout(connect, baseMs + jitterMs);
        };
      } catch {
        // Offline / non-WS environments degrade gracefully to polling/manual refetch
      }
    };

    connect();
    return () => {
      disposed = true;
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
      }
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        ws.close();
      }
    };
  }, [branchId, tenantId, queryClient]);
}
