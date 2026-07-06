const express = require('express');
const reportService = require('./service');
const { exportToCsv } = require('./exporters/csv');
const { exportToXlsx } = require('./exporters/xlsx');
const logger = require('../config/logger');

const router = express.Router();

// ============================================
// LIST AVAILABLE REPORT TYPES
// ============================================
router.get('/types', (req, res) => {
    res.json({
        success: true,
        data: reportService.listReportTypes(),
    });
});

// ============================================
// GENERATE REPORT (JSON)
// ============================================
router.get('/:type', async (req, res, next) => {
    try {
        const { type } = req.params;
        const filters = {
            from: req.query.from,
            to: req.query.to,
            framework: req.query.framework,
            agentId: req.query.agentId,
            limit: req.query.limit,
        };

        const report = await reportService.generate(type, filters);
        res.json({ success: true, data: report });
    } catch (err) {
        if (err.message.startsWith('Unknown report type')) {
            return res.status(400).json({ success: false, error: err.message });
        }
        next(err);
    }
});

// ============================================
// EXPORT REPORT (CSV / XLSX)
// ============================================
router.get('/:type/export', async (req, res, next) => {
    try {
        const { type } = req.params;
        const format = (req.query.format || 'csv').toLowerCase();
        const filters = {
            from: req.query.from,
            to: req.query.to,
            framework: req.query.framework,
            agentId: req.query.agentId,
            limit: req.query.limit,
        };

        const report = await reportService.generate(type, filters);
        const filename = `agentshield_${type}_${new Date().toISOString().slice(0, 10)}`;

        if (format === 'xlsx') {
            const buffer = exportToXlsx(report);
            res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            return res.send(buffer);
        }

        // Default: CSV
        const csv = exportToCsv(report);
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
        res.setHeader('Content-Type', 'text/csv');
        return res.send(csv);

    } catch (err) {
        if (err.message.startsWith('Unknown report type')) {
            return res.status(400).json({ success: false, error: err.message });
        }
        next(err);
    }
});

// ============================================
// SAVE A SNAPSHOT
// ============================================
router.post('/:type/snapshot', async (req, res, next) => {
    try {
        const { type } = req.params;
        const { name, filters } = req.body;
        const report = await reportService.generate(type, filters || {});
        const snapshot = await reportService.saveSnapshot(type, report, filters, req.user?.id, name);
        res.json({ success: true, data: snapshot });
    } catch (err) { next(err); }
});

// ============================================
// LIST SNAPSHOTS
// ============================================
router.get('/snapshots/list', async (req, res, next) => {
    try {
        const reportType = req.query.type || null;
        const limit = parseInt(req.query.limit) || 20;
        const snapshots = await reportService.listSnapshots(reportType, limit);
        res.json({ success: true, data: snapshots });
    } catch (err) { next(err); }
});

// ============================================
// GET SNAPSHOT
// ============================================
router.get('/snapshots/:id', async (req, res, next) => {
    try {
        const snapshot = await reportService.getSnapshot(req.params.id);
        res.json({ success: true, data: snapshot });
    } catch (err) { next(err); }
});

// ============================================
// SAVED REPORT CONFIGS (CRUD)
// ============================================
router.post('/configs', async (req, res, next) => {
    try {
        const config = await reportService.saveConfig(req.body, req.user?.id);
        res.json({ success: true, data: config });
    } catch (err) { next(err); }
});

router.get('/configs/list', async (req, res, next) => {
    try {
        const configs = await reportService.listConfigs(req.user?.id);
        res.json({ success: true, data: configs });
    } catch (err) { next(err); }
});

router.delete('/configs/:id', async (req, res, next) => {
    try {
        await reportService.deleteConfig(req.params.id);
        res.json({ success: true, message: 'Report config deleted' });
    } catch (err) { next(err); }
});

module.exports = router;
