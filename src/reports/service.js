const db = require('../db');
const logger = require('../config/logger');

/**
 * ReportService — query builders for all report types.
 * Each method returns a structured data object ready for JSON response or export.
 */
class ReportService {

    // ============================================
    // REPORT TYPE METADATA
    // ============================================
    static REPORT_TYPES = {
        access_decisions:       { label: 'Access Decision Summary',   category: 'Security & Access',     icon: '🛡️' },
        policy_effectiveness:   { label: 'Policy Effectiveness',      category: 'Security & Access',     icon: '📊' },
        compliance_posture:     { label: 'Compliance Posture',        category: 'Compliance & Audit',    icon: '📋' },
        compliance_history:     { label: 'Compliance Check History',  category: 'Compliance & Audit',    icon: '📜' },
        pii_exposure:           { label: 'PII Exposure Report',       category: 'Compliance & Audit',    icon: '🔒' },
        audit_export:           { label: 'Audit Trail Export',        category: 'Compliance & Audit',    icon: '📤' },
        cost_overview:          { label: 'Cost Overview',             category: 'Cost & Usage',          icon: '💰' },
        budget_utilization:     { label: 'Budget Utilization',        category: 'Cost & Usage',          icon: '📈' },
        token_usage:            { label: 'Token Usage Analytics',     category: 'Cost & Usage',          icon: '🔢' },
        agent_health:           { label: 'Agent Health & Availability', category: 'Agent Performance',   icon: '💚' },
        agent_scorecard:        { label: 'Agent Evaluation Scorecard', category: 'Agent Performance',    icon: '🎯' },
        agent_invocations:      { label: 'Agent Invocation Report',   category: 'Agent Performance',     icon: '📡' },
        guardrail_violations:   { label: 'Guardrail Violations',      category: 'Guardrails',            icon: '🚧' },
        guardrail_coverage:     { label: 'Guardrail Coverage',        category: 'Guardrails',            icon: '🔍' },
        governance_posture:     { label: 'Governance Posture',        category: 'Executive',             icon: '📊' },
        workflow_execution:     { label: 'Workflow Execution',        category: 'Executive',             icon: '⚙️' },
    };

    /**
     * List available report types with metadata
     */
    listReportTypes() {
        return Object.entries(ReportService.REPORT_TYPES).map(([key, meta]) => ({
            type: key,
            ...meta,
        }));
    }

    /**
     * Generate a report by type
     */
    async generate(type, filters = {}) {
        const fn = this[`_report_${type}`];
        if (!fn) throw new Error(`Unknown report type: ${type}`);
        const data = await fn.call(this, filters);
        return { type, generatedAt: new Date().toISOString(), filters, ...data };
    }

    // ============================================
    // HELPER: Parse date range filters
    // ============================================
    _parseDateRange(filters) {
        const from = filters.from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const to = filters.to || new Date().toISOString();
        return { from, to };
    }

