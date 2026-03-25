import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, getApiBaseUrl } from '../lib/api';
import type { SimulationGraphSnapshot } from '../lib/types';

export function useSimulationGraphLive(
  simulationId: string | null,
  enabled: boolean,
  initialSnapshot: SimulationGraphSnapshot | null | undefined,
) {
  const [eventSnapshot, setEventSnapshot] = useState<SimulationGraphSnapshot | null>(null);

  const restQuery = useQuery({
    queryKey: ['simulation-graph-snapshot', simulationId],
    queryFn: () => api.getSimulationGraphSnapshot(simulationId!),
    enabled: Boolean(simulationId) && enabled,
    refetchInterval: enabled ? 5000 : false,
  });

  useEffect(() => {
    setEventSnapshot(null);

    if (!simulationId || !enabled) {
      return;
    }

    const source = new EventSource(`${getApiBaseUrl()}/stream/simulation/${simulationId}/graph`);

    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as Record<string, unknown>;
        if (payload.type === 'graph' && payload.data && typeof payload.data === 'object') {
          setEventSnapshot(payload.data as SimulationGraphSnapshot);
        }
      } catch {
        // Ignore malformed payloads and rely on polling.
      }
    };

    source.onerror = () => {
      source.close();
    };

    return () => {
      source.close();
    };
  }, [enabled, simulationId]);

  return {
    snapshot: eventSnapshot ?? restQuery.data ?? initialSnapshot ?? null,
    transport: eventSnapshot
      ? 'sse'
      : restQuery.data
        ? 'polling'
        : initialSnapshot
          ? 'initial'
          : 'none',
    error: restQuery.error as Error | null,
  };
}
