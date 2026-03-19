import { loadConfig, loadAuth, saveAuth, clearAuth } from './config.js';

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

async function makeRequest(
  endpoint: string,
  options: RequestInit = {}
): Promise<unknown> {
  const config = loadConfig();
  const auth = loadAuth();

  const url = `${config.apiUrl}${endpoint}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  
  if (options.headers) {
    Object.entries(options.headers).forEach(([key, value]) => {
      if (typeof value === 'string') {
        headers[key] = value;
      }
    });
  }

  if (auth.accessToken) {
    headers['Authorization'] = `Bearer ${auth.accessToken}`;
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    // Try to refresh token
    if (auth.refreshToken) {
      const refreshed = await refreshAccessToken(auth.refreshToken);
      if (refreshed) {
        // Retry with new token
        return makeRequest(endpoint, {
          ...options,
          headers: {
            ...headers,
            'Authorization': `Bearer ${refreshed.accessToken}`,
          },
        });
      }
    }
    clearAuth();
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new MonteAPIError(response.status, error.error || error.message || 'Request failed', error.code);
  }

  // Handle empty responses
  if (response.status === 204) {
    return null;
  }

  return response.json();
}

async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string } | null> {
  const config = loadConfig();
  try {
    const response = await fetch(`${config.apiUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json() as { accessToken: string; refreshToken: string };
    saveAuth({
      ...loadAuth(),
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
    });
    return data;
  } catch {
    return null;
  }
}

export const api = {
  // Auth
  login: (email: string, password: string) =>
    makeRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  register: (email: string, password: string, name: string) =>
    makeRequest('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, name }),
    }),

  me: () => makeRequest('/auth/me'),

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

  // API Keys
  listApiKeys: () => makeRequest('/api-keys'),
  createApiKey: (name: string, scopes?: string[], rateLimit?: number, expiresInDays?: number) =>
    makeRequest('/api-keys', {
      method: 'POST',
      body: JSON.stringify({ name, scopes, rateLimit, expiresInDays }),
    }),
  revokeApiKey: (id: string) =>
    makeRequest(`/api-keys/${id}`, { method: 'DELETE' }),

  // Health
  health: () => makeRequest('/health'),
};