    // ============================================
    // 1. ACCESS DECISION SUMMARY
    // ============================================
    async _report_access_decisions(filters) {
        const { from, to } = this._parseDateRange(filters);

        // Summary totals
        const summaryQ = await db.query(`
            SELECT
                COUNT(*)::int AS total_requests,
                COUNT(*) FILTER (WHERE outcome = 'allowed')::int AS allowed,
                COUNT(*) FILTER (WHERE outcome = 'denied')::int AS denied,
                COUNT(*) FILTER (WHERE outcome = 'error')::int AS errors,
                ROUND(AVG(latency_ms))::int AS avg_latency_ms
            FROM audit_log
            WHERE recorded_at BETWEEN $1 AND $2
        `, [from, to]);

        // Daily trend
        const trendQ = await db.query(`
            SELECT
                DATE(recorded_at) AS date,
                COUNT(*) FILTER (WHERE outcome = 'allowed')::int AS allowed,
                COUNT(*) FILTER (WHERE outcome = 'denied')::int AS denied,
                COUNT(*) FILTER (WHERE outcome = 'error')::int AS errors
            FROM audit_log
            WHERE recorded_at BETWEEN $1 AND $2
            GROUP BY DATE(recorded_at)
            ORDER BY date
        `, [from, to]);

        // Top denied actors
        const topDeniedActorsQ = await db.query(`
            SELECT actor_id, actor_type, COUNT(*)::int AS deny_count
            FROM audit_log
            WHERE outcome = 'denied' AND recorded_at BETWEEN $1 AND $2
                  AND actor_id IS NOT NULL
            GROUP BY actor_id, actor_type
            ORDER BY deny_count DESC
            LIMIT 5
        `, [from, to]);

        // Top denied resources
        const topDeniedResourcesQ = await db.query(`
            SELECT resource_type, resource_id, COUNT(*)::int AS deny_count
            FROM audit_log
            WHERE outcome = 'denied' AND recorded_at BETWEEN $1 AND $2
                  AND resource_id IS NOT NULL
            GROUP BY resource_type, resource_id
            ORDER BY deny_count DESC
            LIMIT 5
        `, [from, to]);

        // Outcome distribution by event_type
        const byEventTypeQ = await db.query(`
            SELECT event_type,
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE outcome = 'allowed')::int AS allowed,
                COUNT(*) FILTER (WHERE outcome = 'denied')::int AS denied
            FROM audit_log
            WHERE recorded_at BETWEEN $1 AND $2
            GROUP BY event_type
            ORDER BY total DESC
        `, [from, to]);

        const summary = summaryQ.rows[0] || {};
        return {
            label: 'Access Decision Summary',
            summary: {
                ...summary,
                allow_rate: summary.total_requests > 0 ? ((summary.allowed / summary.total_requests) * 100).toFixed(1) : '0.0',
                deny_rate: summary.total_requests > 0 ? ((summary.denied / summary.total_requests) * 100).toFixed(1) : '0.0',
            },
            daily_trend: trendQ.rows,
            top_denied_actors: topDeniedActorsQ.rows,
            top_denied_resources: topDeniedResourcesQ.rows,
            by_event_type: byEventTypeQ.rows,
        };
    }

    // ============================================
    // 2. POLICY EFFECTIVENESS
    // ============================================
    async _report_policy_effectiveness(filters) {
        const { from, to } = this._parseDateRange(filters);

        // Policy hit counts from audit details
        const policyHitsQ = await db.query(`
            SELECT
                details->>'matchedPolicy' AS policy_name,
                details->>'matchedPolicyId' AS policy_id,
                COUNT(*)::int AS hit_count,
                COUNT(*) FILTER (WHERE outcome = 'allowed')::int AS allowed,
                COUNT(*) FILTER (WHERE outcome = 'denied')::int AS denied,
                ROUND(AVG(latency_ms))::int AS avg_latency_ms
            FROM audit_log
            WHERE recorded_at BETWEEN $1 AND $2
                  AND details->>'matchedPolicy' IS NOT NULL
            GROUP BY details->>'matchedPolicy', details->>'matchedPolicyId'
            ORDER BY hit_count DESC
        `, [from, to]);

        // Dormant policies (active but never matched)
        const dormantQ = await db.query(`
            SELECT p.id, p.name, p.policy_type, p.priority, p.created_at
            FROM policies p
            WHERE p.is_active = true
                  AND p.id::text NOT IN (
                      SELECT COALESCE(details->>'matchedPolicyId', '')
                      FROM audit_log
                      WHERE recorded_at BETWEEN $1 AND $2
                            AND details->>'matchedPolicyId' IS NOT NULL
                  )
        `, [from, to]);

        return {
            label: 'Policy Effectiveness Report',
            policy_hits: policyHitsQ.rows,
            dormant_policies: dormantQ.rows,
            total_active_policies: policyHitsQ.rows.length + dormantQ.rows.length,
        };
    }

