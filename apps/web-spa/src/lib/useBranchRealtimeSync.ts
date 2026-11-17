import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

/**
 * Connects to BranchInventoryDO WebSocket hibernation (/ws/branch/:branchId)
 * and invalidates live branch/POS/dashboard queries whenever another register mutates stock or sales.
 */
export function useBranchRealtimeSync(branchId: string | undefined, tenantId = 'ten_1'): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!branchId || typeof window === 'undefined' || typeof WebSocket === 'undefined') return;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}/ws/branch/${encodeURIComponent(branchId)}?tenantId=${encodeURIComponent(tenantId)}`;
    let ws: WebSocket | null = null;
    try {
      ws = new WebSocket(url);
      ws.onmessage = () => {
        void queryClient.invalidateQueries({ queryKey: ['pos'] });
        void queryClient.invalidateQueries({ queryKey: ['wms'] });
        void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      };
    } catch {
      // Offline / non-WS environments degrade gracefully to polling/manual refetch
    }
    return () => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    };
  }, [branchId, tenantId, queryClient]);
}
