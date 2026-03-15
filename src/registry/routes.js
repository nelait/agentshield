const express = require('express');
const { RegistryService, AppError } = require('./service');
const logger = require('../config/logger');

const router = express.Router();

// ============================================
// GET /api/v1/agents — List all agents
// ============================================
router.get('/', async (req, res, next) => {
    try {
        const filters = {
            type: req.query.type,
            protocol: req.query.protocol,
            vendor: req.query.vendor,
            isActive: req.query.is_active !== undefined ? req.query.is_active === 'true' : undefined,
            healthStatus: req.query.health_status,
            search: req.query.search,
            sortBy: req.query.sort_by,
            sortOrder: req.query.sort_order,
            limit: req.query.limit,
            offset: req.query.offset,
        };

        const result = await RegistryService.listAgents(filters);
        res.json({ success: true, data: result.agents, total: result.total });
    } catch (err) {
        next(err);
    }
});

// ============================================
// GET /api/v1/agents/stats — Dashboard stats
// ============================================
router.get('/stats', async (req, res, next) => {
    try {
        const stats = await RegistryService.getStats();
        res.json({ success: true, data: stats });
    } catch (err) {
        next(err);
    }
});

// ============================================
// GET /api/v1/agents/:idOrSlug — Get single agent
// ============================================
router.get('/:idOrSlug', async (req, res, next) => {
    try {
        const agent = await RegistryService.getAgent(req.params.idOrSlug);
        res.json({ success: true, data: agent });
    } catch (err) {
        next(err);
    }
});

// ============================================
// POST /api/v1/agents — Register a new agent
// ============================================
router.post('/', async (req, res, next) => {
    try {
        const agent = await RegistryService.registerAgent(req.body, req.user?.id);
        res.status(201).json({ success: true, data: agent });
    } catch (err) {
        next(err);
    }
});

// ============================================
// POST /api/v1/agents/import — Import from Agent Card
// ============================================
router.post('/import', async (req, res, next) => {
    try {
        const { url } = req.body;
        if (!url) {
            throw new AppError('Agent Card URL is required', 400);
        }
        const agent = await RegistryService.importFromAgentCard(url, req.user?.id);
        res.status(201).json({ success: true, data: agent });
    } catch (err) {
        next(err);
    }
});

// ============================================
// PUT /api/v1/agents/:idOrSlug — Update agent
// ============================================
router.put('/:idOrSlug', async (req, res, next) => {
    try {
        const agent = await RegistryService.updateAgent(req.params.idOrSlug, req.body);
        res.json({ success: true, data: agent });
    } catch (err) {
        next(err);
    }
});

// ============================================
// DELETE /api/v1/agents/:idOrSlug — Deactivate agent
// ============================================
router.delete('/:idOrSlug', async (req, res, next) => {
    try {
        const agent = await RegistryService.deactivateAgent(req.params.idOrSlug);
        res.json({ success: true, data: agent, message: 'Agent deactivated' });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
