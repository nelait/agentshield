/**
 * OpenTelemetry SDK Bootstrap — AgentShield
 *
 * CRITICAL: This file MUST be loaded before all other imports
 * to ensure auto-instrumentation patches Express, pg, axios, ioredis.
 *
 * Loaded via: require('./config/tracing') at the top of src/index.js
 */

const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-http');
const { PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');
const { resourceFromAttributes } = require('@opentelemetry/resources');
const {
    ATTR_SERVICE_NAME,
    ATTR_SERVICE_VERSION,
} = require('@opentelemetry/semantic-conventions');
const { diag, DiagConsoleLogger, DiagLogLevel } = require('@opentelemetry/api');

// ─── Diagnostic logging (only in development) ───
const isDev = process.env.NODE_ENV !== 'production';
if (process.env.OTEL_LOG_LEVEL === 'debug') {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
}

// ─── Resource (service identity) ───
const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'agentshield',
    [ATTR_SERVICE_VERSION]: '0.1.0',
    'deployment.environment': process.env.NODE_ENV || 'development',
});

// ─── Trace Exporter ───
const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
const traceExporter = otlpEndpoint
    ? new OTLPTraceExporter({ url: `${otlpEndpoint}/v1/traces` })
    : isDev
        ? new (require('@opentelemetry/sdk-trace-node').ConsoleSpanExporter)()
        : new OTLPTraceExporter(); // defaults to http://localhost:4318/v1/traces

// ─── Metric Exporter ───
const metricExporter = otlpEndpoint
    ? new OTLPMetricExporter({ url: `${otlpEndpoint}/v1/metrics` })
    : null; // No metric export in dev without endpoint

const metricReader = metricExporter
    ? new PeriodicExportingMetricReader({
        exporter: metricExporter,
        exportIntervalMillis: parseInt(process.env.OTEL_METRICS_EXPORT_INTERVAL || '30000', 10),
    })
    : undefined;

// ─── Auto-Instrumentations ───
const instrumentations = getNodeAutoInstrumentations({
    // Express: capture route params as attributes
    '@opentelemetry/instrumentation-express': {
        enabled: true,
    },
    // HTTP: capture request/response headers (safe subset)
    '@opentelemetry/instrumentation-http': {
        enabled: true,
        requestHook: (span, request) => {
            // Add AgentShield trace ID if present
            if (request.headers && request.headers['x-trace-id']) {
                span.setAttribute('agentshield.trace_id', request.headers['x-trace-id']);
            }
        },
    },
    // pg: capture SQL queries (sanitized)
    '@opentelemetry/instrumentation-pg': {
        enabled: true,
        enhancedDatabaseReporting: false, // Don't log query parameters (PII safety)
    },
    // ioredis
    '@opentelemetry/instrumentation-ioredis': {
        enabled: true,
    },
    // Disable instrumentations we don't need
    '@opentelemetry/instrumentation-fs': { enabled: false },
    '@opentelemetry/instrumentation-dns': { enabled: false },
    '@opentelemetry/instrumentation-net': { enabled: false },
});

// ─── Initialize SDK ───
const sdk = new NodeSDK({
    resource,
    traceExporter,
    metricReader,
    instrumentations,
});

sdk.start();

// Log startup (can't use Winston here — it hasn't been loaded yet)
console.log(`[OTel] AgentShield tracing initialized (env: ${process.env.NODE_ENV || 'development'}, endpoint: ${otlpEndpoint || 'console'})`);

// ─── Graceful Shutdown ───
const shutdown = async () => {
    try {
        await sdk.shutdown();
        console.log('[OTel] SDK shut down successfully');
    } catch (err) {
        console.error('[OTel] Error shutting down SDK:', err);
    }
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

module.exports = { sdk, shutdown };
