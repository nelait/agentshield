/**
 * @file Centralized OpenTelemetry metrics definitions for AgentShield.
 *
 * Every custom metric uses the `agentshield.*` prefix and is created from a
 * single shared Meter obtained via `@opentelemetry/api`.  Application code
 * should import the exported `metrics` object rather than creating its own
 * instruments.
 *
 * Counters  — monotonically-increasing totals (requests, denials, …)
 * Histograms — value distributions with explicit bucket boundaries
 */

const { metrics: otelMetrics } = require('@opentelemetry/api');

const meter = otelMetrics.getMeter('agentshield', '0.1.0');

/* ------------------------------------------------------------------ */
/*  Counters                                                          */
/* ------------------------------------------------------------------ */

/**
 * Total gateway requests.
 * Labels: method, route, status_code
 */
const requestsTotal = meter.createCounter('agentshield.requests.total', {
    description: 'Total gateway requests',
    unit: '{request}',
});

/**
 * Policy evaluation outcomes.
 * Labels: decision, policy_name
 */
const policyDecisions = meter.createCounter('agentshield.policy.decisions', {
    description: 'Policy evaluation outcomes',
    unit: '{decision}',
});

/**
 * Policy denial count.
 * Labels: reason, agent_slug
 */
const policyDenials = meter.createCounter('agentshield.policy.denials', {
    description: 'Policy denial count',
    unit: '{denial}',
});

/**
 * Authentication failures.
 * Labels: method, reason
 */
const authFailures = meter.createCounter('agentshield.auth.failures', {
    description: 'Authentication failures',
    unit: '{failure}',
});

/**
 * Budget limit hits.
 * Labels: scope, limit_type
 */
const budgetExceeded = meter.createCounter('agentshield.budget.exceeded', {
    description: 'Budget limit hits',
    unit: '{violation}',
});

/**
 * PII detection events.
 * Labels: pii_type, agent_slug
 */
const compliancePiiDetected = meter.createCounter('agentshield.compliance.pii_detected', {
    description: 'PII detection events',
    unit: '{detection}',
});

/**
 * Compliance samples taken.
 * Labels: agent_slug
 */
const complianceSamples = meter.createCounter('agentshield.compliance.samples', {
    description: 'Compliance samples taken',
    unit: '{sample}',
});

/**
 * Evaluation runs executed.
 * Labels: mode, status
 */
const evalRuns = meter.createCounter('agentshield.eval.runs', {
    description: 'Evaluation runs executed',
    unit: '{run}',
});

/* ------------------------------------------------------------------ */
/*  Histograms                                                        */
/* ------------------------------------------------------------------ */

/**
 * End-to-end gateway request latency.
 * Labels: method, route, status_code
 */
const gatewayLatency = meter.createHistogram('agentshield.gateway.latency_ms', {
    description: 'End-to-end gateway request latency',
    unit: 'ms',
    advice: {
        explicitBucketBoundaries: [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
    },
});

/**
 * Policy evaluation duration.
 * Labels: policy_name, decision
 */
const policyEvaluateLatency = meter.createHistogram('agentshield.policy.evaluate_ms', {
    description: 'Policy evaluation duration',
    unit: 'ms',
    advice: {
        explicitBucketBoundaries: [1, 5, 10, 25, 50, 100],
    },
});

/**
 * Upstream agent response time.
 * Labels: agent_slug
 */
const agentUpstreamLatency = meter.createHistogram('agentshield.agent.upstream_latency_ms', {
    description: 'Upstream agent response time',
    unit: 'ms',
    advice: {
        explicitBucketBoundaries: [50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000],
    },
});

/**
 * Token usage per invocation.
 * Labels: agent_slug, token_type (prompt | completion | total)
 */
const agentTokens = meter.createHistogram('agentshield.agent.tokens', {
    description: 'Token usage per invocation',
    unit: '{token}',
    advice: {
        explicitBucketBoundaries: [100, 500, 1000, 5000, 10000, 50000],
    },
});

/**
 * Per-scenario evaluation time.
 * Labels: scenario_name, status
 */
const evalScenarioLatency = meter.createHistogram('agentshield.eval.scenario_latency_ms', {
    description: 'Per-scenario evaluation time',
    unit: 'ms',
    advice: {
        explicitBucketBoundaries: [100, 500, 1000, 5000, 15000, 30000],
    },
});

/* ------------------------------------------------------------------ */
/*  Export                                                             */
/* ------------------------------------------------------------------ */

/**
 * @typedef {Object} AgentShieldMetrics
 * @property {import('@opentelemetry/api').Counter} requestsTotal
 * @property {import('@opentelemetry/api').Counter} policyDecisions
 * @property {import('@opentelemetry/api').Counter} policyDenials
 * @property {import('@opentelemetry/api').Counter} authFailures
 * @property {import('@opentelemetry/api').Counter} budgetExceeded
 * @property {import('@opentelemetry/api').Counter} compliancePiiDetected
 * @property {import('@opentelemetry/api').Counter} complianceSamples
 * @property {import('@opentelemetry/api').Counter} evalRuns
 * @property {import('@opentelemetry/api').Histogram} gatewayLatency
 * @property {import('@opentelemetry/api').Histogram} policyEvaluateLatency
 * @property {import('@opentelemetry/api').Histogram} agentUpstreamLatency
 * @property {import('@opentelemetry/api').Histogram} agentTokens
 * @property {import('@opentelemetry/api').Histogram} evalScenarioLatency
 */
module.exports = {
    // Counters
    requestsTotal,
    policyDecisions,
    policyDenials,
    authFailures,
    budgetExceeded,
    compliancePiiDetected,
    complianceSamples,
    evalRuns,

    // Histograms
    gatewayLatency,
    policyEvaluateLatency,
    agentUpstreamLatency,
    agentTokens,
    evalScenarioLatency,
};
