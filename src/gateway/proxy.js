const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const logger = require('../config/logger');
const { RegistryService, AppError } = require('../registry/service');
const workflowService = require('../workflow/service');
const auditService = require('../audit/service');
const costService = require('../cost/service');
const policyService = require('../policy/service');
const apiKeyService = require('../apikeys/service');

// ─── OpenTelemetry ───
const { trace, SpanStatusCode } = require('@opentelemetry/api');
const tracer = trace.getTracer('agentshield.gateway', '0.1.0');

const router = express.Router();

// ============================================
// POST /api/v1/gateway/agents/:agentSlug/invoke
// Invoke a single agent through the firewall
// ============================================
router.post('/agents/:agentSlug/invoke', async (req, res, next) => {
    tracer.startActiveSpan('agentshield.agent.invoke', async (span) => {
        try {
            const { agentSlug } = req.params;
            const agent = await RegistryService.getAgent(agentSlug);

            // Set agent attributes on the span
            span.setAttributes({
                'agentshield.agent.slug': agent.slug,
                'agentshield.agent.name': agent.name,
                'agentshield.agent.protocol': agent.protocol || 'rest',
                'agentshield.agent.vendor': agent.vendor || 'unknown',
                'agentshield.agent.health_status': agent.health_status || 'unknown',
            });

            // Check agent is active and healthy
            if (!agent.is_active) {
                span.setStatus({ code: SpanStatusCode.ERROR, message: 'Agent inactive' });
                throw new AppError(`Agent "${agent.name}" is currently inactive`, 503);
            }
            if (agent.health_status === 'unhealthy') {
                span.setStatus({ code: SpanStatusCode.ERROR, message: 'Agent unhealthy' });
                throw new AppError(`Agent "${agent.name}" is currently unhealthy`, 503);
            }

            // Forward the request to the actual agent
            const startTime = Date.now();
            const response = await forwardToAgent(agent, req.body, req.headers);
            const latencyMs = Date.now() - startTime;

            span.setAttribute('agentshield.agent.latency_ms', latencyMs);

            // Always track cost/tokens (estimate if agent didn't provide)
            const inputTokens = response.usage?.input_tokens || response.usage?.prompt_tokens || 0;
            const outputTokens = response.usage?.output_tokens || response.usage?.completion_tokens || 0;
            const modelName = response.usage?.model || null;

            // If agent didn't return token counts, estimate from payload sizes
            const finalInput = inputTokens > 0 ? inputTokens : costService.estimateTokens(JSON.stringify(req.body));
            const finalOutput = outputTokens > 0 ? outputTokens : costService.estimateTokens(JSON.stringify(response.data));
            const isEstimated = inputTokens === 0;

            span.setAttributes({
                'gen_ai.usage.input_tokens': finalInput,
                'gen_ai.usage.output_tokens': finalOutput,
                'gen_ai.usage.total_tokens': finalInput + finalOutput,
                'gen_ai.usage.is_estimated': isEstimated,
            });

            await costService.recordUsage({
                traceId: req.traceId,
                agentId: agent.id,
                agentSlug: agent.slug,
                userId: req.user?.id,
                teamId: req.user?.teamId,
                department: req.user?.department,
                inputTokens: finalInput,
                outputTokens: finalOutput,
                costCents: response.usage?.cost_cents || 0,
                modelName,
                estimated: isEstimated,
            }).catch(err => logger.error('Cost tracking error:', err));

            span.setStatus({ code: SpanStatusCode.OK });
            res.json({
                success: true,
                data: response.data,
                meta: {
                    traceId: req.traceId,
                    agentSlug: agent.slug,
                    latencyMs,
                    usage: response.usage || null,
                },
            });
        } catch (err) {
            span.recordException(err);
            span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
            next(err);
        } finally {
            span.end();
        }
    });
});

