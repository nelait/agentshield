const { v4: uuidv4 } = require('uuid');
const logger = require('../config/logger');
const db = require('../db');

/**
 * Audit logger — append-only event logging
 */
class AuditService {
    /**
     * Log an audit event
     */
    async log(event) {
        const {
            traceId, eventType, actorId, actorType,
            resourceType, resourceId, action, outcome,
            details, ipAddress, latencyMs,
        } = event;

        try {
            await db.query(
                `INSERT INTO audit_log (
          trace_id, event_type, actor_id, actor_type,
          resource_type, resource_id, action, outcome,
          details, ip_address, latency_ms
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                [
                    traceId || uuidv4(), eventType, actorId || null, actorType || null,
                    resourceType || null, resourceId || null, action, outcome,
                    JSON.stringify(details || {}), ipAddress || null, latencyMs || null,
                ]
            );
        } catch (err) {
            // Never let audit failures break the request flow
            logger.error('Failed to write audit log:', err);
        }
    }

    /**
     * Query audit logs with filters
     */
    async query(filters = {}) {
        const conditions = [];
        const params = [];
        let idx = 1;

        // Text search across action, trace_id, and details
        if (filters.search) {
            const searchPattern = `%${filters.search}%`;
            conditions.push(`(action ILIKE $${idx} OR trace_id::text ILIKE $${idx} OR details::text ILIKE $${idx})`);
            params.push(searchPattern);
            idx++;
        }

        if (filters.traceId) {
            conditions.push(`trace_id = $${idx++}`);
            params.push(filters.traceId);
        }
        if (filters.actorId) {
            conditions.push(`actor_id = $${idx++}`);
            params.push(filters.actorId);
        }
        if (filters.eventType) {
            conditions.push(`event_type = $${idx++}`);
            params.push(filters.eventType);
        }
        if (filters.action) {
            conditions.push(`action = $${idx++}`);
            params.push(filters.action);
        }
        if (filters.outcome) {
            conditions.push(`outcome = $${idx++}`);
            params.push(filters.outcome);
        }
        if (filters.resourceType) {
            conditions.push(`resource_type = $${idx++}`);
            params.push(filters.resourceType);
        }
        if (filters.from) {
            conditions.push(`recorded_at >= $${idx++}`);
            params.push(filters.from);
        }
        if (filters.to) {
            conditions.push(`recorded_at <= $${idx++}`);
            params.push(filters.to);
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const limit = Math.min(parseInt(filters.limit) || 100, 500);
        const offset = parseInt(filters.offset) || 0;

        const result = await db.query(
            `SELECT * FROM audit_log ${where} ORDER BY recorded_at DESC LIMIT ${limit} OFFSET ${offset}`,
            params
        );

        const countResult = await db.query(
            `SELECT COUNT(*) FROM audit_log ${where}`,
            params
        );

        return {
            logs: result.rows,
            total: parseInt(countResult.rows[0].count),
            limit,
            offset,
        };
    }

    /**
     * Get distinct filter options for populating dropdowns
     */
    async getFilterOptions() {
        const [eventTypes, resourceTypes] = await Promise.all([
            db.query(`SELECT DISTINCT event_type FROM audit_log WHERE event_type IS NOT NULL ORDER BY event_type`),
            db.query(`SELECT DISTINCT resource_type FROM audit_log WHERE resource_type IS NOT NULL ORDER BY resource_type`),
        ]);

        return {
            eventTypes: eventTypes.rows.map(r => r.event_type),
            resourceTypes: resourceTypes.rows.map(r => r.resource_type),
        };
    }

    /**
     * Get audit stats
     */
    async getStats(since = '24 hours') {
        const result = await db.query(`
      SELECT
        COUNT(*) as total_events,
        COUNT(*) FILTER (WHERE outcome = 'allowed') as allowed,
        COUNT(*) FILTER (WHERE outcome = 'denied') as denied,
        COUNT(*) FILTER (WHERE outcome = 'error') as errors,
        AVG(latency_ms) FILTER (WHERE latency_ms IS NOT NULL) as avg_latency_ms
      FROM audit_log
      WHERE recorded_at >= NOW() - INTERVAL '${since}'
    `);
        return result.rows[0];
    }
}

module.exports = new AuditService();
