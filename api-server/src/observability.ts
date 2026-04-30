import * as Sentry from '@sentry/node';
import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';
import { config } from './config.js';
import { logger } from './logger.js';

export const register = new Registry();

collectDefaultMetrics({ register });

export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['route', 'status'],
  registers: [register],
});

export const httpRequestDurationMs = new Histogram({
  name: 'http_request_duration_ms',
  help: 'HTTP request duration in ms',
  labelNames: ['route'],
  buckets: [10, 50, 100, 250, 500, 1000, 2500],
  registers: [register],
});

export const wsConnectionsTotal = new Counter({
  name: 'ws_connections_total',
  help: 'Total WebSocket connections',
  labelNames: ['platform'],
  registers: [register],
});

export const wsConnectionsActive = new Gauge({
  name: 'ws_connections_active',
  help: 'Active WebSocket connections',
  registers: [register],
});

export const pushesSentTotal = new Counter({
  name: 'pushes_sent_total',
  help: 'Total push notifications sent',
  labelNames: ['platform', 'result'],
  registers: [register],
});

export const pushSkipsTotal = new Counter({
  name: 'push_skips_total',
  help: 'Total push notifications skipped before sending',
  labelNames: ['reason'],
  registers: [register],
});

export const pushFailuresTotal = new Counter({
  name: 'push_failures_total',
  help: 'Total FCM push send failures by platform and error code',
  labelNames: ['platform', 'code'],
  registers: [register],
});

export function initSentry(): void {
  if (!config.SENTRY_DSN) {
    logger.info('Sentry DSN not configured, skipping Sentry initialization');
    return;
  }

  Sentry.init({
    dsn: config.SENTRY_DSN,
    environment: config.NODE_ENV,
    tracesSampleRate: 1.0,
  });

  logger.info('Sentry initialized');
}

export function captureException(e: unknown): void {
  if (config.SENTRY_DSN) {
    Sentry.captureException(e);
  }
  logger.error({ error: e }, 'unhandled exception');
}

export function captureMessage(message: string): void {
  if (config.SENTRY_DSN) {
    Sentry.captureMessage(message);
  }
}

export async function getMetrics(): Promise<string> {
  return register.metrics();
}

export function getContentType(): string {
  return register.contentType;
}
