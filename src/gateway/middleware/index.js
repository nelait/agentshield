const { v4: uuidv4 } = require('uuid');
const logger = require('../../config/logger');
const auditService = require('../../audit/service');
const policyService = require('../../policy/service');
const costService = require('../../cost/service');
const complianceService = require('../../compliance/service');
const guardrailsService = require('../../guardrails/service');
const { RegistryService } = require('../../registry/service');
const jwt = require('jsonwebtoken');
const config = require('../../config');
const apiKeyService = require('../../apikeys/service');
const settingsService = require('../../settings/service');

// ─── OpenTelemetry ───
const { trace, SpanStatusCode, metrics } = require('@opentelemetry/api');
const tracer = trace.getTracer('agentshield.middleware', '0.1.0');
const meter = metrics.getMeter('agentshield.middleware', '0.1.0');

// ─── Middleware Metrics ───
const policyDecisionCounter = meter.createCounter('agentshield.policy.decisions', {
    description: 'Policy evaluation outcomes',
});
const policyDenialCounter = meter.createCounter('agentshield.policy.denials', {
    description: 'Policy denial count',
});
const authFailureCounter = meter.createCounter('agentshield.auth.failures', {
    description: 'Authentication failures',
});
const budgetExceededCounter = meter.createCounter('agentshield.budget.exceeded', {
    description: 'Budget limit hits',
});
const gatewayLatencyHist = meter.createHistogram('agentshield.gateway.latency_ms', {
    description: 'End-to-end gateway request latency',
    unit: 'ms',
    advice: { explicitBucketBoundaries: [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000] },
});
const policyEvalHist = meter.createHistogram('agentshield.policy.evaluate_ms', {
    description: 'Policy evaluation duration',
    unit: 'ms',
    advice: { explicitBucketBoundaries: [1, 5, 10, 25, 50, 100] },
});
const requestCounter = meter.createCounter('agentshield.requests.total', {
    description: 'Total gateway requests',
});

// ============================================
// 1. Trace ID Middleware — bridges OTel trace context with AgentShield trace ID
// ============================================
function traceId(req, res, next) {
    const activeSpan = trace.getActiveSpan();
    // Use OTel trace ID if available, fall back to header or UUID
    req.traceId = activeSpan
        ? activeSpan.spanContext().traceId
        : req.headers['x-trace-id'] || uuidv4();
    req.startTime = Date.now();
    res.setHeader('X-Trace-Id', req.traceId);

    // Set AgentShield trace ID as attribute on the auto-created HTTP span
    if (activeSpan) {
        activeSpan.setAttribute('agentshield.trace_id', req.traceId);
    }

    next();
}

// ============================================
// 2. Auth Middleware — validates JWT or API Key
// ============================================
function authenticate(req, res, next) {
    // Skip auth for admin login and health endpoints
    const publicPaths = ['/api/v1/auth/login', '/api/v1/auth/refresh', '/api/v1/admin/invitations/accept', '/health', '/ready'];
    if (publicPaths.some(p => req.path.startsWith(p))) {
        return next();
    }

    tracer.startActiveSpan('agentshield.authenticate', (span) => {
        // Check for API Key authentication first
        const apiKey = req.headers['x-api-key'];
        if (apiKey) {
            span.setAttribute('agentshield.auth.method', 'api_key');
            return (async () => {
                try {
                    const identity = await apiKeyService.validateKey(apiKey);
                    if (!identity) {
                        span.setAttribute('agentshield.auth.success', false);
                        span.setStatus({ code: SpanStatusCode.OK, message: 'Invalid API key' });
                        authFailureCounter.add(1, { method: 'api_key', reason: 'invalid' });
                        span.end();
                        return res.status(401).json({
                            success: false,
                            error: 'Invalid or expired API key',
                            code: 'INVALID_API_KEY',
                        });
                    }
                    req.user = identity;
                    req.authMethod = 'api_key';
                    span.setAttribute('agentshield.auth.success', true);
                    span.setAttribute('agentshield.auth.user_id', identity.id || 'unknown');
                    span.setAttribute('agentshield.auth.role', identity.role || 'unknown');
                    span.setStatus({ code: SpanStatusCode.OK });
                    span.end();
                    next();
                } catch (err) {
                    logger.error('API key validation error:', err);
                    span.recordException(err);
                    span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
                    authFailureCounter.add(1, { method: 'api_key', reason: 'error' });
                    span.end();
                    return res.status(500).json({
                        success: false,
                        error: 'Authentication error',
                        code: 'AUTH_ERROR',
                    });
                }
            })();
        }

        // Fall through to JWT authentication
        span.setAttribute('agentshield.auth.method', 'jwt');
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            span.setAttribute('agentshield.auth.success', false);
            span.setStatus({ code: SpanStatusCode.OK, message: 'No auth header' });
            authFailureCounter.add(1, { method: 'jwt', reason: 'missing' });
            span.end();
            return res.status(401).json({
                success: false,
                error: 'Authentication required. Provide Authorization header (JWT) or X-API-Key header.',
                code: 'AUTH_REQUIRED',
            });
        }

        const token = authHeader.split(' ')[1];
        try {
            const decoded = jwt.verify(token, config.jwt.secret);
            req.user = decoded;
            req.authMethod = 'jwt';
            span.setAttribute('agentshield.auth.success', true);
            span.setAttribute('agentshield.auth.user_id', decoded.id || 'unknown');
            span.setAttribute('agentshield.auth.role', decoded.role || 'unknown');
            span.setStatus({ code: SpanStatusCode.OK });
            span.end();
            next();
        } catch (err) {
            const code = err.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN';
            span.setAttribute('agentshield.auth.success', false);
            span.setStatus({ code: SpanStatusCode.OK, message: code });
            authFailureCounter.add(1, { method: 'jwt', reason: code.toLowerCase() });
            span.end();
            return res.status(401).json({
                success: false,
                error: err.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token',
                code,
            });
        }
    });
}

