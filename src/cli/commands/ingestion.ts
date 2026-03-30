import chalk from 'chalk';
import { Command } from 'commander';
import { basename } from 'path';
import { api } from '../api.js';
import {
  DiscoveredFile,
  resolveDiscoveredFiles,
  SkippedFile,
  uploadDiscoveredFiles,
} from '../ingestUtils.js';
import {
  dimText,
  icons,
  infoLabel,
  sectionHeader,
  statusColor,
  valueText,
  warningText,
} from '../styles.js';

interface DataSourceListItem {
  id: string;
  sourceType: string;
  name: string;
  status: string;
  signalCount: number;
  fileCount: number;
  uploadedFileCount: number;
  completedFileCount: number;
  skippedFileCount: number;
  failedFileCount: number;
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

function groupBySourceType(files: DiscoveredFile[]): Array<[string, DiscoveredFile[]]> {
  const groups = new Map<string, DiscoveredFile[]>();

  for (const file of files) {
    const group = groups.get(file.sourceType) ?? [];
    group.push(file);
    groups.set(file.sourceType, group);
  }

  return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
}

function groupSkippedByReason(files: SkippedFile[]): Array<[string, SkippedFile[]]> {
  const groups = new Map<string, SkippedFile[]>();

  for (const file of files) {
    const group = groups.get(file.reason) ?? [];
    group.push(file);
    groups.set(file.reason, group);
  }

  return Array.from(groups.entries()).sort((a, b) => b[1].length - a[1].length);
}

function renderDiscoverySummary(files: DiscoveredFile[], skipped: SkippedFile[]): void {
  console.log(`\n${sectionHeader('Discovery Summary')}`);
  console.log(`  ${infoLabel('Included files:')} ${valueText(files.length)}`);
  console.log(`  ${infoLabel('Skipped files:')} ${valueText(skipped.length)}`);

  if (files.length > 0) {
    console.log(`\n${sectionHeader('Included By Type')}`);
    for (const [sourceType, group] of groupBySourceType(files)) {
      console.log(`  ${infoLabel(`${sourceType}:`)} ${valueText(group.length)}`);
      for (const file of group.slice(0, 3)) {
        console.log(`    ${dimText(file.relativePath)}`);
      }
      if (group.length > 3) {
        console.log(`    ${dimText(`...and ${group.length - 3} more`)}`);
      }
    }
  }

  if (skipped.length > 0) {
    console.log(`\n${sectionHeader('Skipped')}`);
    for (const [reason, group] of groupSkippedByReason(skipped)) {
      console.log(`  ${warningText(reason)} ${dimText(`(${group.length})`)}`);
      for (const file of group.slice(0, 2)) {
        console.log(`    ${dimText(file.relativePath)}`);
      }
      if (group.length > 2) {
        console.log(`    ${dimText(`...and ${group.length - 2} more`)}`);
      }
    }
  }
}

export const ingestionCommands = new Command('ingest')
  .description(chalk.dim('Ingest data files for persona building'));

ingestionCommands
  .argument('[path]', 'directory or file path to ingest')
  .description(chalk.dim('Scan a path, preview what matters, and upload files one at a time'))
  .option('--dry-run', 'preview what will be uploaded without sending anything', false)
  .option('--include-media', 'include media files even though Monte v1 does not analyze images/video', false)
  .option('--name <name>', 'override the logical source name shown in Monte')
  .action(async (path, options: { dryRun?: boolean; includeMedia?: boolean; name?: string }) => {
    if (!path) {
      console.error(`${icons.error} ${warningText('Usage: monte ingest <path>')}`);
      console.error(dimText('  e.g., monte ingest ./my-data'));
      console.error(dimText('  e.g., monte ingest . --dry-run'));
      console.error(dimText('  or, for the bundled starter persona: monte example ingest starter'));
      process.exit(1);
    }

    try {
      const discovery = resolveDiscoveredFiles(path, {
        includeMedia: options.includeMedia,
      });

      console.log(`${infoLabel(discovery.isDirectory ? 'Scanning directory:' : 'Inspecting file:')} ${dimText(discovery.absolutePath)}`);
      renderDiscoverySummary(discovery.files, discovery.skipped);

      if (discovery.files.length === 0) {
        console.log(`\n${warningText('No files qualified for ingestion.')}`);
        return;
      }

      if (options.dryRun) {
        console.log(`\n${icons.success} ${chalk.green.bold('Dry run complete')}`);
        return;
      }

      const sourceName = options.name?.trim() || basename(discovery.absolutePath);
      const uploadResult = await uploadDiscoveredFiles(discovery, {
        sourceName,
        metadata: {
          dryRunPreviewSkippedCount: discovery.skipped.length,
        },
        hooks: {
          onSourceCreated: (source) => {
            console.log(`\n${sectionHeader('Uploading Source')}`);
            console.log(`  ${infoLabel('Source ID:')} ${chalk.cyan(source.sourceId)}`);
            console.log(`  ${infoLabel('Name:')} ${valueText(source.name)}`);
            console.log(`  ${infoLabel('Type:')} ${valueText(source.sourceType)}`);
          },
          onFileStart: (file, index, total) => {
            process.stdout.write(`  ${infoLabel(`[${index}/${total}]`)} ${dimText(`Uploading ${file.relativePath}...`)}`);
          },
          onFileComplete: (file, index, total, result) => {
            process.stdout.write(`\r  ${icons.success} ${chalk.green.bold(`File ${index}/${total}`)} ${dimText('→')} ${chalk.cyan(result.fileId)} ${statusColor(result.status)} ${dimText(file.relativePath)}\n`);
          },
          onFinalize: (result) => {
            console.log(`\n${sectionHeader('Upload Finalized')}`);
            console.log(`  ${infoLabel('Source ID:')} ${chalk.cyan(result.sourceId)}`);
            console.log(`  ${infoLabel('Status:')} ${statusColor(result.status)}`);
          },
        },
      });

      console.log(`\n${icons.success} ${chalk.green.bold('Ingestion upload complete')}`);
      console.log(`  ${infoLabel('Source ID:')} ${chalk.cyan(uploadResult.sourceId)}`);
      console.log(`  ${infoLabel('Files queued:')} ${valueText(uploadResult.fileCount)}`);
      console.log(`  ${infoLabel('Source status:')} ${statusColor(uploadResult.status)}`);
      console.log(`  ${dimText('Run `monte ingest status` to watch per-source progress.')}`);
    } catch (err) {
      console.error(`${icons.error} ${(err as Error).message}`);
      process.exit(1);
    }
  });

ingestionCommands
  .command('status')
  .description(chalk.dim('Show ingestion status for all logical sources'))
  .action(async () => {
    try {
      const response = await api.listDataSources() as PaginatedDataSources;
      const sources = response.data;

      if (sources.length === 0) {
        console.log(dimText('No data sources found'));
        return;
      }

      console.log(`\n${sectionHeader('Data Sources')}`);
      console.log(divider(150));
      console.log(`${infoLabel('  ID'.padEnd(40))}${infoLabel('Type'.padEnd(12))}${infoLabel('Status'.padEnd(12))}${infoLabel('Files'.padEnd(9))}${infoLabel('Done'.padEnd(9))}${infoLabel('Skip'.padEnd(9))}${infoLabel('Fail'.padEnd(9))}${infoLabel('Signals'.padEnd(10))}${infoLabel('Name'.padEnd(26))}${infoLabel('Created')}`);
      console.log(divider(150));

      for (const source of sources) {
        const date = new Date(source.createdAt).toLocaleDateString();
        console.log(
          `  ${dimText(source.id)}  ${chalk.white(source.sourceType.padEnd(9))}  ${statusColor(source.status, 10)}  ${chalk.cyan(String(source.fileCount).padStart(5))}    ${chalk.green(String(source.completedFileCount).padStart(5))}    ${chalk.yellow(String(source.skippedFileCount).padStart(5))}    ${chalk.red(String(source.failedFileCount).padStart(5))}    ${chalk.cyan(String(source.signalCount).padStart(6))}    ${chalk.white.bold(source.name.slice(0, 22).padEnd(24))}  ${dimText(date)}`,
        );
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
      console.log(divider(132));
      console.log(`${infoLabel('  ID'.padEnd(40))}${infoLabel('Type'.padEnd(12))}${infoLabel('Status'.padEnd(12))}${infoLabel('Files'.padEnd(9))}${infoLabel('Signals'.padEnd(10))}${infoLabel('Name'.padEnd(28))}${infoLabel('Created')}`);
      console.log(divider(132));

      for (const source of sources) {
        const date = new Date(source.createdAt).toLocaleDateString();
        console.log(
          `  ${dimText(source.id)}  ${chalk.white(source.sourceType.padEnd(9))}  ${statusColor(source.status, 10)}  ${chalk.cyan(String(source.fileCount).padStart(5))}    ${chalk.cyan(String(source.signalCount).padStart(6))}    ${chalk.white.bold(source.name.slice(0, 24).padEnd(26))}  ${dimText(date)}`,
        );
      }

      console.log(`\n${infoLabel('Page:')} ${valueText(`${response.pagination.page}/${Math.max(1, response.pagination.totalPages)}`)}`);
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
