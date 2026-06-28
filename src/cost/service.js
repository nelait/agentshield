const db = require('../db');
const logger = require('../config/logger');
const { AppError } = require('../registry/service');

// ============================================
// MODEL PRICING TABLE (cost per 1M tokens, in cents)
// Used to auto-estimate cost when the upstream agent
// does not return cost_cents in its usage response.
// ============================================
const MODEL_PRICING = {
    // OpenAI
    'gpt-4o':             { input: 250,  output: 1000 },
    'gpt-4o-mini':        { input: 15,   output: 60   },
    'gpt-4-turbo':        { input: 1000, output: 3000 },
    'gpt-4':              { input: 3000, output: 6000 },
    'gpt-3.5-turbo':      { input: 50,   output: 150  },
    'o1':                 { input: 1500, output: 6000 },
    'o1-mini':            { input: 300,  output: 1200 },
    'o3-mini':            { input: 110,  output: 440  },

    // Anthropic
    'claude-sonnet-4-20250514':  { input: 300,  output: 1500 },
    'claude-3-5-sonnet-20241022': { input: 300,  output: 1500 },
    'claude-3-5-haiku-20241022': { input: 80,   output: 400  },
    'claude-3-opus-20240229':    { input: 1500, output: 7500 },

    // Google
    'gemini-2.5-pro':     { input: 125,  output: 1000 },
    'gemini-2.5-flash':   { input: 15,   output: 60   },
    'gemini-2.0-flash':   { input: 10,   output: 40   },
    'gemini-1.5-pro':     { input: 125,  output: 500  },
    'gemini-1.5-flash':   { input: 7.5,  output: 30   },

    // Meta / Open-source (typical hosted pricing)
    'llama-3.1-70b':      { input: 88,   output: 88   },
    'llama-3.1-8b':       { input: 18,   output: 18   },
    'mixtral-8x7b':       { input: 24,   output: 24   },
};

class CostService {
    /**
     * Estimate cost in cents from token counts and model name.
     * Uses the MODEL_PRICING lookup table. Falls back to 0 if model unknown.
     */
    estimateCost(modelName, inputTokens, outputTokens) {
        if (!modelName) return 0;

        // Try exact match first, then partial match
        const key = Object.keys(MODEL_PRICING).find(k =>
            modelName === k || modelName.startsWith(k) || modelName.includes(k)
        );
        if (!key) return 0;

        const pricing = MODEL_PRICING[key];
        // Pricing is per 1M tokens, convert to per-token then to cents
        const inputCost = (inputTokens || 0) * pricing.input / 1000000;
        const outputCost = (outputTokens || 0) * pricing.output / 1000000;
        return Math.round(inputCost + outputCost);
    }

    /**
     * Get the model pricing table for display in the admin UI.
     */
    getModelPricing() {
        return Object.entries(MODEL_PRICING).map(([model, pricing]) => ({
            model,
            inputPer1M: pricing.input,
            outputPer1M: pricing.output,
        }));
    }

