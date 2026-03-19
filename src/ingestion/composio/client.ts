import { logger } from '../../utils/logger.js';
import { execSync } from 'child_process';

export interface ComposioConnection {
  id: string;
  appName: string;
  status: 'ACTIVE' | 'INITIATED' | 'FAILED';
  createdAt?: string;
}

export class ComposioClient {
  private apiKey?: string;

  constructor() {
    this.apiKey = process.env.COMPOSIO_API_KEY;
    if (!this.apiKey) {
      logger.warn('COMPOSIO_API_KEY not set - composio integrations disabled');
    }
  }

  async isAvailable(): Promise<boolean> {
    return !!this.apiKey;
  }

  async listActiveConnections(): Promise<ComposioConnection[]> {
    if (!this.apiKey) return [];

    try {
      const binary = this.findBinary();
      const output = execSync(`${binary} manage connected-accounts list --status ACTIVE`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, COMPOSIO_API_KEY: this.apiKey },
      });
      const accounts = JSON.parse(output);
      if (!Array.isArray(accounts)) return [];
      return accounts.map((a: Record<string, unknown>) => ({
        id: (a.id as string) || '',
        appName: (a.appName as string) || (a.app_name as string) || (a.toolkit as string) || 'unknown',
        status: 'ACTIVE' as const,
        createdAt: (a.createdAt as string) || (a.created_at as string) || undefined,
      }));
    } catch (err) {
      logger.error({ err }, 'Failed to list Composio connections');
      return [];
    }
  }

  async listConnections(userId: string): Promise<ComposioConnection[]> {
    logger.info({ userId }, 'Listing Composio connections');
    return this.listActiveConnections();
  }

  async fetchData(connectionId: string): Promise<unknown[]> {
    if (!this.apiKey) return [];
    logger.info({ connectionId }, 'Fetching Composio data');
    return [];
  }

  private findBinary(): string {
    const locations = ['composio', `${process.env.HOME}/.composio/composio`];
    for (const loc of locations) {
      try {
        execSync(`${loc} --version`, { encoding: 'utf-8', stdio: 'pipe' });
        return loc;
      } catch {
        continue;
      }
    }
    throw new Error('Composio CLI not found');
  }
}

export const composioClient = new ComposioClient();
