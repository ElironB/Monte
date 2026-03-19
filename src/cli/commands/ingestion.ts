import { Command } from 'commander';
import { readFileSync } from 'fs';
import { api } from '../api.js';
import { requireAuth } from '../config.js';

export const ingestionCommands = new Command('ingest')
  .description('Data ingestion commands');

ingestionCommands
  .command('list')
  .description('List data sources')
  .action(async () => {
    requireAuth();
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
  .command('add')
  .description('Register a new data source')
  .requiredOption('-t, --type <type>', 'source type (obsidian, notion, file, composio)')
  .requiredOption('-n, --name <name>', 'source name')
  .option('-m, --metadata <json>', 'metadata as JSON string')
  .action(async (options) => {
    requireAuth();
    try {
      let metadata: Record<string, unknown> = {};
      if (options.metadata) {
        metadata = JSON.parse(options.metadata);
      }

      const result = await api.createDataSource(options.type, options.name, metadata) as {
        id: string;
        sourceType: string;
        name: string;
        status: string;
      };

      console.log(`✓ Data source created`);
      console.log(`  ID: ${result.id}`);
      console.log(`  Type: ${result.sourceType}`);
      console.log(`  Name: ${result.name}`);
      console.log(`  Status: ${result.status}`);
    } catch (err) {
      console.error('Error:', (err as Error).message);
      process.exit(1);
    }
  });

ingestionCommands
  .command('upload')
  .description('Upload files for ingestion')
  .argument('<files...>', 'file paths to upload')
  .action(async (files) => {
    requireAuth();
    try {
      const fileData = [];

      for (const filePath of files) {
        try {
          const content = readFileSync(filePath);
          const base64 = content.toString('base64');
          const filename = filePath.split('/').pop() || filePath;

          // Determine mimetype
          let mimetype = 'application/octet-stream';
          if (filename.endsWith('.txt')) mimetype = 'text/plain';
          else if (filename.endsWith('.json')) mimetype = 'application/json';
          else if (filename.endsWith('.csv')) mimetype = 'text/csv';
          else if (filename.endsWith('.md')) mimetype = 'text/markdown';

          fileData.push({ filename, content: base64, mimetype });
        } catch (err) {
          console.error(`Error reading file ${filePath}:`, (err as Error).message);
          continue;
        }
      }

      if (fileData.length === 0) {
        console.error('No valid files to upload');
        process.exit(1);
      }

      console.log(`Uploading ${fileData.length} file(s)...`);

      const result = await api.uploadFiles(fileData) as {
        sourceId: string;
        files: Array<{ filename: string }>;
        status: string;
      };

      console.log(`✓ Upload complete`);
      console.log(`  Source ID: ${result.sourceId}`);
      console.log(`  Files: ${result.files.map((f) => f.filename).join(', ')}`);
      console.log(`  Status: ${result.status}`);
      console.log('\nProcessing will begin automatically.');
    } catch (err) {
      console.error('Error:', (err as Error).message);
      process.exit(1);
    }
  });

ingestionCommands
  .command('status')
  .description('Check data source status')
  .argument('<id>', 'data source ID')
  .action(async (id) => {
    requireAuth();
    try {
      const status = await api.getDataSourceStatus(id) as {
        id: string;
        sourceType: string;
        name: string;
        status: string;
        progress: number;
        createdAt: string;
      };

      console.log(`\nData Source: ${status.id}`);
      console.log(`Name: ${status.name}`);
      console.log(`Type: ${status.sourceType}`);
      console.log(`Status: ${status.status}`);
      if (status.progress !== undefined) {
        console.log(`Progress: ${status.progress}%`);
      }
      console.log(`Created: ${new Date(status.createdAt).toLocaleString()}`);
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
    requireAuth();
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