// ============================================
// POST /api/v1/gateway/workflows/:workflowSlug/run
// Execute a workflow through the firewall
// ============================================
router.post('/workflows/:workflowSlug/run', async (req, res, next) => {
    tracer.startActiveSpan('agentshield.workflow.run', async (span) => {
        try {
            const { workflowSlug } = req.params;
            const workflow = await workflowService.getWorkflow(workflowSlug);

            span.setAttributes({
                'agentshield.workflow.slug': workflow.slug,
                'agentshield.workflow.name': workflow.name || '',
            });

            if (!workflow.is_enabled) {
                span.setStatus({ code: SpanStatusCode.ERROR, message: 'Workflow disabled' });
                throw new AppError(`Workflow "${workflow.name}" is currently disabled`, 503);
            }

            // Parse the agent steps
            const agents = typeof workflow.agents === 'string'
                ? JSON.parse(workflow.agents)
                : workflow.agents;

            if (!agents || agents.length === 0) {
                throw new AppError('Workflow has no agents configured', 400);
            }

            span.setAttribute('agentshield.workflow.total_steps', agents.length);

            // Execute agents in sequence
            let currentInput = req.body;
            const results = [];
            const totalStartTime = Date.now();
            let completedSteps = 0;

            for (let i = 0; i < agents.length; i++) {
                const step = agents[i];
                await tracer.startActiveSpan('agentshield.workflow.step', {
                    attributes: {
                        'agentshield.workflow.step.index': i,
                        'agentshield.workflow.step.agent_id': step.agent_id || step.agent_slug || '',
                    },
                }, async (stepSpan) => {
                    try {
                        const agent = await RegistryService.getAgent(step.agent_id || step.agent_slug);
                        stepSpan.setAttribute('agentshield.workflow.step.agent_slug', agent.slug);

                        if (!agent.is_active) {
                            if (step.is_optional) {
                                logger.info(`Skipping optional inactive agent: ${agent.slug}`);
                                stepSpan.setAttribute('agentshield.workflow.step.skipped', true);
                                stepSpan.setAttribute('agentshield.workflow.step.skip_reason', 'inactive');
                                results.push({ agentSlug: agent.slug, skipped: true, reason: 'inactive' });
                                stepSpan.setStatus({ code: SpanStatusCode.OK, message: 'Skipped (optional)' });
                                return;
                            }
                            stepSpan.setStatus({ code: SpanStatusCode.ERROR, message: 'Required agent inactive' });
                            throw new AppError(`Required agent "${agent.name}" is inactive`, 503);
                        }

                        const stepStart = Date.now();
                        const response = await forwardToAgent(agent, currentInput, req.headers);
                        const stepLatency = Date.now() - stepStart;

                        stepSpan.setAttribute('agentshield.workflow.step.latency_ms', stepLatency);

                        // Always track cost/tokens (estimate if not provided)
                        const stepInputTokens = response.usage?.input_tokens || response.usage?.prompt_tokens || 0;
                        const stepOutputTokens = response.usage?.output_tokens || response.usage?.completion_tokens || 0;
                        const stepFinalInput = stepInputTokens > 0 ? stepInputTokens : costService.estimateTokens(JSON.stringify(currentInput));
                        const stepFinalOutput = stepOutputTokens > 0 ? stepOutputTokens : costService.estimateTokens(JSON.stringify(response.data));
                        const stepEstimated = stepInputTokens === 0;

                        await costService.recordUsage({
                            traceId: req.traceId,
                            agentId: agent.id,
                            agentSlug: agent.slug,
                            workflowId: workflow.id,
                            userId: req.user?.id,
                            teamId: req.user?.teamId,
                            department: req.user?.department,
                            inputTokens: stepFinalInput,
                            outputTokens: stepFinalOutput,
                            costCents: response.usage?.cost_cents || 0,
                            modelName: response.usage?.model || null,
                            estimated: stepEstimated,
                        }).catch(err => logger.error('Cost tracking error:', err));

                        results.push({
                            agentSlug: agent.slug,
                            latencyMs: stepLatency,
                            data: response.data,
                        });

                        // Use this agent's output as input for the next agent
                        currentInput = response.data;
                        completedSteps++;
                        stepSpan.setStatus({ code: SpanStatusCode.OK });
                    } catch (err) {
                        stepSpan.recordException(err);
                        stepSpan.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
                        throw err; // Re-throw to be caught by outer span
                    } finally {
                        stepSpan.end();
                    }
                });
            }

            const totalLatency = Date.now() - totalStartTime;
            span.setAttributes({
                'agentshield.workflow.completed_steps': completedSteps,
                'agentshield.workflow.total_latency_ms': totalLatency,
            });

            span.setStatus({ code: SpanStatusCode.OK });
            res.json({
                success: true,
                data: currentInput, // final output
                meta: {
                    traceId: req.traceId,
                    workflowSlug: workflow.slug,
                    totalLatencyMs: totalLatency,
                    steps: results.map(r => ({
                        agentSlug: r.agentSlug,
                        latencyMs: r.latencyMs,
                        skipped: r.skipped || false,
                    })),
                },
            });
        } catch (err) {
            span.recordException(err);
            span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
            next(err);
        } finally {
            span.end();
        }
    });
});