    // ============================================
    // 3. COMPLIANCE POSTURE
    // ============================================
    async _report_compliance_posture(filters) {
        const { from, to } = this._parseDateRange(filters);

        // Per-framework check results
        const frameworkQ = await db.query(`
            SELECT
                cc.framework,
                COUNT(ch.id)::int AS total_checks,
                COUNT(*) FILTER (WHERE ch.status = 'passed')::int AS passed,
                COUNT(*) FILTER (WHERE ch.status = 'failed')::int AS failed,
                COUNT(*) FILTER (WHERE ch.status = 'partial')::int AS partial,
                CASE WHEN COUNT(ch.id) > 0
                     THEN ROUND((COUNT(*) FILTER (WHERE ch.status = 'passed')::decimal / COUNT(ch.id)) * 100, 1)
                     ELSE 0 END AS pass_rate
            FROM compliance_configs cc
            LEFT JOIN compliance_checks ch ON ch.config_id = cc.id
                AND ch.started_at BETWEEN $1 AND $2
            WHERE cc.is_active = true
            GROUP BY cc.framework
            ORDER BY cc.framework
        `, [from, to]);

        // PII detection summary
        const piiQ = await db.query(`
            SELECT
                COUNT(*)::int AS total_samples,
                COUNT(*) FILTER (WHERE pii_detected = true)::int AS pii_found,
                COUNT(*) FILTER (WHERE flagged = true)::int AS flagged
            FROM compliance_samples
            WHERE sampled_at BETWEEN $1 AND $2
        `, [from, to]);

        // Compliance trend (checks over time)
        const trendQ = await db.query(`
            SELECT
                DATE(ch.started_at) AS date,
                COUNT(*) FILTER (WHERE ch.status = 'passed')::int AS passed,
                COUNT(*) FILTER (WHERE ch.status = 'failed')::int AS failed
            FROM compliance_checks ch
            WHERE ch.started_at BETWEEN $1 AND $2
            GROUP BY DATE(ch.started_at)
            ORDER BY date
        `, [from, to]);

        return {
            label: 'Compliance Posture Report',
            by_framework: frameworkQ.rows,
            pii_summary: piiQ.rows[0] || {},
            trend: trendQ.rows,
        };
    }

    // ============================================
    // 4. COMPLIANCE CHECK HISTORY
    // ============================================
    async _report_compliance_history(filters) {
        const { from, to } = this._parseDateRange(filters);
        const framework = filters.framework || null;

        const conditions = ['ch.started_at BETWEEN $1 AND $2'];
        const params = [from, to];
        let idx = 3;

        if (framework) {
            conditions.push(`cc.framework = $${idx++}`);
            params.push(framework);
        }

        const checksQ = await db.query(`
            SELECT
                ch.id, ch.status, ch.total_rules, ch.passed_rules, ch.failed_rules,
                ch.sample_source, ch.started_at, ch.completed_at,
                cc.name AS config_name, cc.framework
            FROM compliance_checks ch
            JOIN compliance_configs cc ON cc.id = ch.config_id
            WHERE ${conditions.join(' AND ')}
            ORDER BY ch.started_at DESC
            LIMIT 100
        `, params);

        // Persistent failures: rules that fail repeatedly
        const failingRulesQ = await db.query(`
            SELECT
                rule_result->>'ruleName' AS rule_name,
                rule_result->>'ruleId' AS rule_id,
                COUNT(*)::int AS failure_count
            FROM compliance_checks ch,
                 jsonb_array_elements(ch.results) AS rule_result
            WHERE ch.started_at BETWEEN $1 AND $2
                  AND rule_result->>'result' = 'FAILED'
            GROUP BY rule_result->>'ruleName', rule_result->>'ruleId'
            ORDER BY failure_count DESC
            LIMIT 10
        `, [from, to]);

        return {
            label: 'Compliance Check History',
            checks: checksQ.rows,
            persistent_failures: failingRulesQ.rows,
        };
    }

    // ============================================
    // 5. PII EXPOSURE
    // ============================================
    async _report_pii_exposure(filters) {
        const { from, to } = this._parseDateRange(filters);

        // PII by type
        const byTypeQ = await db.query(`
            SELECT
                pii_type,
                COUNT(*)::int AS count
            FROM compliance_samples,
                 jsonb_array_elements_text(pii_types) AS pii_type
            WHERE pii_detected = true
                  AND sampled_at BETWEEN $1 AND $2
            GROUP BY pii_type
            ORDER BY count DESC
        `, [from, to]);

        // PII by agent
        const byAgentQ = await db.query(`
            SELECT
                a.name AS agent_name, a.slug AS agent_slug,
                COUNT(*)::int AS pii_count
            FROM compliance_samples cs
            JOIN agents a ON a.id = cs.agent_id
            WHERE cs.pii_detected = true
                  AND cs.sampled_at BETWEEN $1 AND $2
            GROUP BY a.name, a.slug
            ORDER BY pii_count DESC
            LIMIT 10
        `, [from, to]);

        // PII trend
        const trendQ = await db.query(`
            SELECT
                DATE(sampled_at) AS date,
                COUNT(*) FILTER (WHERE pii_detected = true)::int AS pii_detected,
                COUNT(*)::int AS total_sampled
            FROM compliance_samples
            WHERE sampled_at BETWEEN $1 AND $2
            GROUP BY DATE(sampled_at)
            ORDER BY date
        `, [from, to]);

        return {
            label: 'PII Exposure Report',
            by_type: byTypeQ.rows,
            by_agent: byAgentQ.rows,
            trend: trendQ.rows,
        };
    }

