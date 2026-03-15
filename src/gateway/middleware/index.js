const { v4: uuidv4 } = require('uuid');
const logger = require('../../config/logger');
const auditService = require('../../audit/service');
const policyService = require('../../policy/service');
const costService = require('../../cost/service');
const complianceService = require('../../compliance/service');
const { RegistryService } = require('../../registry/service');
const jwt = require('jsonwebtoken');
const config = require('../../config');

// ============================================
// 1. Trace ID Middleware — assigns unique ID per request
// ============================================
function traceId(req, res, next) {
    req.traceId = req.headers['x-trace-id'] || uuidv4();
    req.startTime = Date.now();
    res.setHeader('X-Trace-Id', req.traceId);
    next();
}

// ============================================
// 2. Auth Middleware — validates JWT token
// ============================================
function authenticate(req, res, next) {
    // Skip auth for admin login and health endpoints
    const publicPaths = ['/api/v1/auth/login', '/api/v1/auth/refresh', '/health', '/ready'];
    if (publicPaths.some(p => req.path.startsWith(p))) {
        return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            success: false,
            error: 'Authentication required',
            code: 'AUTH_REQUIRED',
        });
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, config.jwt.secret);
        req.user = decoded;
        next();
    } catch (err) {
        const code = err.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN';
        return res.status(401).json({
            success: false,
            error: err.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token',
            code,
        });
    }
}

// ============================================
// 3. Policy Enforcement Middleware
// ============================================
function policyEnforcer(req, res, next) {
    // Only enforce on proxy/invoke calls
    if (!req.path.startsWith('/api/v1/gateway/')) {
        return next();
    }

    (async () => {
        try {
            const agentSlug = req.params.agentSlug;
            const workflowSlug = req.params.workflowSlug;

            let agent = null;
            let workflow = null;

            if (agentSlug) {
                try { agent = await RegistryService.getAgent(agentSlug); } catch (e) { /* skip */ }
            }

            const context = {
                user: req.user || {},
                agent: agent ? { slug: agent.slug, type: agent.type, name: agent.name, vendor: agent.vendor } : {},
                workflow: workflow ? { slug: workflow.slug, name: workflow.name } : {},
                action: 'invoke',
                timestamp: new Date().toISOString(),
            };

            const result = await policyService.evaluate(context);

            if (!result.allowed) {
                await auditService.log({
                    traceId: req.traceId,
                    eventType: 'policy_enforcement',
                    actorId: req.user?.id,
                    actorType: 'user',
                    resourceType: agentSlug ? 'agent' : 'workflow',
                    resourceId: agent?.id || null,
                    action: 'invoke',
                    outcome: 'denied',
                    details: { reason: result.reason, policy: result.matchedPolicy },
                    ipAddress: req.ip,
                });

                return res.status(403).json({
                    success: false,
                    error: 'Access denied by policy',
                    reason: result.reason,
                    code: 'POLICY_DENIED',
                });
            }

            req.policyResult = result;
            next();
        } catch (err) {
            logger.error('Policy evaluation error:', err);
            next(err);
        }
    })();
}

// ============================================
// 4. Budget Check Middleware
// ============================================
function budgetChecker(req, res, next) {
    if (!req.path.startsWith('/api/v1/gateway/')) {
        return next();
    }

    (async () => {
        try {
            const result = await costService.checkBudget(
                req.user?.id,
                req.user?.teamId,
                req.user?.departmentId
            );

            if (!result.allowed) {
                await auditService.log({
                    traceId: req.traceId,
                    eventType: 'budget_enforcement',
                    actorId: req.user?.id,
                    actorType: 'user',
                    action: 'invoke',
                    outcome: 'denied',
                    details: { reason: result.reason },
                    ipAddress: req.ip,
                });

                return res.status(402).json({
                    success: false,
                    error: 'Budget exceeded',
                    reason: result.reason,
                    code: 'BUDGET_EXCEEDED',
                });
            }

            next();
        } catch (err) {
            logger.error('Budget check error:', err);
            next(err);
        }
    })();
}

// ============================================
// 5. Compliance Sampler Middleware
// ============================================
function complianceSampler(req, res, next) {
    if (!req.path.startsWith('/api/v1/gateway/')) {
        return next();
    }

    // Capture response body for sampling
    const originalJson = res.json.bind(res);
    res.json = function (body) {
        res._body = body;

        // Async sampling — never blocks the response
        (async () => {
            try {
                const agentSlug = req.params.agentSlug;
                const agent = agentSlug ? await RegistryService.getAgent(agentSlug).catch(() => null) : null;

                const sampleDecision = await complianceService.shouldSample(
                    agent?.id,
                    null // workflowId
                );

                if (sampleDecision.shouldSample) {
                    await complianceService.storeSample({
                        configId: sampleDecision.configId,
                        traceId: req.traceId,
                        requestBody: JSON.stringify(req.body || {}),
                        responseBody: JSON.stringify(body),
                        agentId: agent?.id,
                        userId: req.user?.id,
                    });
                }
            } catch (err) {
                logger.error('Compliance sampling error (non-blocking):', err);
            }
        })();

        return originalJson(body);
    };

    next();
}

// ============================================
// 6. Audit Logger Middleware
// ============================================
function auditLogger(req, res, next) {
    // Log on response finish
    res.on('finish', () => {
        const latencyMs = Date.now() - req.startTime;
        const outcome = res.statusCode < 400 ? 'allowed' : (res.statusCode < 500 ? 'denied' : 'error');

        auditService.log({
            traceId: req.traceId,
            eventType: 'api_request',
            actorId: req.user?.id,
            actorType: req.user ? 'user' : 'anonymous',
            resourceType: req.params.agentSlug ? 'agent' : (req.params.workflowSlug ? 'workflow' : 'admin'),
            action: `${req.method} ${req.route?.path || req.path}`,
            outcome,
            details: {
                statusCode: res.statusCode,
                method: req.method,
                path: req.originalUrl,
            },
            ipAddress: req.ip,
            latencyMs,
        }).catch(() => { }); // Never fail on audit
    });

    next();
}

// ============================================
// Error Handler
// ============================================
function errorHandler(err, req, res, next) {
    const statusCode = err.statusCode || 500;
    const message = err.isOperational ? err.message : 'Internal server error';

    logger.error(`[${req.traceId}] Error ${statusCode}: ${err.message}`, {
        stack: err.stack,
        path: req.originalUrl,
    });

    res.status(statusCode).json({
        success: false,
        error: message,
        code: err.code || 'INTERNAL_ERROR',
        traceId: req.traceId,
    });
}

module.exports = {
    traceId,
    authenticate,
    policyEnforcer,
    budgetChecker,
    complianceSampler,
    auditLogger,
    errorHandler,
};
