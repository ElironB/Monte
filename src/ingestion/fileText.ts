import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';

export type TextNormalizationStatus = 'ready' | 'skipped' | 'failed';

export interface TextNormalizationResult {
  status: TextNormalizationStatus;
  text: string;
  reason?: string;
}

const UTF8_TEXT_MIME_PREFIXES = ['text/'];
const UTF8_TEXT_MIME_TYPES = new Set([
  'application/json',
  'application/ld+json',
  'application/x-ndjson',
  'application/csv',
  'text/csv',
  'text/markdown',
  'application/xml',
  'text/xml',
]);

function normalizeText(text: string): string {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, '')
    .trim();
}

function isUtf8TextMimeType(mimetype: string): boolean {
  return UTF8_TEXT_MIME_TYPES.has(mimetype)
    || UTF8_TEXT_MIME_PREFIXES.some((prefix) => mimetype.startsWith(prefix));
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer });

  try {
    const result = await parser.getText();
    return normalizeText(result.text);
  } finally {
    await parser.destroy();
  }
}

async function extractDocxText(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return normalizeText(result.value);
}

export async function normalizeUploadedFileText(input: {
  filename: string;
  mimetype: string;
  buffer: Buffer;
}): Promise<TextNormalizationResult> {
  const mimetype = input.mimetype.toLowerCase();

  if (isUtf8TextMimeType(mimetype)) {
    return {
      status: 'ready',
      text: normalizeText(input.buffer.toString('utf-8')),
    };
  }

  if (mimetype === 'application/pdf') {
    try {
      const text = await extractPdfText(input.buffer);
      if (!text) {
        return {
          status: 'failed',
          text: '',
          reason: `No readable text could be extracted from PDF ${input.filename}.`,
        };
      }

      return { status: 'ready', text };
    } catch (err) {
      return {
        status: 'failed',
        text: '',
        reason: `Failed to extract PDF text from ${input.filename}: ${(err as Error).message}`,
      };
    }
  }

  if (mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    try {
      const text = await extractDocxText(input.buffer);
      if (!text) {
        return {
          status: 'failed',
          text: '',
          reason: `No readable text could be extracted from DOCX ${input.filename}.`,
        };
      }

      return { status: 'ready', text };
    } catch (err) {
      return {
        status: 'failed',
        text: '',
        reason: `Failed to extract DOCX text from ${input.filename}: ${(err as Error).message}`,
      };
    }
  }

  return {
    status: 'skipped',
    text: '',
    reason: `Unsupported file type for text normalization: ${mimetype || 'unknown'}.`,
  };
}
