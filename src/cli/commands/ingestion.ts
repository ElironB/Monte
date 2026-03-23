import chalk from 'chalk';
import { Command } from 'commander';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname, basename } from 'path';
import { api } from '../api.js';
import {
  dimText,
  icons,
  infoLabel,
  sectionHeader,
  statusColor,
  valueText,
  warningText,
} from '../styles.js';

const SUPPORTED_EXTENSIONS = new Set([
  '.json', '.csv', '.txt', '.md', '.pdf', '.docx',
  '.png', '.jpg', '.jpeg', '.gif', '.webp',
]);

const SKIP_DIRS = new Set([
  'node_modules', '.git', '__pycache__', '.DS_Store', '.obsidian',
]);

interface DiscoveredFile {
  path: string;
  filename: string;
  extension: string;
  sourceType: string;
  mimetype: string;
}

interface DataSourceListItem {
  id: string;
  sourceType: string;
  name: string;
  status: string;
  signalCount?: number;
  createdAt: string;
}

interface PaginatedDataSources {
  data: DataSourceListItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

function divider(width: number): string {
  return chalk.dim('─'.repeat(width));
}

function walkDirectory(dirPath: string): DiscoveredFile[] {
  const files: DiscoveredFile[] = [];

  function walk(dir: string) {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      if (entry.startsWith('.') || SKIP_DIRS.has(entry)) continue;

      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (stat.isFile()) {
        const ext = extname(entry).toLowerCase();
        if (!SUPPORTED_EXTENSIONS.has(ext)) continue;

        files.push({
          path: fullPath,
          filename: basename(entry),
          extension: ext,
          sourceType: detectSourceType(fullPath, ext),
          mimetype: getMimetype(ext),
        });
      }
    }
  }

  walk(dirPath);
  return files;
}

