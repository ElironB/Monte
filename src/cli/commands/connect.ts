import { Command } from 'commander';
import { checkbox } from '@inquirer/prompts';
import { execSync } from 'child_process';
import { savePendingConnections, loadPendingConnections, PendingConnection } from '../config.js';

const PLATFORMS = [
  { name: 'Google', slug: 'google', description: 'Search history, YouTube watch history, Gmail' },
  { name: 'Reddit', slug: 'reddit', description: 'Posts, comments, saved items' },
  { name: 'Spotify', slug: 'spotify', description: 'Listening history, playlists' },
  { name: 'GitHub', slug: 'github', description: 'Commits, repos, activity patterns' },
  { name: 'Notion', slug: 'notion', description: 'Pages, databases, workspace' },
  { name: 'Slack', slug: 'slack', description: 'Messages, channels, response patterns' },
  { name: 'LinkedIn', slug: 'linkedin', description: 'Profile, connections, career history' },
  { name: 'Twitter', slug: 'twitter', description: 'Posts, likes, engagement' },
];

function findComposioBinary(): string {
  const locations = [
    'composio',
    `${process.env.HOME}/.composio/composio`,
    '/home/.composio/composio',
  ];
  for (const loc of locations) {
    try {
      execSync(`${loc} --version`, { encoding: 'utf-8', stdio: 'pipe' });
      return loc;
    } catch {
      continue;
    }
  }
  throw new Error(
    'Composio CLI not found. Install it:\n  curl -fsSL https://composio.dev/install | bash'
  );
}

function requireComposioKey(): void {
  if (!process.env.COMPOSIO_API_KEY) {
    console.error('Error: COMPOSIO_API_KEY not set.');
    console.error('Get your key at https://app.composio.dev and set it:');
    console.error('  export COMPOSIO_API_KEY=your_key_here');
    process.exit(1);
  }
}

async function initiateConnection(
  binary: string,
  slug: string,
): Promise<{ redirectUrl: string; connectedAccountId: string }> {
  const output = execSync(`${binary} link ${slug} --no-wait`, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  });
  const data = JSON.parse(output);
  return {
    redirectUrl: data.redirect_url || data.redirectUrl || data.url || '',
    connectedAccountId:
      data.connected_account_id || data.connectedAccountId || data.id || '',
  };
}

async function checkConnectionStatus(
  binary: string,
  connectedAccountId: string,
): Promise<string> {
  try {
    const output = execSync(
      `${binary} manage connected-accounts list --status ACTIVE`,
      {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      },
    );
    const accounts = JSON.parse(output);
    if (!Array.isArray(accounts)) return 'UNKNOWN';
    const found = accounts.find(
      (a: Record<string, unknown>) => a.id === connectedAccountId,
    );
    return found ? 'ACTIVE' : 'PENDING';
  } catch {
    return 'UNKNOWN';
  }
}

async function listActiveConnections(
  binary: string,
): Promise<Array<{ id: string; appName: string }>> {
  try {
    const output = execSync(
      `${binary} manage connected-accounts list --status ACTIVE`,
      {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      },
    );
    const accounts = JSON.parse(output);
    if (!Array.isArray(accounts)) return [];
    return accounts.map((a: Record<string, unknown>) => ({
      id: (a.id as string) || '',
      appName: (a.appName as string) || (a.app_name as string) || (a.toolkit as string) || 'unknown',
    }));
  } catch {
    return [];
  }
}

export const connectCommands = new Command('connect')
  .description('Connect data platforms via Composio');

connectCommands
  .action(async () => {
    requireComposioKey();

    let binary: string;
    try {
      binary = findComposioBinary();
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }

    const selected = await checkbox({
      message: 'Select platforms to connect (space to select, enter to confirm)',
      choices: PLATFORMS.map((p) => ({
        name: `${p.name} (${p.description})`,
        value: p.slug,
      })),
    });

    if (selected.length === 0) {
      console.log('No platforms selected.');
      return;
    }

    console.log(`\nSelected: ${selected.map((s: string) => PLATFORMS.find((p) => p.slug === s)!.name).join(', ')}`);
    console.log('\nGenerating connection links...\n');

    const pendingConnections: PendingConnection[] = [];

    for (const slug of selected) {
      const platform = PLATFORMS.find((p) => p.slug === slug)!;
      try {
        const result = await initiateConnection(binary, slug);
        const maxNameLen = Math.max(...selected.map((s: string) => PLATFORMS.find((p) => p.slug === s)!.name.length));
        console.log(`  ${platform.name.padEnd(maxNameLen + 1)} ${result.redirectUrl}`);
        pendingConnections.push({
          slug,
          name: platform.name,
          connectedAccountId: result.connectedAccountId,
          redirectUrl: result.redirectUrl,
        });
      } catch (err) {
        console.error(`  ${platform.name}: Failed — ${(err as Error).message}`);
      }
    }

    if (pendingConnections.length > 0) {
      savePendingConnections(pendingConnections);
      console.log('\nOpen each link in your browser to authorize.');
      console.log('When done, run: monte connect confirm');
    }
  });

connectCommands
  .command('confirm')
  .description('Verify all pending connections are active')
  .action(async () => {
    requireComposioKey();

    let binary: string;
    try {
      binary = findComposioBinary();
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }

    const pending = loadPendingConnections();

    if (pending.length === 0) {
      console.log('No pending connections. Run `monte connect` first.');
      return;
    }

    console.log('Checking connections...\n');

    let connectedCount = 0;
    const stillPending: PendingConnection[] = [];

    for (const conn of pending) {
      const status = await checkConnectionStatus(binary, conn.connectedAccountId);
      if (status === 'ACTIVE') {
        console.log(`  \u2713 ${conn.name} \u2014 connected`);
        connectedCount++;
      } else {
        console.log(`  \u2717 ${conn.name} \u2014 pending (open link to connect)`);
        stillPending.push(conn);
      }
    }

    console.log(`\n${connectedCount}/${pending.length} platforms connected.`);

    if (stillPending.length > 0) {
      savePendingConnections(stillPending);
      console.log('Run `monte connect confirm` again after connecting remaining platforms.');
    } else {
      savePendingConnections([]);
      console.log('\n\u2713 All platforms connected! Run `monte ingest` to pull data.');
    }
  });

connectCommands
  .command('status')
  .description('Show connected platforms')
  .action(async () => {
    requireComposioKey();

    let binary: string;
    try {
      binary = findComposioBinary();
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }

    const connections = await listActiveConnections(binary);

    if (connections.length === 0) {
      console.log('No connected platforms.');
      console.log('Run `monte connect` to connect data sources.');
      return;
    }

    console.log('\nConnected platforms:');
    for (const conn of connections) {
      console.log(`  \u2713 ${conn.appName} \u2014 connected`);
    }
  });