    // ============================================
    // 6. AUDIT TRAIL EXPORT
    // ============================================
    async _report_audit_export(filters) {
        const { from, to } = this._parseDateRange(filters);
        const limit = Math.min(parseInt(filters.limit) || 10000, 50000);

        const logsQ = await db.query(`
            SELECT
                id, trace_id, event_type, actor_id, actor_type,
                resource_type, resource_id, action, outcome,
                details, ip_address, latency_ms, recorded_at
            FROM audit_log
            WHERE recorded_at BETWEEN $1 AND $2
            ORDER BY recorded_at DESC
            LIMIT $3
        `, [from, to, limit]);

        return {
            label: 'Audit Trail Export',
            total_records: logsQ.rows.length,
            records: logsQ.rows,
        };
    }

    // ============================================
    // 7. COST OVERVIEW
    // ============================================
    async _report_cost_overview(filters) {
        const { from, to } = this._parseDateRange(filters);

        // Summary
        const summaryQ = await db.query(`
            SELECT
                SUM(total_tokens)::bigint AS total_tokens,
                SUM(cost_cents)::bigint AS total_cost_cents,
                COUNT(*)::int AS total_requests,
                SUM(input_tokens)::bigint AS total_input_tokens,
                SUM(output_tokens)::bigint AS total_output_tokens
            FROM cost_records
            WHERE recorded_at BETWEEN $1 AND $2
        `, [from, to]);

        // Daily trend
        const trendQ = await db.query(`
            SELECT
                DATE(recorded_at) AS date,
                SUM(cost_cents)::int AS cost_cents,
                SUM(total_tokens)::int AS tokens,
                COUNT(*)::int AS requests
            FROM cost_records
            WHERE recorded_at BETWEEN $1 AND $2
            GROUP BY DATE(recorded_at)
            ORDER BY date
        `, [from, to]);

        // By agent
        const byAgentQ = await db.query(`
            SELECT
                a.name AS agent_name, a.slug AS agent_slug,
                SUM(cr.cost_cents)::int AS cost_cents,
                SUM(cr.total_tokens)::int AS tokens,
                COUNT(*)::int AS requests
            FROM cost_records cr
            JOIN agents a ON a.id = cr.agent_id
            WHERE cr.recorded_at BETWEEN $1 AND $2
            GROUP BY a.name, a.slug
            ORDER BY cost_cents DESC
            LIMIT 10
        `, [from, to]);

        // By model
        const byModelQ = await db.query(`
            SELECT
                model_name,
                SUM(cost_cents)::int AS cost_cents,
                SUM(total_tokens)::int AS tokens,
                COUNT(*)::int AS requests
            FROM cost_records
            WHERE recorded_at BETWEEN $1 AND $2
                  AND model_name IS NOT NULL
            GROUP BY model_name
            ORDER BY cost_cents DESC
        `, [from, to]);

        const summary = summaryQ.rows[0] || {};
        return {
            label: 'Cost Overview Report',
            summary: {
                ...summary,
                total_cost_dollars: ((parseInt(summary.total_cost_cents) || 0) / 100).toFixed(2),
            },
            daily_trend: trendQ.rows,
            by_agent: byAgentQ.rows,
            by_model: byModelQ.rows,
        };
    }

