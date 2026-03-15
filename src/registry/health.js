const axios = require('axios');
const db = require('../db');
const config = require('../config');
const logger = require('../config/logger');
const { RegistryService } = require('./service');

class HealthChecker {
    constructor() {
        this.interval = null;
        this.isRunning = false;
    }

    /**
     * Start the periodic health checker
     */
    start() {
        if (this.interval) return;

        logger.info(`Health checker starting (interval: ${config.healthCheck.intervalMs}ms)`);
        this.interval = setInterval(() => this.checkAll(), config.healthCheck.intervalMs);

        // Run an initial check after a short delay
        setTimeout(() => this.checkAll(), 5000);
    }

    /**
     * Stop the health checker
     */
    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
            logger.info('Health checker stopped');
        }
    }

    /**
     * Check all active agents
     */
    async checkAll() {
        if (this.isRunning) {
            logger.debug('Health check already running, skipping');
            return;
        }

        this.isRunning = true;

        try {
            const { rows: agents } = await db.query(
                'SELECT id, name, slug, endpoint_url, health_check_url, consecutive_failures FROM agents WHERE is_active = true'
            );

            logger.debug(`Running health checks for ${agents.length} agent(s)`);

            const results = await Promise.allSettled(
                agents.map(agent => this.checkAgent(agent))
            );

            const summary = results.reduce(
                (acc, r) => {
                    if (r.status === 'fulfilled') {
                        acc[r.value] = (acc[r.value] || 0) + 1;
                    } else {
                        acc.error = (acc.error || 0) + 1;
                    }
                    return acc;
                },
                {}
            );

            logger.debug('Health check summary:', summary);
        } catch (err) {
            logger.error('Health check cycle failed:', err);
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * Check a single agent's health
     */
    async checkAgent(agent) {
        const url = agent.health_check_url || agent.endpoint_url;

        try {
            const response = await axios.get(url, {
                timeout: config.healthCheck.timeoutMs,
                validateStatus: (status) => status < 500,
            });

            const status = response.status < 400 ? 'healthy' : 'degraded';
            await RegistryService.updateHealthStatus(agent.id, status, 0);
            return status;
        } catch (err) {
            const failures = (agent.consecutive_failures || 0) + 1;
            const status = failures >= config.healthCheck.unhealthyThreshold ? 'unhealthy' : 'degraded';

            await RegistryService.updateHealthStatus(agent.id, status, failures);

            if (status === 'unhealthy') {
                logger.warn(`Agent "${agent.name}" (${agent.slug}) marked unhealthy after ${failures} consecutive failures`);
            }

            return status;
        }
    }
}

module.exports = new HealthChecker();
