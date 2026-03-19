import { Command } from 'commander';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname, basename } from 'path';
import { api } from '../api.js';

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
  // For markdown/text files → notes
  if (ext === '.md' || ext === '.txt') return 'notes';

  // For images/PDFs → files
  if (['.pdf', '.docx', '.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) return 'files';

  // For JSON: try to peek at content to classify
  if (ext === '.json') {
    try {
      const content = readFileSync(filePath, 'utf-8').slice(0, 2000).toLowerCase();
      if (content.includes('search') || content.includes('query')) return 'search_history';
      if (content.includes('watch') || content.includes('video') || content.includes('youtube')) return 'watch_history';
      if (content.includes('transaction') || content.includes('amount') || content.includes('balance')) return 'financial';
      if (content.includes('post') || content.includes('comment') || content.includes('subreddit') || content.includes('tweet')) return 'social_media';
    } catch { /* fall through */ }
    return 'files';
  }

  // For CSV: check headers
  if (ext === '.csv') {
    try {
      const firstLine = readFileSync(filePath, 'utf-8').split('\n')[0].toLowerCase();
      if (firstLine.includes('amount') || firstLine.includes('transaction') || firstLine.includes('debit') || firstLine.includes('credit')) return 'financial';
    } catch { /* fall through */ }
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
  .description('Ingest data files for persona building');

ingestionCommands
  .argument('[path]', 'directory or file path to ingest')
  .description('Scan a directory and ingest all supported files')
  .action(async (path) => {
    requireAuth();

    if (!path) {
      console.error('Usage: monte ingest <path>');
      console.error('  e.g., monte ingest ./my-data');
      console.error('  e.g., monte ingest .');
      process.exit(1);
    }

    const stat = statSync(path);
    let files: DiscoveredFile[];

    if (stat.isDirectory()) {
      console.log(`Scanning ${path}...`);
      files = walkDirectory(path);
    } else {
      // Single file
      const ext = extname(path).toLowerCase();
      files = [{
        path,
        filename: basename(path),
        extension: ext,
        sourceType: detectSourceType(path, ext),
        mimetype: getMimetype(ext),
      }];
    }

    if (files.length === 0) {
      console.log('No supported files found.');
      return;
    }

    // Group by source type and show summary
    const groups = new Map<string, DiscoveredFile[]>();
    for (const file of files) {
      const group = groups.get(file.sourceType) || [];
      group.push(file);
      groups.set(file.sourceType, group);
    }

    console.log(`\nFound ${files.length} file(s):`);
    for (const [type, typeFiles] of groups) {
      console.log(`  ${type}: ${typeFiles.length} file(s)`);
    }
    console.log();

    // Upload each group
    for (const [sourceType, typeFiles] of groups) {
      console.log(`Uploading ${typeFiles.length} ${sourceType} file(s)...`);

      const fileData = typeFiles.map(f => ({
        filename: f.filename,
        content: readFileSync(f.path).toString('base64'),
        mimetype: f.mimetype,
      }));

      try {
        // Upload in batches of 10 to avoid huge payloads
        const BATCH_SIZE = 10;
        for (let i = 0; i < fileData.length; i += BATCH_SIZE) {
          const batch = fileData.slice(i, i + BATCH_SIZE);
          const result = await api.uploadFiles(batch, sourceType) as { sourceId: string; status: string };
          console.log(`  ✓ Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length} files → ${result.sourceId}`);
        }
      } catch (err) {
        console.error(`  ✗ Failed: ${(err as Error).message}`);
      }
    }

    console.log('\n✓ Ingestion complete. Files are being processed.');
    console.log('Run `monte ingest status` to check progress.');
  });

ingestionCommands
  .command('status')
  .description('Show ingestion status for all sources')
  .action(async () => {
    requireAuth();
    try {
      const sources = await api.listDataSources() as Array<{
        id: string;
        sourceType: string;
        name: string;
        status: string;
        signalCount: number;
        createdAt: string;
      }>;

      if (sources.length === 0) {
        console.log('No data sources found');
        return;
      }

      console.log('\nData Sources:');
      console.log('-'.repeat(100));
      console.log(`${'ID'.padEnd(36)} ${'Type'.padEnd(15)} ${'Status'.padEnd(12)} ${'Signals'.padEnd(8)} ${'Name'.padEnd(20)} Created`);
      console.log('-'.repeat(100));

      for (const source of sources) {
        const date = new Date(source.createdAt).toLocaleDateString();
        const signalCount = source.signalCount?.toString() || '0';
        console.log(
          `${source.id.padEnd(36)} ${source.sourceType.padEnd(15)} ${source.status.padEnd(12)} ${signalCount.padEnd(8)} ${source.name.slice(0, 18).padEnd(20)} ${date}`
        );
      }

      const byStatus = sources.reduce((acc, s) => {
        acc[s.status] = (acc[s.status] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      console.log('\nSummary:');
      for (const [status, count] of Object.entries(byStatus)) {
        console.log(`  ${status}: ${count}`);
      }
    } catch (err) {
      console.error('Error:', (err as Error).message);
      process.exit(1);
    }
  });

ingestionCommands
  .command('list')
  .description('List all data sources')
  .action(async () => {
    try {
      const sources = await api.listDataSources() as Array<{
        id: string;
        sourceType: string;
        name: string;
        status: string;
        createdAt: string;
      }>;

      if (sources.length === 0) {
        console.log('No data sources found');
        return;
      }

      console.log('\nData Sources:');
      console.log('-'.repeat(90));
      console.log(`${'ID'.padEnd(36)} ${'Type'.padEnd(12)} ${'Status'.padEnd(12)} ${'Name'.padEnd(20)} Created`);
      console.log('-'.repeat(90));

      for (const source of sources) {
        const date = new Date(source.createdAt).toLocaleDateString();
        console.log(
          `${source.id.padEnd(36)} ${source.sourceType.padEnd(12)} ${source.status.padEnd(12)} ${source.name.slice(0, 18).padEnd(20)} ${date}`
        );
      }
    } catch (err) {
      console.error('Error:', (err as Error).message);
      process.exit(1);
    }
  });

ingestionCommands
  .command('delete')
  .description('Delete a data source')
  .argument('<id>', 'data source ID')
  .option('--force', 'skip confirmation', false)
  .action(async (id, options) => {
    try {
      if (!options.force) {
        console.log(`This will delete data source ${id}`);
        console.log('This action cannot be undone. Use --force to confirm.');
        process.exit(1);
      }

      await api.deleteDataSource(id);
      console.log('✓ Data source deleted');
    } catch (err) {
      console.error('Error:', (err as Error).message);
      process.exit(1);
    }
  });
