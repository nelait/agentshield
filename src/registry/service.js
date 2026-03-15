const db = require('../db');
const { v4: uuidv4 } = require('uuid');
const logger = require('../config/logger');

class RegistryService {
    /**
     * Register a new agent
     */
    async registerAgent(agentData, createdBy = null) {
        const {
            name, slug, type, vendor, description, protocol,
            endpointUrl, authConfig, capabilities, healthCheckUrl,
            version, metadata,
        } = agentData;

        // Validate slug uniqueness
        const existing = await db.query('SELECT id FROM agents WHERE slug = $1', [slug]);
        if (existing.rows.length > 0) {
            throw new AppError(`Agent with slug "${slug}" already exists`, 409);
        }

        const result = await db.query(
            `INSERT INTO agents (
        name, slug, type, vendor, description, protocol,
        endpoint_url, auth_config, capabilities, health_check_url,
        version, metadata, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *`,
            [
                name, slug, type, vendor || null, description || null, protocol,
                endpointUrl, JSON.stringify(authConfig || {}),
                JSON.stringify(capabilities || []),
                healthCheckUrl || null, version || null,
                JSON.stringify(metadata || {}), createdBy,
            ]
        );

        logger.info(`Agent registered: ${name} (${slug})`);
        return result.rows[0];
    }