    /**
     * Record token usage for a request.
     * Auto-estimates cost if not provided by the upstream agent.
     */
    async recordUsage(usageData) {
        const {
            traceId, agentId, workflowId, userId,
            teamId, department,
            inputTokens, outputTokens, costCents, modelName,
        } = usageData;

        const totalTokens = (inputTokens || 0) + (outputTokens || 0);

        // Auto-estimate cost if upstream didn't provide it
        const finalCostCents = costCents > 0
            ? costCents
            : this.estimateCost(modelName, inputTokens, outputTokens);

        // Store the record
        await db.query(
            `INSERT INTO cost_records (trace_id, agent_id, workflow_id, user_id, input_tokens, output_tokens, total_tokens, cost_cents, model_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [traceId, agentId || null, workflowId || null, userId || null,
                inputTokens || 0, outputTokens || 0, totalTokens, finalCostCents, modelName || null]
        );

        // Update budget counters for all matching scopes (including agent-scoped budgets)
        await this._updateBudgets({ userId, teamId, department, agentId }, totalTokens, finalCostCents);
    }

    /**
     * Check if a request is within budget
     * Returns { allowed: boolean, reason: string, budget: object|null }
     */
    async checkBudget(userId, teamId, departmentId, agentId) {
        const scopes = [];
        if (userId) scopes.push({ type: 'user', id: userId });
        if (teamId) scopes.push({ type: 'team', id: teamId });
        if (departmentId) scopes.push({ type: 'department', id: departmentId });
        if (agentId) scopes.push({ type: 'agent', id: agentId });
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
                    await this._archiveAndResetBudget(budget);
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
     * Update budget counters after a request.
     * Increments ALL matching budget scopes: user, team, department, agent, and global.
     */
    async _updateBudgets(userContext, tokens, costCents) {
        const { userId, teamId, department, agentId } = userContext || {};

        // Collect all scope IDs that should be updated
        const scopeIds = [];
        if (userId) scopeIds.push(userId);
        if (teamId) scopeIds.push(teamId);
        if (department) scopeIds.push(department);
        if (agentId) scopeIds.push(agentId);
        scopeIds.push('global'); // Always update global budgets

        if (scopeIds.length === 0) return;

        await db.query(
            `UPDATE budgets SET
        current_tokens = current_tokens + $1,
        current_cost_cents = current_cost_cents + $2,
        updated_at = NOW()
       WHERE scope_id = ANY($3) AND is_active = true`,
            [tokens, costCents, scopeIds]
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
     * Archive a budget period's data before resetting.
     * Stores the snapshot in budget_history so historical data is not lost.
     */
    async _archiveAndResetBudget(budget) {
        // Archive the current period to budget_history
        try {
            await db.query(
                `INSERT INTO budget_history (budget_id, budget_name, scope_type, scope_id, period, period_start, period_end, final_tokens, final_cost_cents, token_limit, cost_limit_cents)
           VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8, $9, $10)`,
                [budget.id, budget.name, budget.scope_type, budget.scope_id, budget.period,
                    budget.period_start, budget.current_tokens || 0, budget.current_cost_cents || 0,
                    budget.token_limit, budget.cost_limit_cents]
            );
        } catch (err) {
            // If budget_history table doesn't exist yet, just log and continue
            logger.warn('Could not archive budget period (table may not exist):', err.message);
        }

        // Reset the budget
        await db.query(
            `UPDATE budgets SET current_tokens = 0, current_cost_cents = 0, period_start = NOW(), updated_at = NOW()
       WHERE id = $1`,
            [budget.id]
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
            [data.name, data.scopeType, data.scopeId || (data.scopeType === 'global' ? 'global' : data.scopeId),
            data.tokenLimit || null,
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

    async deleteBudget(id) {
        const result = await db.query('DELETE FROM budgets WHERE id = $1 RETURNING id', [id]);
        if (result.rows.length === 0) {
            throw new AppError('Budget not found', 404);
        }
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

    /**
     * Get daily token/cost usage for the last N days (time-series data).
     */
    async getDailyUsage(days = 30) {
        const result = await db.query(`
      SELECT
        DATE(recorded_at) as date,
        SUM(total_tokens) as total_tokens,
        SUM(input_tokens) as input_tokens,
        SUM(output_tokens) as output_tokens,
        SUM(cost_cents) as cost_cents,
        COUNT(*) as request_count
      FROM cost_records
      WHERE recorded_at >= NOW() - INTERVAL '1 day' * $1
      GROUP BY DATE(recorded_at)
      ORDER BY date ASC
    `, [days]);
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

    /**
     * Get budgets that are at or above their warn threshold.
     * Used for the alert banners on the frontend.
     */
    async getBudgetAlerts() {
        const result = await db.query(`
      SELECT * FROM budgets
      WHERE is_active = true
        AND (
          (token_limit IS NOT NULL AND token_limit > 0 AND current_tokens::float / token_limit >= warn_threshold)
          OR
          (cost_limit_cents IS NOT NULL AND cost_limit_cents > 0 AND current_cost_cents::float / cost_limit_cents >= warn_threshold)
        )
      ORDER BY
        CASE WHEN token_limit > 0 THEN current_tokens::float / token_limit ELSE 0 END DESC
    `);
        return result.rows;
    }

    /**
     * Get archived budget period history for a given budget.
     */
    async getBudgetHistory(budgetId) {
        try {
            const result = await db.query(
                `SELECT * FROM budget_history WHERE budget_id = $1 ORDER BY period_end DESC LIMIT 24`,
                [budgetId]
            );
            return result.rows;
        } catch {
            // Table may not exist yet
            return [];
        }
    }

    /**
     * Get all budget history entries (global overview).
     */
    async getAllBudgetHistory(limit = 50) {
        try {
            const result = await db.query(
                `SELECT * FROM budget_history ORDER BY period_end DESC LIMIT $1`,
                [limit]
            );
            return result.rows;
        } catch {
            return [];
        }
    }
}

module.exports = new CostService();
