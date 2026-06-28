// ============================================
// Echo Agent — Baseline test agent
// Returns input back as output. Used for:
//   - Policy enforcement testing
//   - Auth/JWT testing
//   - Audit log verification
//   - Guardrail input testing (prompt injection)
// ============================================
const express = require('express');
const app = express();
app.use(express.json());

app.get('/health', (req, res) => {
    res.json({ status: 'healthy', agent: 'echo-agent', timestamp: new Date().toISOString() });
});

app.post('/', (req, res) => {
    const input = req.body.prompt || req.body.message || JSON.stringify(req.body);
    res.json({
        agent: 'echo-agent',
        message: `Echo: ${input}`,
        timestamp: new Date().toISOString(),
        metadata: {
            received_headers: {
                forwarded_by: req.headers['x-forwarded-by'] || null,
                has_auth: !!req.headers['authorization'],
            },
            request_size: JSON.stringify(req.body).length,
        },
    });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`echo-agent listening on :${PORT}`));