    /**
     * Get all agents with optional filters
     */
    async listAgents(filters = {}) {
        const conditions = [];
        const params = [];
        let paramIdx = 1;

        if (filters.type) {
            conditions.push(`type = $${paramIdx++}`);
            params.push(filters.type);
        }
        if (filters.protocol) {
            conditions.push(`protocol = $${paramIdx++}`);
            params.push(filters.protocol);
        }
        if (filters.vendor) {
            conditions.push(`vendor ILIKE $${paramIdx++}`);
            params.push(`%${filters.vendor}%`);
        }
        if (filters.isActive !== undefined) {
            conditions.push(`is_active = $${paramIdx++}`);
            params.push(filters.isActive);
        }
        if (filters.healthStatus) {
            conditions.push(`health_status = $${paramIdx++}`);
            params.push(filters.healthStatus);
        }
        if (filters.search) {
            conditions.push(`(name ILIKE $${paramIdx} OR slug ILIKE $${paramIdx} OR description ILIKE $${paramIdx})`);
            params.push(`%${filters.search}%`);
            paramIdx++;
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const orderBy = `ORDER BY ${filters.sortBy || 'created_at'} ${filters.sortOrder || 'DESC'}`;
        const limit = filters.limit ? `LIMIT ${parseInt(filters.limit)}` : 'LIMIT 50';
        const offset = filters.offset ? `OFFSET ${parseInt(filters.offset)}` : '';

        const result = await db.query(
            `SELECT * FROM agents ${where} ${orderBy} ${limit} ${offset}`,
            params
        );

        const countResult = await db.query(
            `SELECT COUNT(*) FROM agents ${where}`,
            params
        );

        return {
            agents: result.rows,
            total: parseInt(countResult.rows[0].count),
        };
    }

    /**
     * Get a single agent by ID or slug
     */
    async getAgent(idOrSlug) {
        const field = isUUID(idOrSlug) ? 'id' : 'slug';
        const result = await db.query(
            `SELECT * FROM agents WHERE ${field} = $1`,
            [idOrSlug]
        );

        if (result.rows.length === 0) {
            throw new AppError(`Agent not found: ${idOrSlug}`, 404);
        }

        return result.rows[0];
    }

    /**
     * Update an agent
     */
    async updateAgent(idOrSlug, updates) {
        const agent = await this.getAgent(idOrSlug);

        const allowedFields = [
            'name', 'description', 'vendor', 'endpoint_url', 'auth_config',
            'capabilities', 'health_check_url', 'version', 'metadata', 'is_active',
        ];

        const setClauses = [];
        const params = [];
        let paramIdx = 1;

        for (const [key, value] of Object.entries(updates)) {
            const dbKey = camelToSnake(key);
            if (allowedFields.includes(dbKey)) {
                setClauses.push(`${dbKey} = $${paramIdx++}`);
                params.push(typeof value === 'object' ? JSON.stringify(value) : value);
            }
        }

        if (setClauses.length === 0) {
            return agent;
        }

        setClauses.push(`updated_at = NOW()`);
        params.push(agent.id);

        const result = await db.query(
            `UPDATE agents SET ${setClauses.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
            params
        );

        logger.info(`Agent updated: ${agent.slug}`);
        return result.rows[0];
    }

    /**
     * Soft-delete an agent (deactivate)
     */
    async deactivateAgent(idOrSlug) {
        const agent = await this.getAgent(idOrSlug);

        // Check if agent is used in any active workflow
        const workflows = await db.query(
            `SELECT w.name FROM workflow_agents wa
       JOIN workflows w ON w.id = wa.workflow_id
       WHERE wa.agent_id = $1 AND w.is_enabled = true`,
            [agent.id]
        );

        if (workflows.rows.length > 0) {
            const names = workflows.rows.map(w => w.name).join(', ');
            throw new AppError(
                `Cannot deactivate agent "${agent.name}" — it is used in active workflows: ${names}. Disable those workflows first.`,
                409
            );
        }

        const result = await db.query(
            `UPDATE agents SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING *`,
            [agent.id]
        );

        logger.info(`Agent deactivated: ${agent.slug}`);
        return result.rows[0];
    }

    /**
     * Update agent health status
     */
    async updateHealthStatus(agentId, status, consecutiveFailures = 0) {
        await db.query(
            `UPDATE agents SET
        health_status = $1,
        consecutive_failures = $2,
        last_health_check = NOW(),
        updated_at = NOW()
      WHERE id = $3`,
            [status, consecutiveFailures, agentId]
        );
    }

    /**
     * Import agent from A2A Agent Card URL
     */
    async importFromAgentCard(agentCardUrl, createdBy = null) {
        const axios = require('axios');

        try {
            const { data } = await axios.get(agentCardUrl, { timeout: 10000 });

            const agentData = {
                name: data.name || 'Imported Agent',
                slug: slugify(data.name || `agent-${Date.now()}`),
                type: 'external',
                vendor: data.provider?.organization || null,
                description: data.description || null,
                protocol: 'a2a',
                endpointUrl: data.url || agentCardUrl.replace('/.well-known/agent.json', ''),
                authConfig: data.authentication || {},
                capabilities: data.capabilities || [],
                healthCheckUrl: data.url || null,
                version: data.version || '1.0',
                metadata: { importedFrom: agentCardUrl, agentCard: data },
            };

            return await this.registerAgent(agentData, createdBy);
        } catch (err) {
            throw new AppError(`Failed to import agent card from ${agentCardUrl}: ${err.message}`, 400);
        }
    }

    /**
     * Get agent stats for dashboard
     */
    async getStats() {
        const result = await db.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE is_active = true) as active,
        COUNT(*) FILTER (WHERE type = 'external') as external_count,
        COUNT(*) FILTER (WHERE type = 'internal') as internal_count,
        COUNT(*) FILTER (WHERE health_status = 'healthy') as healthy,
        COUNT(*) FILTER (WHERE health_status = 'unhealthy') as unhealthy,
        COUNT(*) FILTER (WHERE health_status = 'degraded') as degraded,
        COUNT(*) FILTER (WHERE health_status = 'unknown') as unknown_health
      FROM agents
    `);
        return result.rows[0];
    }
}

// ============================================
// Helper functions
// ============================================

class AppError extends Error {
    constructor(message, statusCode = 500) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = true;
    }
}

function isUUID(str) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

function camelToSnake(str) {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

function slugify(str) {
    return str
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

module.exports = { RegistryService: new RegistryService(), AppError };