// ============================================
// 3. Policy Enforcement Middleware
// ============================================
function policyEnforcer(req, res, next) {
    // Only enforce on proxy/invoke calls, skip self-service policy check
    if (!req.path.startsWith('/api/v1/gateway/') || req.path === '/api/v1/gateway/policy/check') {
        return next();
    }

    // Module toggle check — skip if policies module is disabled
    settingsService.getModuleStatus('policies').then(enabled => {
        if (!enabled) {
            logger.debug('Policy enforcement skipped — module disabled');
            return next();
        }
        _policyEnforcerCore(req, res, next);
    }).catch(() => next());
}

function _policyEnforcerCore(req, res, next) {
    tracer.startActiveSpan('agentshield.policy.evaluate', async (span) => {
        const evalStart = Date.now();
        try {
            const agentSlug = req.params.agentSlug;
            const workflowSlug = req.params.workflowSlug;

            let agent = null;
            let workflow = null;

            if (agentSlug) {
                try { agent = await RegistryService.getAgent(agentSlug); } catch (e) { /* skip */ }
            }

            span.setAttribute('agentshield.policy.target_type', agentSlug ? 'agent' : 'workflow');
            span.setAttribute('agentshield.policy.target_slug', agentSlug || workflowSlug || 'unknown');

            const context = {
                user: req.user || {},
                agent: agent ? { slug: agent.slug, type: agent.type, name: agent.name, vendor: agent.vendor } : {},
                workflow: workflow ? { slug: workflow.slug, name: workflow.name } : {},
                action: 'invoke',
                timestamp: new Date().toISOString(),
            };

            const result = await policyService.evaluate(context);
            const evalMs = Date.now() - evalStart;

            // Record metrics
            policyEvalHist.record(evalMs);
            span.setAttribute('agentshield.policy.decision', result.allowed ? 'allow' : 'deny');
            span.setAttribute('agentshield.policy.matched_name', result.matchedPolicy?.name || result.matchedPolicy || 'none');
            span.setAttribute('agentshield.policy.reason', result.reason || '');
            span.setAttribute('agentshield.policy.evaluate_ms', evalMs);

            policyDecisionCounter.add(1, {
                decision: result.allowed ? 'allow' : 'deny',
                policy_name: result.matchedPolicy?.name || result.matchedPolicy || 'default',
            });

            if (!result.allowed) {
                policyDenialCounter.add(1, {
                    reason: result.reason || 'policy_denied',
                    agent_slug: agentSlug || 'workflow',
                });

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

                span.setStatus({ code: SpanStatusCode.OK, message: 'Policy denied' });
                span.end();
                return res.status(403).json({
                    success: false,
                    error: 'Access denied by policy',
                    reason: result.reason,
                    code: 'POLICY_DENIED',
                });
            }

            req.policyResult = result;
            span.setStatus({ code: SpanStatusCode.OK });
            span.end();
            next();
        } catch (err) {
            logger.error('Policy evaluation error:', err);
            span.recordException(err);
            span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
            span.end();
            next(err);
        }
    });
}

