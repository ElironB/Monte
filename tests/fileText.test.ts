import { describe, expect, test } from 'vitest';
import { normalizeUploadedFileText } from '../src/ingestion/fileText.js';

describe('uploaded file text normalization', () => {
  test('normalizes plain UTF-8 text content', async () => {
    const result = await normalizeUploadedFileText({
      filename: 'notes.md',
      mimetype: 'text/markdown',
      buffer: Buffer.from('\uFEFFHello\r\nworld'),
    });

    expect(result.status).toBe('ready');
    expect(result.text).toBe('Hello\nworld');
  });

  test('skips unsupported binary media', async () => {
    const result = await normalizeUploadedFileText({
      filename: 'image.png',
      mimetype: 'image/png',
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    });

    expect(result.status).toBe('skipped');
    expect(result.reason).toContain('Unsupported file type');
  });

  test('fails invalid PDF extraction with a clear reason', async () => {
    const result = await normalizeUploadedFileText({
      filename: 'broken.pdf',
      mimetype: 'application/pdf',
      buffer: Buffer.from('not-a-real-pdf'),
    });

    expect(result.status).toBe('failed');
    expect(result.reason).toContain('Failed to extract PDF text');
  });
});
