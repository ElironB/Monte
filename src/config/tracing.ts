import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { JaegerExporter } from '@opentelemetry/exporter-jaeger';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { trace, Span, context } from '@opentelemetry/api';
import { config } from './index.js';
import { logger } from '../utils/logger.js';

let sdk: NodeSDK | null = null;
let tracer = trace.getTracer('monte-engine');

export function initializeTracing(): void {
  if (config.tracing?.enabled !== true) {
    logger.info('OpenTelemetry tracing disabled');
    return;
  }

  const resource = new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: config.tracing.serviceName ?? 'monte-engine',
    [SemanticResourceAttributes.SERVICE_VERSION]: '0.1.0',
  });

  const jaegerExporter = new JaegerExporter({
    endpoint: config.tracing.jaegerEndpoint ?? 'http://localhost:14268/api/traces',
  });

  sdk = new NodeSDK({
    resource,
    traceExporter: jaegerExporter,
    instrumentations: [getNodeAutoInstrumentations()],
  });

  sdk.start();
  tracer = trace.getTracer('monte-engine');
  logger.info('OpenTelemetry tracing initialized');
}

export async function shutdownTracing(): Promise<void> {
  if (sdk) {
    await sdk.shutdown();
    logger.info('OpenTelemetry tracing shutdown');
  }
}

export function startSpan(name: string, attributes?: Record<string, unknown>): Span {
  return tracer.startSpan(name, undefined, context.active());
}

export function withSpan<T>(name: string, fn: () => Promise<T>, attributes?: Record<string, unknown>): Promise<T> {
  const span = startSpan(name, attributes);
  const ctx = trace.setSpan(context.active(), span);

  return context.with(ctx, async () => {
    try {
      const result = await fn();
      span.setStatus({ code: 1 }); // OK
      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: 2, message: (error as Error).message }); // ERROR
      throw error;
    } finally {
      span.end();
    }
  });
}

export function addSpanEvent(name: string, attributes?: Record<string, string | number | boolean>): void {
  const span = trace.getSpan(context.active());
  if (span) {
    span.addEvent(name, attributes);
  }
}

export function setSpanAttribute(key: string, value: unknown): void {
  const span = trace.getSpan(context.active());
  if (span) {
    span.setAttribute(key, value as string | number | boolean);
  }
}
