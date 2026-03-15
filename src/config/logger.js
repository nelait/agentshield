const winston = require('winston');
const config = require('../config');

const logger = winston.createLogger({
    level: config.server.logLevel,
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
        winston.format.errors({ stack: true }),
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