// ============================================
// GET /api/v1/gateway/agents/:agentSlug/status
// Check agent status through the firewall
// ============================================
router.get('/agents/:agentSlug/status', async (req, res, next) => {
    try {
        const agent = await RegistryService.getAgent(req.params.agentSlug);
        res.json({
            success: true,
            data: {
                slug: agent.slug,
                name: agent.name,
                isActive: agent.is_active,
                healthStatus: agent.health_status,
                lastHealthCheck: agent.last_health_check,
            },
        });
    } catch (err) {
        next(err);
    }
});

// ============================================
// Helper: Forward request to upstream agent
// ============================================
async function forwardToAgent(agent, body, headers) {
    return tracer.startActiveSpan('agentshield.agent.forward', {
        attributes: {
            'agentshield.agent.protocol': agent.protocol || 'rest',
            'agentshield.agent.endpoint': agent.endpoint_url,
        },
    }, async (span) => {
        try {
            // MCP protocol: use dedicated MCP SSE client
            if (agent.protocol === 'mcp') {
                span.setAttribute('agentshield.agent.forward_type', 'mcp');
                const { invokeMcpAgent } = require('./mcp-client');
                try {
                    const result = await invokeMcpAgent(agent.endpoint_url, body);
                    span.setStatus({ code: SpanStatusCode.OK });
                    return result;
                } catch (err) {
                    span.recordException(err);
                    span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
                    throw new AppError(
                        `MCP Agent "${agent.name}" error: ${err.message}`,
                        502
                    );
                }
            }

            // All other protocols: standard HTTP POST
            span.setAttribute('agentshield.agent.forward_type', 'http');
            const agentConfig = agent.auth_config || {};
            const requestHeaders = {
                'Content-Type': 'application/json',
                'X-Forwarded-By': 'AgentShield',
            };

            // Apply agent-specific auth
            if (agentConfig.type === 'bearer') {
                requestHeaders['Authorization'] = `Bearer ${agentConfig.token}`;
            } else if (agentConfig.type === 'api_key') {
                requestHeaders[agentConfig.headerName || 'X-API-Key'] = agentConfig.key;
            }

            try {
                const response = await axios.post(agent.endpoint_url, body, {
                    headers: requestHeaders,
                    timeout: 30000,
                    maxContentLength: 10 * 1024 * 1024, // 10MB
                });

                // Try to extract usage info from response
                const usage = response.data?.usage || response.headers['x-usage'] || null;

                span.setStatus({ code: SpanStatusCode.OK });
                return {
                    data: response.data,
                    usage: typeof usage === 'string' ? JSON.parse(usage) : usage,
                };
            } catch (err) {
                if (err.response) {
                    span.setAttribute('agentshield.agent.upstream_status', err.response.status);
                    span.recordException(err);
                    span.setStatus({ code: SpanStatusCode.ERROR, message: `Upstream error: ${err.response.status}` });
                    throw new AppError(
                        `Agent "${agent.name}" returned error: ${err.response.status} - ${JSON.stringify(err.response.data)}`,
                        502
                    );
                }
                span.recordException(err);
                span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
                throw new AppError(`Agent "${agent.name}" is unreachable: ${err.message}`, 503);
            }
        } finally {
            span.end();
        }
    });
}

module.exports = router;
module.exports.forwardToAgent = forwardToAgent;

