import { readFileSync, readdirSync, statSync } from 'fs';
import { basename, extname, join, relative, resolve } from 'path';
import { api } from './api.js';

export const DOCUMENT_EXTENSIONS = new Set([
  '.json',
  '.csv',
  '.txt',
  '.md',
  '.pdf',
  '.docx',
]);

export const MEDIA_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
]);

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '__pycache__',
  '.DS_Store',
  '.obsidian',
]);

export interface DiscoveredFile {
  path: string;
  relativePath: string;
  filename: string;
  extension: string;
  sourceType: string;
  mimetype: string;
  sizeBytes: number;
}

export interface SkippedFile {
  path: string;
  relativePath: string;
  filename: string;
  extension: string;
  reason: string;
}

export interface UploadProgressHooks {
  onSourceCreated?: (source: { sourceId: string; sourceType: string; name: string }, files: DiscoveredFile[]) => void;
  onFileStart?: (file: DiscoveredFile, index: number, total: number) => void;
  onFileComplete?: (
    file: DiscoveredFile,
    index: number,
    total: number,
    result: { sourceId: string; fileId: string; status: string; detectedSourceType: string },
  ) => void;
  onFinalize?: (result: { sourceId: string; status: string }) => void;
}

export interface DiscoveryOptions {
  excludeFilenames?: string[];
  includeMedia?: boolean;
}

export interface DiscoveryResult {
  absolutePath: string;
  files: DiscoveredFile[];
  skipped: SkippedFile[];
  isDirectory: boolean;
}

function isHiddenEntry(entry: string): boolean {
  return entry.startsWith('.');
}

function readTextPreview(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf-8').slice(0, 4000).toLowerCase();
  } catch {
    return '';
  }
}

function looksLikeChatGptExport(content: string): boolean {
  return content.includes('mapping') && content.includes('message') && content.includes('author');
}

function looksLikeClaudeExport(content: string): boolean {
  return content.includes('chat_messages') && content.includes('sender') && content.includes('human');
}

function looksLikeGeminiActivityExport(content: string): boolean {
  return content.includes('activitycontrols') && content.includes('products');
}

function looksLikeGrokExport(content: string): boolean {
  return content.includes('grok') && (content.includes('conversation') || content.includes('messages'));
}

export function detectSourceType(filePath: string, ext: string): string {
  if (ext === '.md' || ext === '.txt') {
    return 'notes';
  }

  if (ext === '.pdf' || ext === '.docx') {
    return 'files';
  }

  if (MEDIA_EXTENSIONS.has(ext)) {
    return 'files';
  }

  if (ext === '.json') {
    const content = readTextPreview(filePath);

    if (looksLikeChatGptExport(content) || looksLikeClaudeExport(content) || looksLikeGeminiActivityExport(content) || looksLikeGrokExport(content)) {
      return 'ai_chat';
    }
    if (content.includes('search') || content.includes('query')) {
      return 'search_history';
    }
    if (content.includes('watch') || content.includes('video') || content.includes('youtube')) {
      return 'watch_history';
    }
    if (content.includes('transaction') || content.includes('amount') || content.includes('balance')) {
      return 'financial';
    }
    if (content.includes('post') || content.includes('comment') || content.includes('subreddit') || content.includes('tweet')) {
      return 'social_media';
    }

    return 'files';
  }

  if (ext === '.csv') {
    const firstLine = readTextPreview(filePath).split('\n')[0] ?? '';
    if (firstLine.includes('amount') || firstLine.includes('transaction') || firstLine.includes('debit') || firstLine.includes('credit')) {
      return 'financial';
    }

    return 'files';
  }

  return 'files';
}

