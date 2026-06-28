/**
 * Seed script — creates admin user if it doesn't exist.
 * Runs as a standalone script:  npm run seed
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./index');
const config = require('../config');
const logger = require('../config/logger');

async function seed() {
    const email = config.admin.email;
    const password = config.admin.password;

    logger.info(`Seeding admin user: ${email}`);

    // Check if admin already exists
    const { rows } = await db.query('SELECT id FROM users WHERE email = $1', [email]);

    const passwordHash = await bcrypt.hash(password, 10);

    if (rows.length > 0) {
        // Update password in case migration seeded with invalid hash
        await db.query('UPDATE users SET password_hash = $1 WHERE email = $2', [passwordHash, email]);
        logger.info('Admin user exists — password updated.');
        return;
    }
    await db.query(
        `INSERT INTO users (email, password_hash, name, role, department, is_active)
         VALUES ($1, $2, $3, $4, $5, true)`,
        [email, passwordHash, 'Admin', 'admin', 'platform']
    );

    logger.info('Admin user created successfully.');
}

if (require.main === module) {
    seed()
        .then(() => {
            logger.info('Seed complete.');
            process.exit(0);
        })
        .catch((err) => {
            logger.error('Seed failed:', err);
            process.exit(1);
        });
}

module.exports = { seed };
