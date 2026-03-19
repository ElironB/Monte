import { Client } from 'minio';
import { config } from './index.js';
import { logger } from '../utils/logger.js';

let minioClient: Client | null = null;

export function getMinioClient(): Client {
  if (!minioClient) {
    minioClient = new Client({
      endPoint: config.minio.endpoint,
      port: config.minio.port,
      useSSL: config.minio.useSSL,
      accessKey: config.minio.accessKey,
      secretKey: config.minio.secretKey,
    });
    logger.info('MinIO client initialized');
  }
  return minioClient;
}

export async function uploadFile(objectName: string, buffer: Buffer, contentType?: string): Promise<string> {
  const client = getMinioClient();
  const bucket = config.minio.bucket;
  
  const exists = await client.bucketExists(bucket);
  if (!exists) await client.makeBucket(bucket);
  
  await client.putObject(bucket, objectName, buffer, buffer.length, {
    'Content-Type': contentType ?? 'application/octet-stream',
  });
  
  return `${config.minio.useSSL ? 'https' : 'http'}://${config.minio.endpoint}:${config.minio.port}/${bucket}/${objectName}`;
}

export async function getFile(objectName: string): Promise<Buffer> {
  const client = getMinioClient();
  const stream = await client.getObject(config.minio.bucket, objectName);
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}
