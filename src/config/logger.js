const winston = require('winston');
const { trace } = require('@opentelemetry/api');
const config = require('../config');

// Custom format to inject OTel trace context into every log line
const otelTraceFormat = winston.format((info) => {
    const activeSpan = trace.getActiveSpan();
    if (activeSpan) {
        const spanCtx = activeSpan.spanContext();
        info.trace_id = spanCtx.traceId;
        info.span_id = spanCtx.spanId;
        info.trace_flags = spanCtx.traceFlags;
    }
    return info;
});

const logger = winston.createLogger({
    level: config.server.logLevel,
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
        winston.format.errors({ stack: true }),
        otelTraceFormat(),
        config.server.env === 'production'
            ? winston.format.json()
            : winston.format.combine(
                winston.format.colorize(),
                winston.format.printf(({ timestamp, level, message, ...meta }) => {
                    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
                    return `${timestamp} [${level}]: ${message}${metaStr}`;
                })
            )
    ),
    transports: [
        new winston.transports.Console(),
    ],
    defaultMeta: { service: 'agentshield' },
});

module.exports = logger;
