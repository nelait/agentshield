const fs = require('fs');
const path = require('path');
const db = require('./index');
const logger = require('../config/logger');

async function migrate() {
    logger.info('Running database migrations...');

    // Create migrations tracking table
    await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

    // Get already-applied migrations
    const { rows: applied } = await db.query('SELECT filename FROM schema_migrations ORDER BY id');
    const appliedSet = new Set(applied.map(r => r.filename));

    // Read migration files
    const migrationsDir = path.join(__dirname, '../../migrations');
    const files = fs.readdirSync(migrationsDir)
        .filter(f => f.endsWith('.sql'))
        .sort();

    let count = 0;
    for (const file of files) {
        if (appliedSet.has(file)) {
            logger.debug(`Migration already applied: ${file}`);
            continue;
        }

        logger.info(`Applying migration: ${file}`);
        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');

        await db.transaction(async (client) => {
            await client.query(sql);
            await client.query(
                'INSERT INTO schema_migrations (filename) VALUES ($1)',
                [file]
            );
        });

        count++;
        logger.info(`Migration applied successfully: ${file}`);
    }

    if (count === 0) {
        logger.info('No new migrations to apply.');
    } else {
        logger.info(`Applied ${count} migration(s).`);
    }
}

// Run if called directly
if (require.main === module) {
    migrate()
        .then(() => {
            logger.info('Migrations complete.');
            process.exit(0);
        })
        .catch((err) => {
            logger.error('Migration failed:', err);
            process.exit(1);
        });
}

module.exports = { migrate };
