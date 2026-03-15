const db = require('../db');
const logger = require('../config/logger');
const { AppError } = require('../registry/service');

class CostService {
    /**
     * Record token usage for a request
     */
    async recordUsage(usageData) {
        const {
            traceId, agentId, workflowId, userId,
            inputTokens, outputTokens, costCents, modelName,
        } = usageData;

        const totalTokens = (inputTokens || 0) + (outputTokens || 0);

        // Store the record
        await db.query(
            `INSERT INTO cost_records (trace_id, agent_id, workflow_id, user_id, input_tokens, output_tokens, total_tokens, cost_cents, model_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [traceId, agentId || null, workflowId || null, userId || null,
                inputTokens || 0, outputTokens || 0, totalTokens, costCents || 0, modelName || null]
        );

        // Update budget counters
        await this._updateBudgets(userId, totalTokens, costCents || 0);
    }

    /**
     * Check if a request is within budget
     * Returns { allowed: boolean, reason: string, budget: object|null }
     */
    async checkBudget(userId, teamId, departmentId) {
        const scopes = [];
        if (userId) scopes.push({ type: 'user', id: userId });
        if (teamId) scopes.push({ type: 'team', id: teamId });
        if (departmentId) scopes.push({ type: 'department', id: departmentId });
        scopes.push({ type: 'global', id: 'global' });

        for (const scope of scopes) {
            const { rows } = await db.query(
                `SELECT * FROM budgets
         WHERE scope_type = $1 AND scope_id = $2 AND is_active = true
         AND period_start <= NOW()`,
                [scope.type, scope.id]
            );

            for (const budget of rows) {
                // Check if period has expired, reset if so
                if (this._isPeriodExpired(budget)) {
                    await this._resetBudget(budget.id);
                    continue;
                }

                // Check token limit
                if (budget.token_limit && budget.current_tokens >= budget.token_limit) {
                    if (budget.hard_limit) {
                        return {
                            allowed: false,
                            reason: `Token budget exceeded for ${scope.type} "${scope.id}" (${budget.current_tokens}/${budget.token_limit})`,
                            budget,
                        };
                    }
                }

                // Check cost limit
                if (budget.cost_limit_cents && budget.current_cost_cents >= budget.cost_limit_cents) {
                    if (budget.hard_limit) {
                        return {
                            allowed: false,
                            reason: `Cost budget exceeded for ${scope.type} "${scope.id}" ($${(budget.current_cost_cents / 100).toFixed(2)}/$${(budget.cost_limit_cents / 100).toFixed(2)})`,
                            budget,
                        };
                    }
                }

                // Check warn threshold
                if (budget.token_limit) {
                    const usage = budget.current_tokens / budget.token_limit;
                    if (usage >= parseFloat(budget.warn_threshold)) {
                        logger.warn(`Budget warning: ${scope.type} "${scope.id}" at ${(usage * 100).toFixed(1)}% token usage`);
                    }
                }
            }
        }

        return { allowed: true, reason: 'Within budget', budget: null };
    }

    /**
     * Update budget counters after a request
     */
    async _updateBudgets(userId, tokens, costCents) {
        if (!userId) return;

        await db.query(
            `UPDATE budgets SET
        current_tokens = current_tokens + $1,
        current_cost_cents = current_cost_cents + $2,
        updated_at = NOW()
       WHERE scope_id = $3 AND is_active = true`,
            [tokens, costCents, userId]
        );
    }

    /**
     * Check if a budget period has expired
     */
    _isPeriodExpired(budget) {
        const now = new Date();
        const start = new Date(budget.period_start);
        const diffMs = now - start;
        const diffDays = diffMs / (1000 * 60 * 60 * 24);

        switch (budget.period) {
            case 'daily': return diffDays >= 1;
            case 'weekly': return diffDays >= 7;
            case 'monthly': return diffDays >= 30;
            case 'quarterly': return diffDays >= 90;
            default: return false;
        }
    }

    /**
     * Reset a budget for a new period
     */
    async _resetBudget(budgetId) {
        await db.query(
            `UPDATE budgets SET current_tokens = 0, current_cost_cents = 0, period_start = NOW(), updated_at = NOW()
       WHERE id = $1`,
            [budgetId]
        );
    }

    // ============================================
    // CRUD & Reporting
    // ============================================

    async createBudget(data) {
        const result = await db.query(
            `INSERT INTO budgets (name, scope_type, scope_id, token_limit, cost_limit_cents, period, warn_threshold, hard_limit)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
            [data.name, data.scopeType, data.scopeId, data.tokenLimit || null,
            data.costLimitCents || null, data.period, data.warnThreshold || 0.80,
            data.hardLimit !== false]
        );
        return result.rows[0];
    }

    async listBudgets() {
        const result = await db.query('SELECT * FROM budgets ORDER BY created_at DESC');
        return result.rows;
    }

    async updateBudget(id, updates) {
        const fields = [];
        const params = [];
        let idx = 1;

        if (updates.name) { fields.push(`name = $${idx++}`); params.push(updates.name); }
        if (updates.tokenLimit !== undefined) { fields.push(`token_limit = $${idx++}`); params.push(updates.tokenLimit); }
        if (updates.costLimitCents !== undefined) { fields.push(`cost_limit_cents = $${idx++}`); params.push(updates.costLimitCents); }
        if (updates.warnThreshold !== undefined) { fields.push(`warn_threshold = $${idx++}`); params.push(updates.warnThreshold); }
        if (updates.hardLimit !== undefined) { fields.push(`hard_limit = $${idx++}`); params.push(updates.hardLimit); }
        if (updates.isActive !== undefined) { fields.push(`is_active = $${idx++}`); params.push(updates.isActive); }

        if (fields.length === 0) return null;

        fields.push('updated_at = NOW()');
        params.push(id);

        const result = await db.query(
            `UPDATE budgets SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
            params
        );
        return result.rows[0];
    }

    async getUsageReport(filters = {}) {
        const conditions = ['1=1'];
        const params = [];
        let idx = 1;

        if (filters.userId) { conditions.push(`user_id = $${idx++}`); params.push(filters.userId); }
        if (filters.agentId) { conditions.push(`agent_id = $${idx++}`); params.push(filters.agentId); }
        if (filters.from) { conditions.push(`recorded_at >= $${idx++}`); params.push(filters.from); }
        if (filters.to) { conditions.push(`recorded_at <= $${idx++}`); params.push(filters.to); }

        const result = await db.query(
            `SELECT
        COALESCE(a.name, 'Unknown') as agent_name,
        COUNT(*) as request_count,
        SUM(total_tokens) as total_tokens,
        SUM(input_tokens) as total_input_tokens,
        SUM(output_tokens) as total_output_tokens,
        SUM(cost_cents) as total_cost_cents
       FROM cost_records cr
       LEFT JOIN agents a ON a.id = cr.agent_id
       WHERE ${conditions.join(' AND ')}
       GROUP BY a.name
       ORDER BY total_tokens DESC`,
            params
        );

        return result.rows;
    }

    async getStats() {
        const result = await db.query(`
      SELECT
        SUM(total_tokens) as total_tokens,
        SUM(cost_cents) as total_cost_cents,
        COUNT(*) as total_requests,
        SUM(total_tokens) FILTER (WHERE recorded_at >= NOW() - INTERVAL '24 hours') as tokens_last_24h,
        SUM(cost_cents) FILTER (WHERE recorded_at >= NOW() - INTERVAL '24 hours') as cost_last_24h
      FROM cost_records
    `);
        return result.rows[0];
    }
}

module.exports = new CostService();
