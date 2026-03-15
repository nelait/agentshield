const db = require('../db');
const logger = require('../config/logger');

class WorkflowService {
    /**
     * Create a new workflow
     */
    async createWorkflow(data, createdBy = null) {
        return db.transaction(async (client) => {
            const result = await client.query(
                `INSERT INTO workflows (name, slug, description, max_concurrent, daily_limit, requires_approval, metadata, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
                [
                    data.name, data.slug, data.description || null,
                    data.maxConcurrent || 10, data.dailyLimit || null,
                    data.requiresApproval || false, JSON.stringify(data.metadata || {}),
                    createdBy,
                ]
            );

            const workflow = result.rows[0];

            // Add agent steps
            if (data.agents && data.agents.length > 0) {
                for (const step of data.agents) {
                    await client.query(
                        `INSERT INTO workflow_agents (workflow_id, agent_id, step_order, is_optional, config, data_flow_rules)
             VALUES ($1, $2, $3, $4, $5, $6)`,
                        [
                            workflow.id, step.agentId, step.stepOrder,
                            step.isOptional || false, JSON.stringify(step.config || {}),
                            JSON.stringify(step.dataFlowRules || {}),
                        ]
                    );
                }
            }

            logger.info(`Workflow created: ${data.name} (${data.slug})`);
            return workflow;
        });
    }

    /**
     * List workflows with agent details
     */
    async listWorkflows(filters = {}) {
        const conditions = [];
        const params = [];
        let idx = 1;

        if (filters.isEnabled !== undefined) {
            conditions.push(`w.is_enabled = $${idx++}`);
            params.push(filters.isEnabled);
        }
        if (filters.search) {
            conditions.push(`(w.name ILIKE $${idx} OR w.slug ILIKE $${idx})`);
            params.push(`%${filters.search}%`);
            idx++;
        }

        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

        const result = await db.query(
            `SELECT w.*,
        COALESCE(
          json_agg(
            json_build_object(
              'agent_id', wa.agent_id,
              'agent_name', a.name,
              'agent_slug', a.slug,
              'step_order', wa.step_order,
              'is_optional', wa.is_optional
            ) ORDER BY wa.step_order
          ) FILTER (WHERE wa.id IS NOT NULL), '[]'
        ) as agents
       FROM workflows w
       LEFT JOIN workflow_agents wa ON wa.workflow_id = w.id
       LEFT JOIN agents a ON a.id = wa.agent_id
       ${where}
       GROUP BY w.id
       ORDER BY w.created_at DESC`,
            params
        );

        return result.rows;
    }

    /**
     * Get workflow by ID or slug
     */
    async getWorkflow(idOrSlug) {
        const field = /^[0-9a-f-]{36}$/i.test(idOrSlug) ? 'w.id' : 'w.slug';
        const result = await db.query(
            `SELECT w.*,
        COALESCE(
          json_agg(
            json_build_object(
              'agent_id', wa.agent_id,
              'agent_name', a.name,
              'agent_slug', a.slug,
              'step_order', wa.step_order,
              'is_optional', wa.is_optional,
              'config', wa.config,
              'data_flow_rules', wa.data_flow_rules
            ) ORDER BY wa.step_order
          ) FILTER (WHERE wa.id IS NOT NULL), '[]'
        ) as agents
       FROM workflows w
       LEFT JOIN workflow_agents wa ON wa.workflow_id = w.id
       LEFT JOIN agents a ON a.id = wa.agent_id
       WHERE ${field} = $1
       GROUP BY w.id`,
            [idOrSlug]
        );

        if (result.rows.length === 0) {
            const { AppError } = require('../registry/service');
            throw new AppError(`Workflow not found: ${idOrSlug}`, 404);
        }

        return result.rows[0];
    }

    /**
     * Toggle workflow enabled/disabled
     */
    async toggleWorkflow(idOrSlug, isEnabled) {
        const workflow = await this.getWorkflow(idOrSlug);
        const result = await db.query(
            `UPDATE workflows SET is_enabled = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
            [isEnabled, workflow.id]
        );
        logger.info(`Workflow ${isEnabled ? 'enabled' : 'disabled'}: ${workflow.slug}`);
        return result.rows[0];
    }

    /**
     * Update workflow
     */
    async updateWorkflow(idOrSlug, updates) {
        const workflow = await this.getWorkflow(idOrSlug);
        const fields = [];
        const params = [];
        let idx = 1;

        const allowedFields = { name: 'name', description: 'description', maxConcurrent: 'max_concurrent', dailyLimit: 'daily_limit', requiresApproval: 'requires_approval' };

        for (const [key, dbCol] of Object.entries(allowedFields)) {
            if (updates[key] !== undefined) {
                fields.push(`${dbCol} = $${idx++}`);
                params.push(updates[key]);
            }
        }

        if (fields.length === 0) return workflow;

        fields.push('updated_at = NOW()');
        params.push(workflow.id);

        const result = await db.query(
            `UPDATE workflows SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
            params
        );
        return result.rows[0];
    }

    /**
     * Delete workflow
     */
    async deleteWorkflow(idOrSlug) {
        const workflow = await this.getWorkflow(idOrSlug);
        await db.query('DELETE FROM workflows WHERE id = $1', [workflow.id]);
        logger.info(`Workflow deleted: ${workflow.slug}`);
    }
    /**
     * Add an agent step to a workflow
     */
    async addAgentStep(idOrSlug, agentId, stepOrder, config = {}) {
        const workflow = await this.getWorkflow(idOrSlug);
        const result = await db.query(
            `INSERT INTO workflow_agents (workflow_id, agent_id, step_order, config)
             VALUES ($1, $2, $3, $4)
             RETURNING *`,
            [workflow.id, agentId, stepOrder || 1, JSON.stringify(config)]
        );
        logger.info(`Agent step added to workflow ${workflow.slug}: agent=${agentId} step=${stepOrder}`);
        return result.rows[0];
    }

    /**
     * Remove an agent step from a workflow
     */
    async removeAgentStep(idOrSlug, agentId) {
        const workflow = await this.getWorkflow(idOrSlug);
        await db.query(
            `DELETE FROM workflow_agents WHERE workflow_id = $1 AND agent_id = $2`,
            [workflow.id, agentId]
        );
        logger.info(`Agent step removed from workflow ${workflow.slug}: agent=${agentId}`);
    }
}

module.exports = new WorkflowService();