// ============================================
// 4. Budget Check Middleware
// ============================================
function budgetChecker(req, res, next) {
    if (!req.path.startsWith('/api/v1/gateway/') || req.path === '/api/v1/gateway/policy/check') {
        return next();
    }

    // Module toggle check — skip if cost management module is disabled
    settingsService.getModuleStatus('cost_management').then(enabled => {
        if (!enabled) {
            logger.debug('Budget checking skipped — module disabled');
            return next();
        }
        _budgetCheckerCore(req, res, next);
    }).catch(() => next());
}

function _budgetCheckerCore(req, res, next) {
    tracer.startActiveSpan('agentshield.budget.check', async (span) => {
        try {
            span.setAttribute('agentshield.budget.user_id', req.user?.id || 'anonymous');

            // Extract agent slug from path for agent-scoped budget checks
            // Path format: /api/v1/gateway/agents/:slug/invoke
            const pathParts = req.path.split('/');
            const agentIdx = pathParts.indexOf('agents');
            const agentSlug = agentIdx >= 0 ? pathParts[agentIdx + 1] : null;

            const result = await costService.checkBudget(
                req.user?.id,
                req.user?.teamId,
                req.user?.departmentId,
                agentSlug  // Pass slug so agent-scoped budgets are checked
            );

            span.setAttribute('agentshield.budget.decision', result.allowed ? 'allow' : 'deny');

            if (!result.allowed) {
                span.setAttribute('agentshield.budget.reason', result.reason || 'budget_exceeded');
                budgetExceededCounter.add(1, {
                    scope: result.scope || 'unknown',
                    limit_type: result.limitType || 'unknown',
                });

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

                span.setStatus({ code: SpanStatusCode.OK, message: 'Budget exceeded' });
                span.end();
                return res.status(402).json({
                    success: false,
                    error: 'Budget exceeded',
                    reason: result.reason,
                    code: 'BUDGET_EXCEEDED',
                });
            }

            span.setStatus({ code: SpanStatusCode.OK });
            span.end();
            next();
        } catch (err) {
            logger.error('Budget check error:', err);
            span.recordException(err);
            span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
            span.end();
            next(err);
        }
    });
}

// ============================================
// 5.5. Guardrail Enforcer Middleware
// ============================================
function guardrailEnforcer(req, res, next) {
    // Only enforce on gateway invoke/run calls
    if (!req.path.startsWith('/api/v1/gateway/') || req.path === '/api/v1/gateway/policy/check') {
        return next();
    }

    // Module toggle check — skip if guardrails module is disabled
    settingsService.getModuleStatus('guardrails').then(enabled => {
        if (!enabled) {
            logger.debug('Guardrail enforcement skipped — module disabled');
            return next();
        }
        _guardrailEnforcerCore(req, res, next);
    }).catch(() => next());
}

function _guardrailEnforcerCore(req, res, next) {
    tracer.startActiveSpan('agentshield.guardrail.evaluate', async (span) => {
        try {
            const agentSlug = req.params.agentSlug;
            if (!agentSlug) {
                span.setAttribute('agentshield.guardrail.skipped', true);
                span.setStatus({ code: SpanStatusCode.OK, message: 'No agent slug' });
                span.end();
                return next();
            }

            const result = await guardrailsService.evaluateInput(agentSlug, req.body);

            span.setAttribute('agentshield.guardrail.violations', result.violations.length);
            span.setAttribute('agentshield.guardrail.allowed', result.allowed);

            if (result.violations.length > 0) {
                // Log all violations to audit
                for (const v of result.violations) {
                    span.addEvent('guardrail.violation', {
                        'agentshield.guardrail.rule_name': v.ruleName,
                        'agentshield.guardrail.rule_type': v.ruleType,
                        'agentshield.guardrail.severity': v.severity,
                    });
                }

                const auditService = require('../../audit/service');
                auditService.log({
                    traceId: req.traceId,
                    eventType: 'guardrail_violation',
                    actorId: req.user?.id,
                    actorType: req.user ? 'user' : 'anonymous',
                    resourceType: 'agent',
                    action: 'invoke',
                    outcome: result.allowed ? 'allowed' : 'denied',
                    details: {
                        violations: result.violations.map(v => ({
                            profile: v.profileName,
                            rule: v.ruleName,
                            type: v.ruleType,
                            severity: v.severity,
                            details: v.details,
                        })),
                    },
                    ipAddress: req.ip,
                }).catch(() => { /* never fail on audit */ });
            }

            if (!result.allowed) {
                span.setStatus({ code: SpanStatusCode.OK, message: 'Guardrail blocked' });
                span.end();
                return res.status(422).json({
                    success: false,
                    error: 'Request blocked by guardrail',
                    violations: result.violations.map(v => ({
                        profile: v.profileName,
                        rule: v.ruleName,
                        type: v.ruleType,
                        severity: v.severity,
                        details: v.details,
                    })),
                    code: 'GUARDRAIL_VIOLATION',
                });
            }

            // Attach result for downstream use (e.g., output guardrails)
            req.guardrailResult = result;
            span.setStatus({ code: SpanStatusCode.OK });
            span.end();
            next();
        } catch (err) {
            logger.error('Guardrail enforcement error (non-blocking):', err);
            span.recordException(err);
            span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
            span.end();
            // Fail-open: don't block requests if guardrails service errors
            next();
        }
    });
}

