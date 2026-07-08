// OTel — must initialize before all other imports for auto-instrumentation
const { shutdown: otelShutdown } = require('./config/tracing');

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');

const config = require('./config');
const logger = require('./config/logger');
const db = require('./db');

// Route imports
const agentRoutes = require('./registry/routes');
const adminRoutes = require('./admin/routes');
const gatewayRoutes = require('./gateway/proxy');
const mcpProxyRoutes = require('./gateway/mcp-proxy');
const reportRoutes = require('./reports/routes');

// Middleware imports
const {
    traceId,
    authenticate,
    policyEnforcer,
    budgetChecker,
    guardrailEnforcer,
    complianceSampler,
    auditLogger,
    errorHandler,
} = require('./gateway/middleware');

// Health checker
const healthChecker = require('./registry/health');

const app = express();

// ============================================
// Global Middleware
// ============================================
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(morgan('short', {
    stream: { write: (msg) => logger.info(msg.trim()) },
}));

// ============================================
// Firewall Middleware Chain (order matters!)
// ============================================
app.use(traceId);            // 1. Assign trace ID
app.use(authenticate);       // 2. Validate JWT
app.use(auditLogger);        // 3. Audit log (on response finish)
app.use(policyEnforcer);     // 4. Enforce access policies
app.use(budgetChecker);      // 5. Check cost/token budgets
app.use(guardrailEnforcer);  // 5.5. Enforce guardrails on input
app.use(complianceSampler);  // 6. Sample for compliance

// ============================================
// Health / Readiness Endpoints
// ============================================
app.get('/health', async (req, res) => {
    const dbHealth = await db.healthCheck();
    const status = dbHealth.status === 'healthy' ? 200 : 503;
    res.status(status).json({
        status: dbHealth.status === 'healthy' ? 'healthy' : 'unhealthy',
        service: 'agentshield',
        version: '0.1.0',
        uptime: process.uptime(),
        database: dbHealth,
    });
});

app.get('/ready', (req, res) => {
    res.json({ ready: true });
});

// ============================================
// API Routes
// ============================================
app.use('/api/v1/agents', agentRoutes);          // Agent Registry
app.use('/api/v1', adminRoutes);                  // Admin API (policies, workflows, budgets, etc.)
app.use('/api/v1/gateway', gatewayRoutes);       // Gateway Proxy (agent invocation, workflows)
app.use('/mcp', mcpProxyRoutes);                 // MCP Protocol Proxy (native MCP for Claude Desktop, Cursor, etc.)
app.use('/api/v1/reports', reportRoutes);         // Reports Engine

// ============================================
// 404 Handler
// ============================================
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Not found',
        path: req.originalUrl,
    });
});

// ============================================
// Error Handler
// ============================================
app.use(errorHandler);

// ============================================
// Start Server
// ============================================
async function start() {
    try {
        // Check database connection
        const dbHealth = await db.healthCheck();
        if (dbHealth.status !== 'healthy') {
            logger.warn('Database is not reachable. Server will start but DB features will fail.');
        } else {
            logger.info('Database connected successfully');
        }

        // Start the HTTP server
        app.listen(config.server.port, () => {
            logger.info('='.repeat(60));
            logger.info('  🛡️  AgentShield — Agent Governance Firewall');
            logger.info(`  Environment: ${config.server.env}`);
            logger.info(`  Listening on: http://localhost:${config.server.port}`);
            logger.info('  Endpoints:');
            logger.info(`    Health:    http://localhost:${config.server.port}/health`);
            logger.info(`    Admin:     http://localhost:${config.server.port}/api/v1/dashboard`);
            logger.info(`    Agents:    http://localhost:${config.server.port}/api/v1/agents`);
            logger.info(`    Gateway:   http://localhost:${config.server.port}/api/v1/gateway/agents/:slug/invoke`);
            logger.info(`    MCP Proxy: http://localhost:${config.server.port}/mcp/:agentSlug`);
            logger.info('='.repeat(60));
        });

        // Start background health checker
        healthChecker.start();

        // Graceful shutdown
        const shutdown = async (signal) => {
            logger.info(`${signal} received. Shutting down gracefully...`);
            healthChecker.stop();
            await otelShutdown();
            await db.close();
            process.exit(0);
        };

        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));

    } catch (err) {
        logger.error('Failed to start server:', err);
        process.exit(1);
    }
}

start();

module.exports = app;
