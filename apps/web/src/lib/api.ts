import type {
  DataSourceDetail,
  DataSourceListResponse,
  PersonaHistoryItem,
  PersonaSummary,
  PersonaTrait,
  PsychologicalProfile,
  ScenarioDefinition,
  SimulationCreateInput,
  SimulationDetail,
  SimulationListResponse,
  SimulationProgress,
  SimulationResultsEnvelope,
  UserSummary,
} from './types';

const apiBaseUrl = (import.meta.env.VITE_MONTE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? 'http://localhost:3000';

function buildUrl(path: string, searchParams?: Record<string, string | number | boolean | undefined>) {
  const url = new URL(`${apiBaseUrl}${path}`);

  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (value !== undefined && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
  }

  return url.toString();
}

export function getApiBaseUrl() {
  return apiBaseUrl;
}

async function request<T>(path: string, init?: RequestInit, searchParams?: Record<string, string | number | boolean | undefined>) {
  const response = await fetch(buildUrl(path, searchParams), {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? `Request failed with status ${response.status}`);
  }

  if (response.status === 204) {
    return null as T;
  }

  return (await response.json()) as T;
}

export const api = {
  getUser: () => request<UserSummary>('/users/me'),
  getPersona: () => request<PersonaSummary | { status: 'none'; message: string }>('/persona'),
  getPersonaHistory: () => request<PersonaHistoryItem[]>('/persona/history'),
  getPersonaTraits: () => request<PersonaTrait[]>('/persona/traits'),
  getPsychology: () => request<PsychologicalProfile | { status: 'none'; message: string }>('/persona/psychology'),
  getSimulations: (searchParams?: Record<string, string | number | boolean | undefined>) =>
    request<SimulationListResponse>('/simulation', undefined, searchParams),
  getSimulation: (simulationId: string) => request<SimulationDetail>(`/simulation/${simulationId}`),
  getSimulationResults: (simulationId: string, narrative = true) =>
    request<SimulationResultsEnvelope>(`/simulation/${simulationId}/results`, undefined, { narrative }),
  getSimulationProgress: (simulationId: string) => request<SimulationProgress>(`/stream/simulation/${simulationId}/progress-rest`),
  getScenarios: () => request<ScenarioDefinition[]>('/simulation/scenarios'),
  getSources: (searchParams?: Record<string, string | number | boolean | undefined>) =>
    request<DataSourceListResponse>('/ingestion/sources', undefined, searchParams),
  getSource: (sourceId: string) => request<DataSourceDetail>(`/ingestion/sources/${sourceId}`),
  createSimulation: (payload: SimulationCreateInput) =>
    request<{ simulationId: string; name: string; status: string; cloneCount: number }>('/simulation', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  addEvidence: (
    simulationId: string,
    payload: {
      recommendationIndex?: number;
      uncertainty?: string;
      focusMetric?: string;
      recommendedExperiment?: string;
      result: 'positive' | 'negative' | 'mixed' | 'inconclusive';
      confidence: number;
      observedSignal: string;
      notes?: string;
    },
  ) =>
    request<{ evidenceId?: string; evidenceCount?: number }> (`/simulation/${simulationId}/evidence`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  createRerun: (simulationId: string, payload?: { name?: string; cloneCount?: number; evidenceIds?: string[] }) =>
    request<{ rerunSimulationId?: string; status?: string }>(`/simulation/${simulationId}/rerun`, {
      method: 'POST',
      body: JSON.stringify(payload ?? {}),
    }),
};
