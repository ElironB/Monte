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
  const headers = new Headers(options.headers);
  const isFormDataBody = typeof FormData !== 'undefined' && options.body instanceof FormData;

  if (options.body !== undefined && !isFormDataBody && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(url, {
    ...options,
    headers,
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
  getPersonaPsychology: () => makeRequest('/persona/psychology'),
  getPersonalizationBootstrap: (payload: {
    task: string;
    mode?: string;
    agentName?: string;
    additionalContext?: string;
  }) =>
    makeRequest('/personalization/bootstrap', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getPersonalizationProfile: () => makeRequest('/personalization/profile'),
  getPersonalizationContext: (payload: {
    task: string;
    mode?: string;
    agentName?: string;
    additionalContext?: string;
  }) =>
    makeRequest('/personalization/context', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Simulations
  listSimulations: () => makeRequest('/simulation'),
  createSimulation: (scenarioType: string, name: string, options?: { parameters?: Record<string, unknown>; cloneCount?: number; capitalAtRisk?: number }) =>
    makeRequest('/simulation', {
      method: 'POST',
      body: JSON.stringify({
        scenarioType,
        name,
        parameters: options?.parameters,
        cloneCount: options?.cloneCount,
        capitalAtRisk: options?.capitalAtRisk,
      }),
    }),
  getSimulation: (id: string) => makeRequest(`/simulation/${id}`),
  getSimulationResults: (id: string, options?: { narrative?: boolean }) =>
    makeRequest(`/simulation/${id}/results${options?.narrative ? '?narrative=true' : ''}`),
  getSimulationProgress: (id: string) => makeRequest(`/stream/simulation/${id}/progress-rest`),
  recordSimulationEvidence: (
    id: string,
    payload: {
      recommendationIndex?: number;
      uncertainty?: string;
      focusMetric?: string;
      recommendedExperiment?: string;
      result: 'positive' | 'negative' | 'mixed' | 'inconclusive';
      confidence?: number;
      observedSignal: string;
      notes?: string;
      causalTargets?: string[];
      beliefTargets?: string[];
    }
  ) =>
    makeRequest(`/simulation/${id}/evidence`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  rerunSimulationWithEvidence: (
    id: string,
    payload?: {
      name?: string;
      cloneCount?: number;
      evidenceIds?: string[];
    }
  ) =>
    makeRequest(`/simulation/${id}/rerun`, {
      method: 'POST',
      body: JSON.stringify(payload ?? {}),
    }),
  deleteSimulation: (id: string) =>
    makeRequest(`/simulation/${id}`, { method: 'DELETE' }),
  listScenarios: () => makeRequest('/simulation/scenarios'),

  // Ingestion
  listDataSources: () => makeRequest('/ingestion/sources'),
  createDataSource: (
    sourceType: string,
    name: string,
    metadata?: Record<string, unknown>,
    expectedFileCount?: number,
  ) =>
    makeRequest('/ingestion/sources', {
      method: 'POST',
      body: JSON.stringify({ sourceType, name, metadata, expectedFileCount }),
    }),
  uploadSourceFile: (
    sourceId: string,
    payload: {
      filename: string;
      mimetype: string;
      buffer: Buffer;
      originalPath?: string;
      detectedSourceType?: string;
    },
  ) => {
    const formData = new FormData();
    formData.append('file', new Blob([new Uint8Array(payload.buffer)], { type: payload.mimetype }), payload.filename);
    if (payload.originalPath) {
      formData.append('originalPath', payload.originalPath);
    }
    if (payload.detectedSourceType) {
      formData.append('detectedSourceType', payload.detectedSourceType);
    }

    return makeRequest(`/ingestion/sources/${sourceId}/files`, {
      method: 'POST',
      body: formData,
    });
  },
  finalizeDataSourceUpload: (sourceId: string) =>
    makeRequest(`/ingestion/sources/${sourceId}/finalize`, {
      method: 'POST',
    }),
  uploadFiles: (files: Array<{ filename: string; content: string; mimetype: string }>, sourceType?: string) =>
    makeRequest('/ingestion/upload', {
      method: 'POST',
      body: JSON.stringify({ files, sourceType }),
    }),
  getDataSourceStatus: (id: string) => makeRequest(`/ingestion/sources/${id}/status`),
  deleteDataSource: (id: string) =>
    makeRequest(`/ingestion/sources/${id}`, { method: 'DELETE' }),

  // Health
  health: () => makeRequest('/health'),
};