export function getMimetype(ext: string): string {
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

function classifyPath(
  absolutePath: string,
  rootPath: string,
  options: DiscoveryOptions,
): { include: true; file: DiscoveredFile } | { include: false; skipped: SkippedFile } {
  const extension = extname(absolutePath).toLowerCase();
  const filename = basename(absolutePath);
  const relativePath = relative(rootPath, absolutePath) || filename;
  const sizeBytes = statSync(absolutePath).size;

  if (options.excludeFilenames?.includes(filename)) {
    return {
      include: false,
      skipped: {
        path: absolutePath,
        relativePath,
        filename,
        extension,
        reason: 'Excluded by CLI option.',
      },
    };
  }

  if (DOCUMENT_EXTENSIONS.has(extension)) {
    return {
      include: true,
      file: {
        path: absolutePath,
        relativePath,
        filename,
        extension,
        sourceType: detectSourceType(absolutePath, extension),
        mimetype: getMimetype(extension),
        sizeBytes,
      },
    };
  }

  if (MEDIA_EXTENSIONS.has(extension)) {
    if (!options.includeMedia) {
      return {
        include: false,
        skipped: {
          path: absolutePath,
          relativePath,
          filename,
          extension,
          reason: 'Skipped media by default. Re-run with --include-media to upload anyway.',
        },
      };
    }

    return {
      include: true,
      file: {
        path: absolutePath,
        relativePath,
        filename,
        extension,
        sourceType: 'files',
        mimetype: getMimetype(extension),
        sizeBytes,
      },
    };
  }

  return {
    include: false,
    skipped: {
      path: absolutePath,
      relativePath,
      filename,
      extension,
      reason: 'Unsupported extension for v1 ingestion.',
    },
  };
}

function walkDirectory(rootPath: string, options: DiscoveryOptions): Pick<DiscoveryResult, 'files' | 'skipped'> {
  const files: DiscoveredFile[] = [];
  const skipped: SkippedFile[] = [];

  function walk(currentPath: string) {
    const entries = readdirSync(currentPath);
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry)) {
        skipped.push({
          path: join(currentPath, entry),
          relativePath: relative(rootPath, join(currentPath, entry)) || entry,
          filename: entry,
          extension: '',
          reason: 'Skipped system or tooling directory.',
        });
        continue;
      }

      if (isHiddenEntry(entry)) {
        skipped.push({
          path: join(currentPath, entry),
          relativePath: relative(rootPath, join(currentPath, entry)) || entry,
          filename: entry,
          extension: extname(entry).toLowerCase(),
          reason: 'Skipped hidden file or directory.',
        });
        continue;
      }

      const fullPath = join(currentPath, entry);
      const stats = statSync(fullPath);

      if (stats.isDirectory()) {
        walk(fullPath);
        continue;
      }

      if (!stats.isFile()) {
        continue;
      }

      const classified = classifyPath(fullPath, rootPath, options);
      if (classified.include) {
        files.push(classified.file);
      } else {
        skipped.push(classified.skipped);
      }
    }
  }

  walk(rootPath);
  return { files, skipped };
}

export function resolveDiscoveredFiles(
  inputPath: string,
  options: DiscoveryOptions = {},
): DiscoveryResult {
  const absolutePath = resolve(inputPath);
  const stats = statSync(absolutePath);

  if (stats.isDirectory()) {
    const walked = walkDirectory(absolutePath, options);
    return {
      absolutePath,
      files: walked.files,
      skipped: walked.skipped,
      isDirectory: true,
    };
  }

  const classified = classifyPath(absolutePath, absolutePath, options);
  return {
    absolutePath,
    files: classified.include ? [classified.file] : [],
    skipped: classified.include ? [] : [classified.skipped],
    isDirectory: false,
  };
}

export async function uploadDiscoveredFiles(
  discovery: DiscoveryResult,
  options: {
    sourceName?: string;
    metadata?: Record<string, unknown>;
    hooks?: UploadProgressHooks;
  } = {},
): Promise<{ sourceId: string; status: string; fileCount: number }> {
  if (discovery.files.length === 0) {
    throw new Error('No files available to upload.');
  }

  const distinctSourceTypes = Array.from(new Set(discovery.files.map((file) => file.sourceType)));
  const sourceType = distinctSourceTypes.length === 1 ? distinctSourceTypes[0] : 'mixed';
  const name = options.sourceName ?? basename(discovery.absolutePath);
  const source = await api.createDataSource(
    sourceType,
    name,
    {
      rootPath: discovery.absolutePath,
      includedSourceTypes: distinctSourceTypes,
      skippedFileCount: discovery.skipped.length,
      ...options.metadata,
    },
    discovery.files.length,
  ) as { id: string; sourceType: string; name: string };

  options.hooks?.onSourceCreated?.({
    sourceId: source.id,
    sourceType: source.sourceType,
    name: source.name,
  }, discovery.files);

  for (let index = 0; index < discovery.files.length; index++) {
    const file = discovery.files[index];
    options.hooks?.onFileStart?.(file, index + 1, discovery.files.length);

    const buffer = readFileSync(file.path);
    const result = await api.uploadSourceFile(source.id, {
      filename: file.filename,
      mimetype: file.mimetype,
      buffer,
      originalPath: file.relativePath,
      detectedSourceType: file.sourceType,
    }) as {
      sourceId: string;
      fileId: string;
      status: string;
      detectedSourceType: string;
    };

    options.hooks?.onFileComplete?.(file, index + 1, discovery.files.length, result);
  }

  const finalized = await api.finalizeDataSourceUpload(source.id) as { id?: string; status: string };
  options.hooks?.onFinalize?.({
    sourceId: source.id,
    status: finalized.status,
  });

  return {
    sourceId: source.id,
    status: finalized.status,
    fileCount: discovery.files.length,
  };
}