    // ============================================
    // 8. BUDGET UTILIZATION
    // ============================================
    async _report_budget_utilization(filters) {
        const budgetsQ = await db.query(`
            SELECT
                b.id, b.name, b.scope_type, b.scope_id, b.period,
                b.token_limit, b.cost_limit_cents,
                b.current_tokens, b.current_cost_cents,
                b.warn_threshold, b.hard_limit, b.is_active,
                CASE WHEN b.token_limit > 0
                     THEN ROUND((b.current_tokens::decimal / b.token_limit) * 100, 1)
                     ELSE 0 END AS token_utilization_pct,
                CASE WHEN b.cost_limit_cents > 0
                     THEN ROUND((b.current_cost_cents::decimal / b.cost_limit_cents) * 100, 1)
                     ELSE 0 END AS cost_utilization_pct
            FROM budgets b
            WHERE b.is_active = true
            ORDER BY cost_utilization_pct DESC
        `);

        // Budget alerts (over warning threshold)
        const alerts = budgetsQ.rows.filter(b => {
            const threshold = parseFloat(b.warn_threshold) * 100;
            return parseFloat(b.token_utilization_pct) >= threshold ||
                   parseFloat(b.cost_utilization_pct) >= threshold;
        });

        return {
            label: 'Budget Utilization Report',
            budgets: budgetsQ.rows,
            alerts,
            total_budgets: budgetsQ.rows.length,
            over_threshold_count: alerts.length,
        };
    }

    // ============================================
    // 9. TOKEN USAGE ANALYTICS
    // ============================================
    async _report_token_usage(filters) {
        const { from, to } = this._parseDateRange(filters);

        // Input vs output ratio by agent
        const ratioQ = await db.query(`
            SELECT
                a.name AS agent_name, a.slug AS agent_slug,
                SUM(cr.input_tokens)::int AS input_tokens,
                SUM(cr.output_tokens)::int AS output_tokens,
                CASE WHEN SUM(cr.input_tokens) > 0
                     THEN ROUND(SUM(cr.output_tokens)::decimal / SUM(cr.input_tokens), 2)
                     ELSE 0 END AS output_input_ratio
            FROM cost_records cr
            JOIN agents a ON a.id = cr.agent_id
            WHERE cr.recorded_at BETWEEN $1 AND $2
            GROUP BY a.name, a.slug
            ORDER BY (SUM(cr.input_tokens) + SUM(cr.output_tokens)) DESC
            LIMIT 10
        `, [from, to]);

        // Token trend over time
        const trendQ = await db.query(`
            SELECT
                DATE(recorded_at) AS date,
                SUM(input_tokens)::int AS input_tokens,
                SUM(output_tokens)::int AS output_tokens
            FROM cost_records
            WHERE recorded_at BETWEEN $1 AND $2
            GROUP BY DATE(recorded_at)
            ORDER BY date
        `, [from, to]);

        // Model utilization
        const modelQ = await db.query(`
            SELECT
                model_name,
                COUNT(*)::int AS request_count,
                SUM(total_tokens)::int AS total_tokens
            FROM cost_records
            WHERE recorded_at BETWEEN $1 AND $2
                  AND model_name IS NOT NULL
            GROUP BY model_name
            ORDER BY total_tokens DESC
        `, [from, to]);

        // Top 10 most expensive requests
        const outliersQ = await db.query(`
            SELECT
                cr.trace_id, cr.model_name,
                cr.input_tokens, cr.output_tokens, cr.total_tokens,
                cr.cost_cents, cr.recorded_at,
                a.name AS agent_name
            FROM cost_records cr
            LEFT JOIN agents a ON a.id = cr.agent_id
            WHERE cr.recorded_at BETWEEN $1 AND $2
            ORDER BY cr.total_tokens DESC
            LIMIT 10
        `, [from, to]);

        return {
            label: 'Token Usage Analytics',
            by_agent_ratio: ratioQ.rows,
            daily_trend: trendQ.rows,
            by_model: modelQ.rows,
            top_outliers: outliersQ.rows,
        };
    }

    // ============================================
    // 10. AGENT HEALTH & AVAILABILITY
    // ============================================
    async _report_agent_health(filters) {
        const agentsQ = await db.query(`
            SELECT
                id, name, slug, type, vendor, protocol,
                health_status, is_active,
                consecutive_failures,
                last_health_check,
                created_at
            FROM agents
            ORDER BY
                CASE health_status
                    WHEN 'unhealthy' THEN 0
                    WHEN 'degraded' THEN 1
                    WHEN 'unknown' THEN 2
                    WHEN 'healthy' THEN 3
                END,
                name
        `);

        const summary = {
            total: agentsQ.rows.length,
            healthy: agentsQ.rows.filter(a => a.health_status === 'healthy').length,
            unhealthy: agentsQ.rows.filter(a => a.health_status === 'unhealthy').length,
            degraded: agentsQ.rows.filter(a => a.health_status === 'degraded').length,
            unknown: agentsQ.rows.filter(a => a.health_status === 'unknown').length,
            inactive: agentsQ.rows.filter(a => !a.is_active).length,
        };

        return {
            label: 'Agent Health & Availability Report',
            summary,
            agents: agentsQ.rows,
        };
    }

