import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const CONFIG_DIR = join(homedir(), '.monte');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const AUTH_FILE = join(CONFIG_DIR, 'auth.json');

export interface CLIConfig {
  apiUrl: string;
  defaultScenario?: string;
  defaultCloneCount?: number;
}

export interface AuthConfig {
  accessToken?: string;
  refreshToken?: string;
  userId?: string;
  email?: string;
  expiresAt?: string;
}

export function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

export function loadConfig(): CLIConfig {
  ensureConfigDir();
  try {
    const data = readFileSync(CONFIG_FILE, 'utf-8');
    return { apiUrl: 'http://localhost:3000', ...JSON.parse(data) };
  } catch {
    return { apiUrl: 'http://localhost:3000' };
  }
}

export function saveConfig(config: Partial<CLIConfig>): void {
  ensureConfigDir();
  const current = loadConfig();
  writeFileSync(CONFIG_FILE, JSON.stringify({ ...current, ...config }, null, 2));
}

export function loadAuth(): AuthConfig {
  ensureConfigDir();
  try {
    const data = readFileSync(AUTH_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

export function saveAuth(auth: AuthConfig): void {
  ensureConfigDir();
  writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), { mode: 0o600 });
}

export function clearAuth(): void {
  ensureConfigDir();
  try {
    writeFileSync(AUTH_FILE, JSON.stringify({}));
  } catch {
    // ignore
  }
}

export function isAuthenticated(): boolean {
  const auth = loadAuth();
  if (!auth.accessToken) return false;
  if (auth.expiresAt && new Date(auth.expiresAt) < new Date()) return false;
  return true;
}

export function requireAuth(): AuthConfig {
  const auth = loadAuth();
  if (!auth.accessToken) {
    console.error('Error: Not authenticated. Run `monte login` first.');
    process.exit(1);
  }
  if (auth.expiresAt && new Date(auth.expiresAt) < new Date()) {
    console.error('Error: Session expired. Run `monte login` to refresh.');
    process.exit(1);
  }
  return auth;
}
