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

const apiBaseUrl =
  (import.meta.env.VITE_MONTE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ??
  (import.meta.env.DEV ? 'http://localhost:3000' : window.location.origin);

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
  const { headers: initHeaders, ...restInit } = init ?? {};
  const headers = new Headers(initHeaders);

  if (restInit.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(buildUrl(path, searchParams), {
    ...restInit,
    headers,
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
    request<{
      evidence?: {
        id: string;
        uncertainty: string;
        focusMetric: string;
        recommendationIndex?: number;
        recommendedExperiment: string;
        result: 'positive' | 'negative' | 'mixed' | 'inconclusive';
        confidence: number;
        observedSignal: string;
        notes?: string;
        createdAt: string;
      } | null;
      evidenceCount: number;
    }>(`/simulation/${simulationId}/evidence`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  createRerun: (simulationId: string, payload?: { name?: string; cloneCount?: number; evidenceIds?: string[] }) =>
    request<{
      simulationId: string;
      name: string;
      status: string;
      cloneCount: number;
      sourceSimulationId: string;
      evidenceCount: number;
    }>(`/simulation/${simulationId}/rerun`, {
      method: 'POST',
      body: JSON.stringify(payload ?? {}),
    }),
};