    // ============================================
    // 11. AGENT EVALUATION SCORECARD
    // ============================================
    async _report_agent_scorecard(filters) {
        const { from, to } = this._parseDateRange(filters);
        const agentId = filters.agentId || null;

        const conditions = ['er.started_at BETWEEN $1 AND $2'];
        const params = [from, to];
        let idx = 3;

        if (agentId) {
            conditions.push(`er.agent_id = $${idx++}`);
            params.push(agentId);
        }

        const runsQ = await db.query(`
            SELECT
                er.id, er.status, er.eval_mode, er.judge_model,
                er.total_scenarios, er.passed_scenarios, er.failed_scenarios,
                er.needs_review, er.overall_score,
                er.node_scores, er.session_scores, er.system_scores,
                er.started_at, er.completed_at,
                a.name AS agent_name, a.slug AS agent_slug,
                es.name AS suite_name
            FROM eval_runs er
            JOIN agents a ON a.id = er.agent_id
            JOIN eval_suites es ON es.id = er.suite_id
            WHERE ${conditions.join(' AND ')}
            ORDER BY er.started_at DESC
            LIMIT 50
        `, params);

        // Score trends per agent
        const trendQ = await db.query(`
            SELECT
                a.name AS agent_name,
                DATE(er.started_at) AS date,
                ROUND(AVG(er.overall_score), 2) AS avg_score
            FROM eval_runs er
            JOIN agents a ON a.id = er.agent_id
            WHERE er.started_at BETWEEN $1 AND $2
                  AND er.overall_score IS NOT NULL
            ${agentId ? `AND er.agent_id = $3` : ''}
            GROUP BY a.name, DATE(er.started_at)
            ORDER BY date
        `, agentId ? [from, to, agentId] : [from, to]);

        // HITL review summary
        const reviewsQ = await db.query(`
            SELECT
                review_action, COUNT(*)::int AS count
            FROM eval_reviews
            WHERE created_at BETWEEN $1 AND $2
            GROUP BY review_action
        `, [from, to]);

        return {
            label: 'Agent Evaluation Scorecard',
            runs: runsQ.rows,
            score_trend: trendQ.rows,
            review_summary: reviewsQ.rows,
        };
    }

    // ============================================
    // 12. AGENT INVOCATIONS
    // ============================================
    async _report_agent_invocations(filters) {
        const { from, to } = this._parseDateRange(filters);

        // Invocations per agent
        const byAgentQ = await db.query(`
            SELECT
                resource_id AS agent_id,
                COUNT(*)::int AS invocation_count,
                ROUND(AVG(latency_ms))::int AS avg_latency_ms,
                MIN(latency_ms)::int AS min_latency_ms,
                MAX(latency_ms)::int AS max_latency_ms,
                COUNT(*) FILTER (WHERE outcome = 'allowed')::int AS success_count,
                COUNT(*) FILTER (WHERE outcome = 'error')::int AS error_count
            FROM audit_log
            WHERE event_type = 'agent_invocation'
                  AND recorded_at BETWEEN $1 AND $2
                  AND resource_id IS NOT NULL
            GROUP BY resource_id
            ORDER BY invocation_count DESC
        `, [from, to]);

        // Hourly heatmap data
        const hourlyQ = await db.query(`
            SELECT
                EXTRACT(DOW FROM recorded_at)::int AS day_of_week,
                EXTRACT(HOUR FROM recorded_at)::int AS hour,
                COUNT(*)::int AS count
            FROM audit_log
            WHERE event_type = 'agent_invocation'
                  AND recorded_at BETWEEN $1 AND $2
            GROUP BY day_of_week, hour
            ORDER BY day_of_week, hour
        `, [from, to]);

        // Daily volume
        const trendQ = await db.query(`
            SELECT
                DATE(recorded_at) AS date,
                COUNT(*)::int AS invocations,
                ROUND(AVG(latency_ms))::int AS avg_latency_ms
            FROM audit_log
            WHERE event_type = 'agent_invocation'
                  AND recorded_at BETWEEN $1 AND $2
            GROUP BY DATE(recorded_at)
            ORDER BY date
        `, [from, to]);

        return {
            label: 'Agent Invocation Report',
            by_agent: byAgentQ.rows,
            hourly_heatmap: hourlyQ.rows,
            daily_trend: trendQ.rows,
        };
    }

