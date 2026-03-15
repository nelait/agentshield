require('dotenv').config();

const config = {
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    env: process.env.NODE_ENV || 'development',
    logLevel: process.env.LOG_LEVEL || 'info',
  },

  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'agentshield',
    user: process.env.DB_USER || 'agentshield',
    password: process.env.DB_PASSWORD || 'agentshield_secret',
    ssl: process.env.DB_SSL === 'true',
    max: parseInt(process.env.DB_POOL_SIZE || '20', 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  },

  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret-change-me',
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },

  admin: {
    email: process.env.ADMIN_EMAIL || 'admin@agentshield.local',
    password: process.env.ADMIN_PASSWORD || 'admin123',
  },

  healthCheck: {
    intervalMs: parseInt(process.env.HEALTH_CHECK_INTERVAL_MS || '30000', 10),
    timeoutMs: parseInt(process.env.HEALTH_CHECK_TIMEOUT_MS || '5000', 10),
    unhealthyThreshold: parseInt(process.env.HEALTH_CHECK_UNHEALTHY_THRESHOLD || '3', 10),
  },

  compliance: {
    encryptionKey: process.env.COMPLIANCE_ENCRYPTION_KEY || '32-byte-encryption-key-change-me!',
    defaultRetentionDays: parseInt(process.env.COMPLIANCE_DEFAULT_RETENTION_DAYS || '2190', 10),
  },

  cost: {
    syncIntervalMs: parseInt(process.env.COST_SYNC_INTERVAL_MS || '60000', 10),
  },
};

module.exports = config;
