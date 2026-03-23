import { readFileSync, readdirSync, statSync } from 'fs';
import { basename, extname, join, resolve } from 'path';
import { api } from './api.js';

export const SUPPORTED_EXTENSIONS = new Set([
  '.json', '.csv', '.txt', '.md', '.pdf', '.docx',
  '.png', '.jpg', '.jpeg', '.gif', '.webp',
]);

const SKIP_DIRS = new Set([
  'node_modules', '.git', '__pycache__', '.DS_Store', '.obsidian',
]);

export interface DiscoveredFile {
  path: string;
  filename: string;
  extension: string;
  sourceType: string;
  mimetype: string;
}

export interface UploadProgressHooks {
  onGroupStart?: (sourceType: string, files: DiscoveredFile[]) => void;
  onBatchStart?: (sourceType: string, batchIndex: number, totalBatches: number, batchSize: number) => void;
  onBatchComplete?: (
    sourceType: string,
    batchIndex: number,
    totalBatches: number,
    batchSize: number,
    result: { sourceId: string; status: string },
  ) => void;
}

function walkDirectory(dirPath: string): DiscoveredFile[] {
  const files: DiscoveredFile[] = [];

  function walk(dir: string) {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      if (entry.startsWith('.') || SKIP_DIRS.has(entry)) {
        continue;
      }

      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        walk(fullPath);
        continue;
      }

      if (!stat.isFile()) {
        continue;
      }

      const ext = extname(entry).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.has(ext)) {
        continue;
      }

      files.push({
        path: fullPath,
        filename: basename(entry),
        extension: ext,
        sourceType: detectSourceType(fullPath, ext),
        mimetype: getMimetype(ext),
      });
    }
  }

  walk(dirPath);
  return files;
}

export function detectSourceType(filePath: string, ext: string): string {
  if (ext === '.md' || ext === '.txt') return 'notes';
  if (['.pdf', '.docx', '.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) return 'files';

  if (ext === '.json') {
    try {
      const content = readFileSync(filePath, 'utf-8').slice(0, 2000).toLowerCase();
      if (content.includes('mapping') && content.includes('message') && content.includes('author')) return 'ai_chat';
      if (content.includes('chat_messages') && content.includes('sender') && content.includes('human')) return 'ai_chat';
      if (content.includes('gemini') && content.includes('activitycontrols')) return 'ai_chat';
      if (content.includes('grok') && (content.includes('conversation') || content.includes('messages'))) return 'ai_chat';
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

export function resolveDiscoveredFiles(inputPath: string): { absolutePath: string; files: DiscoveredFile[]; isDirectory: boolean } {
  const absolutePath = resolve(inputPath);
  const stat = statSync(absolutePath);

  if (stat.isDirectory()) {
    return {
      absolutePath,
      files: walkDirectory(absolutePath),
      isDirectory: true,
    };
  }

  const ext = extname(absolutePath).toLowerCase();
  return {
    absolutePath,
    files: [{
      path: absolutePath,
      filename: basename(absolutePath),
      extension: ext,
      sourceType: detectSourceType(absolutePath, ext),
      mimetype: getMimetype(ext),
    }],
    isDirectory: false,
  };
}

export function groupDiscoveredFiles(files: DiscoveredFile[]): Map<string, DiscoveredFile[]> {
  const groups = new Map<string, DiscoveredFile[]>();

  for (const file of files) {
    const group = groups.get(file.sourceType) || [];
    group.push(file);
    groups.set(file.sourceType, group);
  }

  return groups;
}

export async function uploadDiscoveredFiles(
  groups: Map<string, DiscoveredFile[]>,
  hooks: UploadProgressHooks = {},
): Promise<void> {
  const batchSize = 10;

  for (const [sourceType, typeFiles] of groups) {
    hooks.onGroupStart?.(sourceType, typeFiles);

    const fileData = typeFiles.map((file) => ({
      filename: file.filename,
      content: readFileSync(file.path).toString('base64'),
      mimetype: file.mimetype,
    }));

    const totalBatches = Math.ceil(fileData.length / batchSize);
    for (let index = 0; index < fileData.length; index += batchSize) {
      const batchIndex = Math.floor(index / batchSize) + 1;
      const batch = fileData.slice(index, index + batchSize);
      hooks.onBatchStart?.(sourceType, batchIndex, totalBatches, batch.length);
      const result = await api.uploadFiles(batch, sourceType) as { sourceId: string; status: string };
      hooks.onBatchComplete?.(sourceType, batchIndex, totalBatches, batch.length, result);
    }
  }
}