    // ============================================
    // 13. GUARDRAIL VIOLATIONS
    // ============================================
    async _report_guardrail_violations(filters) {
        const { from, to } = this._parseDateRange(filters);

        // Test run results
        const runsQ = await db.query(`
            SELECT
                gp.name AS profile_name, gp.mode,
                gtr.status, gtr.total_tests, gtr.passed_tests, gtr.failed_tests,
                gtr.started_at,
                a.name AS agent_name
            FROM guardrail_test_runs gtr
            JOIN guardrail_profiles gp ON gp.id = gtr.profile_id
            LEFT JOIN agents a ON a.id = gtr.agent_id
            WHERE gtr.started_at BETWEEN $1 AND $2
            ORDER BY gtr.started_at DESC
            LIMIT 50
        `, [from, to]);

        // Rule type breakdown from test results
        const byRuleTypeQ = await db.query(`
            SELECT
                gr.rule_type,
                gr.severity,
                COUNT(DISTINCT gtr.id)::int AS test_runs_involved,
                SUM(gtr.failed_tests)::int AS total_failures
            FROM guardrail_test_runs gtr
            JOIN guardrail_profiles gp ON gp.id = gtr.profile_id
            JOIN guardrail_rules gr ON gr.profile_id = gp.id
            WHERE gtr.started_at BETWEEN $1 AND $2
                  AND gtr.failed_tests > 0
            GROUP BY gr.rule_type, gr.severity
            ORDER BY total_failures DESC
        `, [from, to]);

        return {
            label: 'Guardrail Violations Report',
            test_runs: runsQ.rows,
            by_rule_type: byRuleTypeQ.rows,
        };
    }

    // ============================================
    // 14. GUARDRAIL COVERAGE
    // ============================================
    async _report_guardrail_coverage(filters) {
        // Agents with guardrails assigned
        const protectedQ = await db.query(`
            SELECT
                a.id, a.name, a.slug,
                COUNT(ag.profile_id)::int AS profile_count,
                ARRAY_AGG(gp.name) AS profile_names
            FROM agents a
            LEFT JOIN agent_guardrails ag ON ag.agent_id = a.id
            LEFT JOIN guardrail_profiles gp ON gp.id = ag.profile_id
            WHERE a.is_active = true
            GROUP BY a.id, a.name, a.slug
            ORDER BY profile_count DESC, a.name
        `);

        const unprotected = protectedQ.rows.filter(a => a.profile_count === 0);
        const protected_ = protectedQ.rows.filter(a => a.profile_count > 0);

        // Rules that have never triggered
        const untriggeredQ = await db.query(`
            SELECT
                gr.id, gr.name, gr.rule_type, gr.severity,
                gp.name AS profile_name
            FROM guardrail_rules gr
            JOIN guardrail_profiles gp ON gp.id = gr.profile_id
            WHERE gr.is_enabled = true
            ORDER BY gp.name, gr.name
        `);

        return {
            label: 'Guardrail Coverage Report',
            summary: {
                total_agents: protectedQ.rows.length,
                protected_count: protected_.length,
                unprotected_count: unprotected.length,
                coverage_pct: protectedQ.rows.length > 0
                    ? ((protected_.length / protectedQ.rows.length) * 100).toFixed(1)
                    : '0.0',
            },
            protected_agents: protected_,
            unprotected_agents: unprotected,
            all_rules: untriggeredQ.rows,
        };
    }