// ============================================
// POST /api/v1/gateway/policy/check
// Self-service policy validation — pre-check before invoking
// ============================================


router.post('/policy/check', async (req, res, next) => {
    try {
        // Verify scope if using API key auth
        if (req.authMethod === 'api_key' && !apiKeyService.hasScope(req.user, 'policy:check')) {
            return res.status(403).json({
                success: false,
                error: 'API key does not have the "policy:check" scope',
                code: 'SCOPE_DENIED',
            });
        }

        const { agentSlug, workflowSlug, user: userContext, action, customContext } = req.body;

        if (!agentSlug && !workflowSlug) {
            return res.status(400).json({
                success: false,
                error: 'Provide either "agentSlug" or "workflowSlug" in the request body',
                code: 'MISSING_TARGET',
            });
        }

        // Build the context object identical to the live gateway
        const context = {
            user: {
                id: userContext?.id || req.user?.id || 'anonymous',
                role: userContext?.role || req.user?.role || 'viewer',
                email: userContext?.email || req.user?.email || '',
                department: userContext?.department || req.user?.department || '',
            },
            agent: null,
            workflow: null,
            request: {
                method: 'POST',
                path: agentSlug
                    ? `/api/v1/gateway/agents/${agentSlug}/invoke`
                    : `/api/v1/gateway/workflows/${workflowSlug}/run`,
                timestamp: new Date().toISOString(),
                ...(customContext || {}),
            },
            action: action || 'invoke',
        };

        // Resolve real agent/workflow from the registry
        if (agentSlug) {
            try {
                const agent = await RegistryService.getAgent(agentSlug);
                context.agent = {
                    id: agent.id, slug: agent.slug, name: agent.name,
                    type: agent.type, protocol: agent.protocol, vendor: agent.vendor,
                };
            } catch {
                context.agent = { slug: agentSlug, type: 'unknown' };
            }
        }
        if (workflowSlug) {
            try {
                const wf = await workflowService.getWorkflow(workflowSlug);
                context.workflow = {
                    id: wf.id, slug: wf.slug, name: wf.name,
                    agents: wf.agents,
                };
                // Also resolve first agent in workflow for context
                const agents = typeof wf.agents === 'string' ? JSON.parse(wf.agents) : wf.agents;
                if (agents && agents.length > 0 && (agents[0].agent_id || agents[0].agent_slug)) {
                    try {
                        const firstAgent = await RegistryService.getAgent(agents[0].agent_id || agents[0].agent_slug);
                        context.agent = {
                            id: firstAgent.id, slug: firstAgent.slug, name: firstAgent.name,
                            type: firstAgent.type, protocol: firstAgent.protocol, vendor: firstAgent.vendor,
                        };
                    } catch { /* skip */ }
                }
            } catch {
                context.workflow = { slug: workflowSlug };
            }
        }

        // Use the exact same policy evaluation engine as the live gateway
        const decision = await policyService.evaluate(context);

        // Audit log the pre-check (non-blocking)
        auditService.log({
            traceId: req.traceId,
            eventType: 'policy_precheck',
            actorId: req.user?.id,
            actorType: req.authMethod === 'api_key' ? 'api_key' : 'user',
            resourceType: agentSlug ? 'agent' : 'workflow',
            resourceId: context.agent?.id || context.workflow?.id || null,
            action: 'policy_check',
            outcome: decision.allowed ? 'allowed' : 'denied',
            details: {
                reason: decision.reason,
                policy: decision.matchedPolicy,
                apiKeyName: req.user?.apiKeyName || null,
            },
            ipAddress: req.ip,
        }).catch(() => { /* never fail on audit */ });

        res.json({
            success: true,
            data: {
                allowed: decision.allowed,
                reason: decision.reason,
                matchedPolicy: decision.matchedPolicy?.name || null,
                checkedAt: new Date().toISOString(),
                target: {
                    type: agentSlug ? 'agent' : 'workflow',
                    slug: agentSlug || workflowSlug,
                    name: context.agent?.name || context.workflow?.name || null,
                },
            },
        });
    } catch (err) {
        next(err);
    }
});
