import { loadConfig } from './config.js';

export class MonteAPIError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string
  ) {
    super(message);
    this.name = 'MonteAPIError';
  }
}

async function makeRequest(endpoint: string, options: RequestInit = {}): Promise<unknown> {
  const config = loadConfig();
  const url = `${config.apiUrl}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new MonteAPIError(response.status, error.error || error.message || 'Request failed', error.code);
  }

  if (response.status === 204) return null;
  return response.json();
}

export const api = {
  // Persona
  getPersona: () => makeRequest('/persona'),
  buildPersona: (baseTraits?: Record<string, number>) =>
    makeRequest('/persona', {
      method: 'POST',
      body: JSON.stringify(baseTraits ? { baseTraits } : {}),
    }),
  getPersonaHistory: () => makeRequest('/persona/history'),
  getPersonaTraits: () => makeRequest('/persona/traits'),

  // Simulations
  listSimulations: () => makeRequest('/simulation'),
  createSimulation: (scenarioType: string, name: string, options?: { parameters?: Record<string, unknown>; cloneCount?: number }) =>
    makeRequest('/simulation', {
      method: 'POST',
      body: JSON.stringify({
        scenarioType,
        name,
        parameters: options?.parameters,
        cloneCount: options?.cloneCount,
      }),
    }),
  getSimulation: (id: string) => makeRequest(`/simulation/${id}`),
  getSimulationResults: (id: string) => makeRequest(`/simulation/${id}/results`),
  getSimulationProgress: (id: string) => makeRequest(`/simulation/${id}/progress-rest`),
  deleteSimulation: (id: string) =>
    makeRequest(`/simulation/${id}`, { method: 'DELETE' }),
  listScenarios: () => makeRequest('/simulation/scenarios'),

  // Ingestion
  listDataSources: () => makeRequest('/ingestion/sources'),
  createDataSource: (sourceType: string, name: string, metadata?: Record<string, unknown>) =>
    makeRequest('/ingestion/sources', {
      method: 'POST',
      body: JSON.stringify({ sourceType, name, metadata }),
    }),
  uploadFiles: (files: Array<{ filename: string; content: string; mimetype: string }>) =>
    makeRequest('/ingestion/upload', {
      method: 'POST',
      body: JSON.stringify({ files }),
    }),
  getDataSourceStatus: (id: string) => makeRequest(`/ingestion/sources/${id}/status`),
  deleteDataSource: (id: string) =>
    makeRequest(`/ingestion/sources/${id}`, { method: 'DELETE' }),

  // Health
  health: () => makeRequest('/health'),
};
