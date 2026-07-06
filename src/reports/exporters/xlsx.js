const XLSX = require('xlsx');

/**
 * XLSX Exporter — converts report data into multi-sheet Excel workbooks.
 * Creates a sheet for each array-type property in the report.
 */
function exportToXlsx(report) {
    const wb = XLSX.utils.book_new();
    let sheetCount = 0;

    // Add summary sheet if present
    if (report.summary && typeof report.summary === 'object') {
        const summaryRows = Object.entries(report.summary).map(([key, val]) => ({
            Metric: key,
            Value: typeof val === 'object' ? JSON.stringify(val) : val,
        }));
        if (summaryRows.length > 0) {
            const ws = XLSX.utils.json_to_sheet(summaryRows);
            XLSX.utils.book_append_sheet(wb, ws, 'Summary');
            sheetCount++;
        }
    }

    // Add a sheet for each array property
    for (const [key, val] of Object.entries(report)) {
        if (key === 'summary' || key === 'type' || key === 'generatedAt' || key === 'filters' || key === 'label') continue;
        if (!Array.isArray(val) || val.length === 0) continue;

        const sheetName = _sheetName(key);
        const rows = val.map(row => {
            const flat = {};
            for (const [k, v] of Object.entries(row)) {
                flat[k] = typeof v === 'object' && v !== null ? JSON.stringify(v) : v;
            }
            return flat;
        });

        const ws = XLSX.utils.json_to_sheet(rows);
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
        sheetCount++;
    }

    // Ensure at least one sheet
    if (sheetCount === 0) {
        const ws = XLSX.utils.json_to_sheet([{ message: 'No data available for this report' }]);
        XLSX.utils.book_append_sheet(wb, ws, 'Report');
    }

    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/**
 * Sanitize sheet name for Excel (max 31 chars, no special chars)
 */
function _sheetName(key) {
    return key
        .replace(/_/g, ' ')
        .replace(/[^a-zA-Z0-9 ]/g, '')
        .substring(0, 31)
        .split(' ')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

module.exports = { exportToXlsx };