function detectSourceType(filePath: string, ext: string): string {
  if (ext === '.md' || ext === '.txt') return 'notes';
  if (['.pdf', '.docx', '.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) return 'files';

  if (ext === '.json') {
    try {
      const content = readFileSync(filePath, 'utf-8').slice(0, 2000).toLowerCase();
      if (content.includes('mapping') && content.includes('message') && content.includes('author')) return 'ai_chat'; // ChatGPT
      if (content.includes('chat_messages') && content.includes('sender') && content.includes('human')) return 'ai_chat'; // Claude
      if (content.includes('gemini') && content.includes('activitycontrols')) return 'ai_chat'; // Gemini Takeout
      if (content.includes('grok') && (content.includes('conversation') || content.includes('messages'))) return 'ai_chat'; // Grok
      if (content.includes('search') || content.includes('query')) return 'search_history';
      if (content.includes('watch') || content.includes('video') || content.includes('youtube')) return 'watch_history';
      if (content.includes('transaction') || content.includes('amount') || content.includes('balance')) return 'financial';
      if (content.includes('post') || content.includes('comment') || content.includes('subreddit') || content.includes('tweet')) return 'social_media';
    } catch {
      return 'files';
    }
    return 'files';
  }

  if (ext === '.csv') {
    try {
      const firstLine = readFileSync(filePath, 'utf-8').split('\n')[0].toLowerCase();
      if (firstLine.includes('amount') || firstLine.includes('transaction') || firstLine.includes('debit') || firstLine.includes('credit')) return 'financial';
    } catch {
      return 'files';
    }
    return 'files';
  }

  return 'files';
}

function getMimetype(ext: string): string {
  const mimeMap: Record<string, string> = {
    '.json': 'application/json',
    '.csv': 'text/csv',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
  };
  return mimeMap[ext] || 'application/octet-stream';
}

export const ingestionCommands = new Command('ingest')
  .description(chalk.dim('Ingest data files for persona building'));

ingestionCommands
  .argument('[path]', 'directory or file path to ingest')
  .description(chalk.dim('Scan a directory and ingest all supported files'))
  .action(async (path) => {
    if (!path) {
      console.error(`${icons.error} ${warningText('Usage: monte ingest <path>')}`);
      console.error(dimText('  e.g., monte ingest ./my-data'));
      console.error(dimText('  e.g., monte ingest .'));
      console.error(dimText('  or, for the bundled starter persona: monte example ingest starter'));
      process.exit(1);
    }

    try {
      const stat = statSync(path);
      let files: DiscoveredFile[];

      if (stat.isDirectory()) {
        console.log(`${infoLabel('Scanning directory:')} ${dimText(path)}`);
        files = walkDirectory(path);
      } else {
        const ext = extname(path).toLowerCase();
        files = [{
          path,
          filename: basename(path),
          extension: ext,
          sourceType: detectSourceType(path, ext),
          mimetype: getMimetype(ext),
        }];
        console.log(`${infoLabel('Inspecting file:')} ${dimText(path)}`);
      }

      if (files.length === 0) {
        console.log(dimText('No supported files found.'));
        return;
      }

      const groups = new Map<string, DiscoveredFile[]>();
      for (const file of files) {
        const group = groups.get(file.sourceType) || [];
        group.push(file);
        groups.set(file.sourceType, group);
      }

      console.log(`\n${sectionHeader('Discovered Files')}`);
      console.log(`  ${infoLabel('Total files:')} ${chalk.cyan.bold(files.length)}`);
      for (const [type, typeFiles] of groups) {
        console.log(`  ${infoLabel(`${type}:`)} ${chalk.cyan.bold(typeFiles.length)} ${dimText('file(s)')}`);
        for (const file of typeFiles.slice(0, 3)) {
          console.log(`    ${dimText(file.path)}`);
        }
        if (typeFiles.length > 3) {
          console.log(`    ${dimText(`...and ${typeFiles.length - 3} more`)}`);
        }
      }

      for (const [sourceType, typeFiles] of groups) {
        console.log(`\n${sectionHeader(`Uploading ${sourceType}`)}`);

        const fileData = typeFiles.map(f => ({
          filename: f.filename,
          content: readFileSync(f.path).toString('base64'),
          mimetype: f.mimetype,
        }));

        try {
          const BATCH_SIZE = 10;
          const totalBatches = Math.ceil(fileData.length / BATCH_SIZE);
          for (let i = 0; i < fileData.length; i += BATCH_SIZE) {
            const batchIndex = Math.floor(i / BATCH_SIZE) + 1;
            const batch = fileData.slice(i, i + BATCH_SIZE);
            process.stdout.write(`  ${infoLabel(`[${batchIndex}/${totalBatches}]`)} ${dimText(`Uploading ${batch.length} file(s)...`)}`);
            const result = await api.uploadFiles(batch, sourceType) as { sourceId: string; status: string };
            process.stdout.write(`\r  ${icons.success} ${chalk.green.bold(`Batch ${batchIndex}/${totalBatches}`)} ${dimText('→')} ${chalk.cyan(result.sourceId)} ${statusColor(result.status)}\n`);
          }
        } catch (err) {
          console.error(`  ${icons.error} ${(err as Error).message}`);
        }
      }

      console.log(`\n${icons.success} ${chalk.green.bold('Ingestion complete. Files are being processed.')}`);
      console.log(dimText('Run `monte ingest status` to check progress.'));
    } catch (err) {
      console.error(`${icons.error} ${(err as Error).message}`);
      process.exit(1);
    }
  });

ingestionCommands
  .command('status')
  .description(chalk.dim('Show ingestion status for all sources'))
  .action(async () => {
    try {
      const response = await api.listDataSources() as PaginatedDataSources;
      const sources = response.data;

      if (sources.length === 0) {
        console.log(dimText('No data sources found'));
        return;
      }

      console.log(`\n${sectionHeader('Data Sources')}`);
      console.log(divider(118));
      console.log(`${infoLabel('  ID'.padEnd(40))}${infoLabel('Type'.padEnd(18))}${infoLabel('Status'.padEnd(14))}${infoLabel('Signals'.padEnd(10))}${infoLabel('Name'.padEnd(24))}${infoLabel('Created')}`);
      console.log(divider(118));

      for (const source of sources) {
        const date = new Date(source.createdAt).toLocaleDateString();
        const signalCount = source.signalCount?.toString() || '0';
        console.log(
          `  ${dimText(source.id)}  ${chalk.white(source.sourceType.padEnd(15))}  ${statusColor(source.status, 12)}  ${chalk.cyan(signalCount.padStart(6))}    ${chalk.white.bold(source.name.slice(0, 20).padEnd(22))}  ${dimText(date)}`,
        );
      }

      const byStatus = sources.reduce((acc, source) => {
        acc[source.status] = (acc[source.status] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      console.log(`\n${sectionHeader('Summary')}`);
      for (const [status, count] of Object.entries(byStatus)) {
        console.log(`  ${statusColor(status)} ${valueText(count)}`);
      }
    } catch (err) {
      console.error(`${icons.error} ${(err as Error).message}`);
      process.exit(1);
    }
  });

ingestionCommands
  .command('list')
  .description(chalk.dim('List all data sources'))
  .action(async () => {
    try {
      const response = await api.listDataSources() as PaginatedDataSources;
      const sources = response.data;

      if (sources.length === 0) {
        console.log(dimText('No data sources found'));
        return;
      }

      console.log(`\n${sectionHeader('Data Sources')}`);
      console.log(divider(108));
      console.log(`${infoLabel('  ID'.padEnd(40))}${infoLabel('Type'.padEnd(15))}${infoLabel('Status'.padEnd(14))}${infoLabel('Name'.padEnd(24))}${infoLabel('Created')}`);
      console.log(divider(108));

      for (const source of sources) {
        const date = new Date(source.createdAt).toLocaleDateString();
        console.log(
          `  ${dimText(source.id)}  ${chalk.white(source.sourceType.padEnd(12))}  ${statusColor(source.status, 12)}  ${chalk.white.bold(source.name.slice(0, 20).padEnd(22))}  ${dimText(date)}`,
        );
      }

      console.log(`
${infoLabel('Page:')} ${valueText(`${response.pagination.page}/${Math.max(1, response.pagination.totalPages)}`)}`);
      console.log(`${infoLabel('Total:')} ${valueText(response.pagination.total)}`);
    } catch (err) {
      console.error(`${icons.error} ${(err as Error).message}`);
      process.exit(1);
    }
  });

ingestionCommands
  .command('delete')
  .description(chalk.dim('Delete a data source'))
  .argument('<id>', 'data source ID')
  .option('--force', 'skip confirmation', false)
  .action(async (id, options) => {
    try {
      if (!options.force) {
        console.log(`${icons.warning} ${warningText('Destructive action')}`);
        console.log(`  ${warningText('This will delete data source')} ${chalk.cyan(id)}`);
        console.log(`  ${dimText('This action cannot be undone. Use --force to confirm.')}`);
        process.exit(1);
      }

      await api.deleteDataSource(id);
      console.log(`${icons.success} ${chalk.green.bold('Data source deleted')}`);
    } catch (err) {
      console.error(`${icons.error} ${(err as Error).message}`);
      process.exit(1);
    }
  });
