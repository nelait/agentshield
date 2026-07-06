/**
 * CSV Exporter — converts report data objects into CSV format.
 * Flattens the first array-type property found in the report data.
 */
function exportToCsv(report) {
    // Find the best data array to export
    const dataKey = _findPrimaryDataKey(report);
    const rows = dataKey ? report[dataKey] : [];

    if (!rows || rows.length === 0) {
        // Fallback: export summary as key-value pairs
        if (report.summary) {
            const lines = ['Field,Value'];
            Object.entries(report.summary).forEach(([key, val]) => {
                lines.push(`"${_escape(key)}","${_escape(String(val))}"`);
            });
            return lines.join('\n');
        }
        return 'No data available';
    }

    // Extract headers from first row
    const headers = Object.keys(rows[0]);
    const lines = [headers.map(h => `"${_escape(h)}"`).join(',')];

    for (const row of rows) {
        const values = headers.map(h => {
            const val = row[h];
            if (val === null || val === undefined) return '""';
            if (typeof val === 'object') return `"${_escape(JSON.stringify(val))}"`;
            return `"${_escape(String(val))}"`;
        });
        lines.push(values.join(','));
    }

    return lines.join('\n');
}

/**
 * Find the primary data array in a report object.
 * Prefers specific known keys, then falls back to the largest array.
 */
function _findPrimaryDataKey(report) {
    const preferred = ['records', 'daily_trend', 'checks', 'runs', 'budgets',
        'test_runs', 'agents', 'by_agent', 'by_model', 'policy_hits',
        'by_framework', 'by_type', 'by_workflow', 'protected_agents'];

    for (const key of preferred) {
        if (Array.isArray(report[key]) && report[key].length > 0) return key;
    }

    // Fallback: find the largest array
    let bestKey = null;
    let bestLen = 0;
    for (const [key, val] of Object.entries(report)) {
        if (Array.isArray(val) && val.length > bestLen) {
            bestKey = key;
            bestLen = val.length;
        }
    }
    return bestKey;
}

function _escape(str) {
    return str.replace(/"/g, '""');
}

module.exports = { exportToCsv };
