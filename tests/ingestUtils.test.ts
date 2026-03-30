import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../src/cli/api.js', () => ({
  api: {
    createDataSource: vi.fn(),
    uploadSourceFile: vi.fn(),
    finalizeDataSourceUpload: vi.fn(),
  },
}));

import { api } from '../src/cli/api.js';
import { resolveDiscoveredFiles, uploadDiscoveredFiles } from '../src/cli/ingestUtils.js';

describe('ingest utils', () => {
  let fixtureDir: string;

  beforeEach(() => {
    fixtureDir = mkdtempSync(join(tmpdir(), 'monte-ingest-'));
  });

  afterEach(() => {
    rmSync(fixtureDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  test('keeps text exports, skips media by default, and detects localized Gemini takeout JSON by schema', () => {
    writeFileSync(
      join(fixtureDir, 'הפעילותשלי.json'),
      JSON.stringify([{ activityControls: true, products: ['Gemini'], title: 'Used Gemini Apps - plan trip' }]),
      'utf-8',
    );
    writeFileSync(join(fixtureDir, 'notes.md'), '# reflection\nhello', 'utf-8');
    writeFileSync(join(fixtureDir, 'photo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const discovery = resolveDiscoveredFiles(fixtureDir);

    expect(discovery.files.map((file) => file.filename)).toEqual(expect.arrayContaining(['הפעילותשלי.json', 'notes.md']));
    expect(discovery.files.find((file) => file.filename === 'הפעילותשלי.json')?.sourceType).toBe('ai_chat');
    expect(discovery.files.some((file) => file.filename === 'photo.png')).toBe(false);
    expect(discovery.skipped.find((file) => file.filename === 'photo.png')?.reason).toContain('Skipped media by default');
  });

  test('uploads files one at a time through the new source session flow', async () => {
    writeFileSync(join(fixtureDir, 'notes.md'), '# reflection\nhello', 'utf-8');
    writeFileSync(join(fixtureDir, 'search.json'), JSON.stringify({ searches: [{ query: 'career change', timestamp: '2026-01-01T00:00:00Z' }] }), 'utf-8');
    const discovery = resolveDiscoveredFiles(fixtureDir);

    vi.mocked(api.createDataSource).mockResolvedValue({
      id: 'source-123',
      sourceType: 'mixed',
      name: 'fixture',
      status: 'pending',
    });
    vi.mocked(api.uploadSourceFile).mockResolvedValue({
      sourceId: 'source-123',
      fileId: 'file-1',
      status: 'pending',
      detectedSourceType: 'notes',
    });
    vi.mocked(api.finalizeDataSourceUpload).mockResolvedValue({
      id: 'source-123',
      status: 'processing',
    });

    const result = await uploadDiscoveredFiles(discovery, {
      sourceName: 'fixture',
    });

    expect(api.createDataSource).toHaveBeenCalledTimes(1);
    expect(api.uploadSourceFile).toHaveBeenCalledTimes(2);
    expect(api.finalizeDataSourceUpload).toHaveBeenCalledWith('source-123');
    expect(result.sourceId).toBe('source-123');
    expect(result.fileCount).toBe(2);
  });
});
