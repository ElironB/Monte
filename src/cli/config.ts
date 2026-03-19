import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export { CONFIG_DIR };

const CONFIG_DIR = join(homedir(), '.monte');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

export interface CLIConfig {
  apiUrl: string;
  defaultScenario?: string;
  defaultCloneCount?: number;
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

const CONNECTIONS_FILE = join(CONFIG_DIR, 'connections.json');

export interface PendingConnection {
  slug: string;
  name: string;
  connectedAccountId: string;
  redirectUrl: string;
}

export function savePendingConnections(connections: PendingConnection[]): void {
  ensureConfigDir();
  writeFileSync(CONNECTIONS_FILE, JSON.stringify(connections, null, 2));
}

export function loadPendingConnections(): PendingConnection[] {
  ensureConfigDir();
  try {
    const data = readFileSync(CONNECTIONS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}
