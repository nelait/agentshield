const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const logger = require('../config/logger');
const { RegistryService, AppError } = require('../registry/service');
const workflowService = require('../workflow/service');
const auditService = require('../audit/service');
const costService = require('../cost/service');

const router = express.Router();

// ============================================
// POST /api/v1/gateway/agents/:agentSlug/invoke
// Invoke a single agent through the firewall
// ============================================
router.post('/agents/:agentSlug/invoke', async (req, res, next) => {
    try {
        const { agentSlug } = req.params;
        const agent = await RegistryService.getAgent(agentSlug);

        // Check agent is active and healthy
        if (!agent.is_active) {
            throw new AppError(`Agent "${agent.name}" is currently inactive`, 503);
        }
        if (agent.health_status === 'unhealthy') {
            throw new AppError(`Agent "${agent.name}" is currently unhealthy`, 503);
        }

        // Forward the request to the actual agent
        const startTime = Date.now();
        const response = await forwardToAgent(agent, req.body, req.headers);
        const latencyMs = Date.now() - startTime;

        // Track cost/tokens if available
        if (response.usage) {
            await costService.recordUsage({
                traceId: req.traceId,
                agentId: agent.id,
                userId: req.user?.id,
                inputTokens: response.usage.input_tokens || response.usage.prompt_tokens || 0,
                outputTokens: response.usage.output_tokens || response.usage.completion_tokens || 0,
                costCents: response.usage.cost_cents || 0,
                modelName: response.usage.model || null,
            }).catch(err => logger.error('Cost tracking error:', err));
        }

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
        next(err);
    }
});

// ============================================
// POST /api/v1/gateway/workflows/:workflowSlug/run
// Execute a workflow through the firewall
// ============================================
router.post('/workflows/:workflowSlug/run', async (req, res, next) => {
    try {
        const { workflowSlug } = req.params;
        const workflow = await workflowService.getWorkflow(workflowSlug);

        if (!workflow.is_enabled) {
            throw new AppError(`Workflow "${workflow.name}" is currently disabled`, 503);
        }

        // Parse the agent steps
        const agents = typeof workflow.agents === 'string'
            ? JSON.parse(workflow.agents)
            : workflow.agents;

        if (!agents || agents.length === 0) {
            throw new AppError('Workflow has no agents configured', 400);
        }

        // Execute agents in sequence
        let currentInput = req.body;
        const results = [];
        const totalStartTime = Date.now();

        for (const step of agents) {
            const agent = await RegistryService.getAgent(step.agent_id || step.agent_slug);

            if (!agent.is_active) {
                if (step.is_optional) {
                    logger.info(`Skipping optional inactive agent: ${agent.slug}`);
                    results.push({ agentSlug: agent.slug, skipped: true, reason: 'inactive' });
                    continue;
                }
                throw new AppError(`Required agent "${agent.name}" is inactive`, 503);
            }

            const stepStart = Date.now();
            const response = await forwardToAgent(agent, currentInput, req.headers);
            const stepLatency = Date.now() - stepStart;

            // Track cost
            if (response.usage) {
                await costService.recordUsage({
                    traceId: req.traceId,
                    agentId: agent.id,
                    workflowId: workflow.id,
                    userId: req.user?.id,
                    inputTokens: response.usage.input_tokens || 0,
                    outputTokens: response.usage.output_tokens || 0,
                    costCents: response.usage.cost_cents || 0,
                    modelName: response.usage.model || null,
                }).catch(err => logger.error('Cost tracking error:', err));
            }

            results.push({
                agentSlug: agent.slug,
                latencyMs: stepLatency,
                data: response.data,
            });

            // Use this agent's output as input for the next agent
            currentInput = response.data;
        }

        const totalLatency = Date.now() - totalStartTime;

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
        next(err);
    }
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

        return {
            data: response.data,
            usage: typeof usage === 'string' ? JSON.parse(usage) : usage,
        };
    } catch (err) {
        if (err.response) {
            throw new AppError(
                `Agent "${agent.name}" returned error: ${err.response.status} - ${JSON.stringify(err.response.data)}`,
                502
            );
        }
        throw new AppError(`Agent "${agent.name}" is unreachable: ${err.message}`, 503);
    }
}

module.exports = router;
module.exports.forwardToAgent = forwardToAgent;