    // ============================================
    // 15. GOVERNANCE POSTURE (EXECUTIVE)
    // ============================================
    async _report_governance_posture(filters) {
        const { from, to } = this._parseDateRange(filters);

        // Pull all key stats in parallel
        const [accessData, complianceData, costData, agentData, guardrailData] = await Promise.all([
            this._report_access_decisions(filters),
            this._report_compliance_posture(filters),
            this._report_cost_overview(filters),
            this._report_agent_health(filters),
            this._report_guardrail_violations(filters),
        ]);

        return {
            label: 'Governance Posture — Executive Summary',
            period: { from, to },
            security: {
                total_requests: accessData.summary.total_requests,
                deny_rate: accessData.summary.deny_rate,
                top_threats: accessData.top_denied_actors.slice(0, 3),
            },
            compliance: {
                frameworks: complianceData.by_framework,
                pii: complianceData.pii_summary,
            },
            cost: {
                total_spend: costData.summary.total_cost_dollars,
                top_agents: costData.by_agent.slice(0, 3),
            },
            agents: {
                fleet: agentData.summary,
            },
            guardrails: {
                violation_count: guardrailData.test_runs.reduce((s, r) => s + (r.failed_tests || 0), 0),
                threat_types: guardrailData.by_rule_type.slice(0, 3),
            },
        };
    }

    // ============================================
    // 16. WORKFLOW EXECUTION
    // ============================================
    async _report_workflow_execution(filters) {
        const { from, to } = this._parseDateRange(filters);

        const executionsQ = await db.query(`
            SELECT
                resource_id AS workflow_id,
                COUNT(*)::int AS execution_count,
                COUNT(*) FILTER (WHERE outcome = 'allowed')::int AS success_count,
                COUNT(*) FILTER (WHERE outcome = 'error')::int AS error_count,
                ROUND(AVG(latency_ms))::int AS avg_latency_ms,
                MAX(latency_ms)::int AS max_latency_ms
            FROM audit_log
            WHERE event_type = 'workflow_execution'
                  AND recorded_at BETWEEN $1 AND $2
                  AND resource_id IS NOT NULL
            GROUP BY resource_id
            ORDER BY execution_count DESC
        `, [from, to]);

        const trendQ = await db.query(`
            SELECT
                DATE(recorded_at) AS date,
                COUNT(*)::int AS executions,
                COUNT(*) FILTER (WHERE outcome = 'error')::int AS errors
            FROM audit_log
            WHERE event_type = 'workflow_execution'
                  AND recorded_at BETWEEN $1 AND $2
            GROUP BY DATE(recorded_at)
            ORDER BY date
        `, [from, to]);

        return {
            label: 'Workflow Execution Report',
            by_workflow: executionsQ.rows,
            daily_trend: trendQ.rows,
        };
    }

    // ============================================
    // SAVED REPORT CONFIGS (CRUD)
    // ============================================
    async saveConfig(data, userId) {
        const { rows } = await db.query(`
            INSERT INTO report_configs (name, report_type, filters, schedule, recipients, created_by)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
        `, [data.name, data.report_type, JSON.stringify(data.filters || {}),
            data.schedule || null, JSON.stringify(data.recipients || []), userId]);
        return rows[0];
    }

    async listConfigs(userId) {
        const { rows } = await db.query(`
            SELECT * FROM report_configs WHERE created_by = $1 OR created_by IS NULL
            ORDER BY created_at DESC
        `, [userId]);
        return rows;
    }

    async deleteConfig(id) {
        await db.query('DELETE FROM report_configs WHERE id = $1', [id]);
    }

    // ============================================
    // SNAPSHOTS
    // ============================================
    async saveSnapshot(reportType, data, filters, userId, name) {
        const { rows } = await db.query(`
            INSERT INTO report_snapshots (report_type, data, filters, generated_by, name)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id, report_type, generated_at, name
        `, [reportType, JSON.stringify(data), JSON.stringify(filters || {}), userId, name || null]);
        return rows[0];
    }

    async listSnapshots(reportType, limit = 20) {
        const conditions = [];
        const params = [];
        let idx = 1;
        if (reportType) {
            conditions.push(`report_type = $${idx++}`);
            params.push(reportType);
        }
        params.push(limit);
        const { rows } = await db.query(`
            SELECT id, report_type, name, filters, generated_by, generated_at
            FROM report_snapshots
            ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''}
            ORDER BY generated_at DESC
            LIMIT $${idx}
        `, params);
        return rows;
    }

    async getSnapshot(id) {
        const { rows } = await db.query('SELECT * FROM report_snapshots WHERE id = $1', [id]);
        if (!rows.length) throw new Error('Snapshot not found');
        return rows[0];
    }
}

module.exports = new ReportService();
