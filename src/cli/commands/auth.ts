import { Command } from 'commander';
import { api } from '../api.js';
import { saveAuth, loadAuth, clearAuth, isAuthenticated } from '../config.js';

export const authCommands = new Command('auth')
  .description('Authentication commands');

authCommands
  .command('login')
  .description('Authenticate with Monte Engine')
  .requiredOption('-e, --email <email>', 'email address')
  .option('-p, --password <password>', 'password (will prompt if not provided)')
  .action(async (options) => {
    try {
      let password = options.password;
      if (!password) {
        // In a real CLI, we'd use inquirer or similar
        // For now, require it via option
        console.error('Error: Password required. Use -p flag or provide interactively.');
        process.exit(1);
      }

      const result = await api.login(options.email, password) as {
        userId: string;
        email: string;
        accessToken: string;
        refreshToken: string;
      };

      // Calculate expiry (default 15 minutes)
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

      saveAuth({
        userId: result.userId,
        email: result.email,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresAt,
      });

      console.log(`✓ Logged in as ${result.email}`);
    } catch (err) {
      console.error('Error:', (err as Error).message);
      process.exit(1);
    }
  });

authCommands
  .command('register')
  .description('Register a new account')
  .requiredOption('-e, --email <email>', 'email address')
  .requiredOption('-n, --name <name>', 'full name')
  .option('-p, --password <password>', 'password (min 8 chars)')
  .action(async (options) => {
    try {
      let password = options.password;
      if (!password) {
        console.error('Error: Password required. Use -p flag with at least 8 characters.');
        process.exit(1);
      }

      const result = await api.register(options.email, password, options.name) as {
        userId: string;
        email: string;
        accessToken: string;
        refreshToken: string;
      };

      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

      saveAuth({
        userId: result.userId,
        email: result.email,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresAt,
      });

      console.log(`✓ Registered and logged in as ${result.email}`);
    } catch (err) {
      console.error('Error:', (err as Error).message);
      process.exit(1);
    }
  });

authCommands
  .command('logout')
  .description('Log out and clear session')
  .action(() => {
    clearAuth();
    console.log('✓ Logged out');
  });

authCommands
  .command('status')
  .description('Check authentication status')
  .action(async () => {
    if (!isAuthenticated()) {
      console.log('Status: Not authenticated');
      console.log('Run `monte auth login` to authenticate');
      return;
    }

    const auth = loadAuth();
    try {
      const user = await api.me() as { email: string; name: string; personaStatus: string };
      console.log(`Status: Authenticated`);
      console.log(`User: ${user.name} (${user.email})`);
      console.log(`Persona: ${user.personaStatus}`);
    } catch {
      console.log(`Status: Session expired`);
      console.log('Run `monte auth login` to re-authenticate');
    }
  });

authCommands
  .command('whoami')
  .description('Show current user')
  .action(async () => {
    if (!isAuthenticated()) {
      console.log('Not authenticated');
      return;
    }

    try {
      const user = await api.me() as { email: string; name: string; id: string };
      console.log(`ID: ${user.id}`);
      console.log(`Name: ${user.name}`);
      console.log(`Email: ${user.email}`);
    } catch (err) {
      console.error('Error:', (err as Error).message);
    }
  });
