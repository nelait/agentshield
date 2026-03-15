const { Pool } = require('pg');
const config = require('../config');
const logger = require('../config/logger');

const pool = new Pool(config.db);

pool.on('connect', () => {
    logger.debug('New database connection established');
});

pool.on('error', (err) => {
    logger.error('Unexpected database error:', err);
    process.exit(-1);
});

/**
 * Execute a query with parameters
 */
async function query(text, params) {
    const start = Date.now();
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    logger.debug(`Query executed in ${duration}ms: ${text.substring(0, 80)}...`);
    return result;
}

/**
 * Get a client from the pool for transactions
 */
async function getClient() {
    const client = await pool.connect();
    const originalQuery = client.query.bind(client);
    const originalRelease = client.release.bind(client);

    // Monkey-patch release to track
    const timeout = setTimeout(() => {
        logger.warn('Client checked out for more than 10 seconds!');
    }, 10000);

    client.release = () => {
        clearTimeout(timeout);
        client.query = originalQuery;
        client.release = originalRelease;
        return originalRelease();
    };

    return client;
}

/**
 * Execute operations within a transaction
 */
async function transaction(callback) {
    const client = await getClient();
    try {
        await client.query('BEGIN');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Check database connectivity
 */
async function healthCheck() {
    try {
        const result = await query('SELECT NOW()');
        return { status: 'healthy', timestamp: result.rows[0].now };
    } catch (err) {
        return { status: 'unhealthy', error: err.message };
    }
}

async function close() {
    await pool.end();
}

module.exports = { query, getClient, transaction, healthCheck, close, pool };
