import { describe, expect, test } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { extractMultipartUpload } from '../src/api/routes/ingestion.js';

describe('multipart upload extraction', () => {
  test('buffers the file part before later fields can drain the stream', async () => {
    let drained = false;
    const originalBuffer = Buffer.from('hello from multipart');

    const request = {
      parts: async function * () {
        yield {
          type: 'file',
          filename: 'notes.md',
          mimetype: 'text/markdown',
          toBuffer: async () => (drained ? Buffer.alloc(0) : originalBuffer),
        };

        drained = true;

        yield {
          type: 'field',
          fieldname: 'originalPath',
          value: 'exports/notes.md',
        };

        yield {
          type: 'field',
          fieldname: 'detectedSourceType',
          value: 'notes',
        };
      },
    } as unknown as FastifyRequest;

    const upload = await extractMultipartUpload(request);

    expect(upload.file.filename).toBe('notes.md');
    expect(upload.file.mimetype).toBe('text/markdown');
    expect(upload.file.buffer.equals(originalBuffer)).toBe(true);
    expect(upload.fields).toEqual({
      originalPath: 'exports/notes.md',
      detectedSourceType: 'notes',
    });
  });
});