// ============================================
// 5. Compliance Sampler Middleware
// ============================================
function complianceSampler(req, res, next) {
    if (!req.path.startsWith('/api/v1/gateway/') || req.path === '/api/v1/gateway/policy/check') {
        return next();
    }

    // Module toggle check — skip if compliance module is disabled
    settingsService.getModuleStatus('compliance').then(enabled => {
        if (!enabled) {
            logger.debug('Compliance sampling skipped — module disabled');
            return next();
        }
        _complianceSamplerCore(req, res, next);
    }).catch(() => next());
}

function _complianceSamplerCore(req, res, next) {
    // Capture response body for sampling
    const originalJson = res.json.bind(res);
    res.json = function (body) {
        res._body = body;

        // Async sampling — never blocks the response
        (async () => {
            const span = tracer.startSpan('agentshield.compliance.sample');
            try {
                const agentSlug = req.params.agentSlug;
                const agent = agentSlug ? await RegistryService.getAgent(agentSlug).catch(() => null) : null;

                const sampleDecision = await complianceService.shouldSample(
                    agent?.id,
                    null // workflowId
                );

                span.setAttribute('agentshield.compliance.sampled', sampleDecision.shouldSample);
                span.setAttribute('agentshield.compliance.agent_slug', agentSlug || 'unknown');

                if (sampleDecision.shouldSample) {
                    const sampleResult = await complianceService.storeSample({
                        configId: sampleDecision.configId,
                        traceId: req.traceId,
                        requestBody: JSON.stringify(req.body || {}),
                        responseBody: JSON.stringify(body),
                        agentId: agent?.id,
                        userId: req.user?.id,
                    });

                    // Track PII detection
                    if (sampleResult && sampleResult.piiDetected) {
                        span.setAttribute('agentshield.compliance.pii_detected', true);
                    }
                }

                span.setStatus({ code: SpanStatusCode.OK });
            } catch (err) {
                logger.error('Compliance sampling error (non-blocking):', err);
                span.recordException(err);
                span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
            } finally {
                span.end();
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

        // Record gateway latency metric
        gatewayLatencyHist.record(latencyMs, {
            method: req.method,
            route: req.route?.path || req.path,
            status_code: res.statusCode.toString(),
        });

        requestCounter.add(1, {
            method: req.method,
            route: req.route?.path || req.path,
            status_code: res.statusCode.toString(),
        });

        const span = tracer.startSpan('agentshield.audit.log', {
            attributes: {
                'agentshield.audit.event_type': 'api_request',
                'agentshield.audit.outcome': outcome,
                'agentshield.audit.latency_ms': latencyMs,
                'agentshield.audit.status_code': res.statusCode,
            },
        });

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
        }).catch(() => { }) // Never fail on audit
            .finally(() => span.end());
    });

    next();
}

// ============================================
// Error Handler
// ============================================
function errorHandler(err, req, res, next) {
    const statusCode = err.statusCode || 500;
    const message = err.isOperational ? err.message : 'Internal server error';

    // Record exception on the active span
    const activeSpan = trace.getActiveSpan();
    if (activeSpan) {
        activeSpan.recordException(err);
        activeSpan.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
    }

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
    guardrailEnforcer,
    complianceSampler,
    auditLogger,
    errorHandler,
};
