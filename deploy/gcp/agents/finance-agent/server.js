// ============================================
// Finance Agent — Cost tracking test agent
// Returns mock financial data WITH usage object
// Used for:
//   - Token usage recording
//   - Auto cost estimation (model pricing)
//   - Budget enforcement (hard block / soft warn)
//   - Cost forecasting
// ============================================
const express = require('express');
const app = express();
app.use(express.json());

app.get('/health', (req, res) => {
    res.json({ status: 'healthy', agent: 'finance-agent', timestamp: new Date().toISOString() });
});

app.post('/', (req, res) => {
    const prompt = req.body.prompt || req.body.message || '';
    const inputTokens = Math.ceil(prompt.length / 4); // ~4 chars per token
    const outputTokens = Math.floor(Math.random() * 500) + 100;

    res.json({
        agent: 'finance-agent',
        response: {
            summary: `Q2 2026 revenue: $${(Math.random() * 10 + 5).toFixed(1)}M (+${(Math.random() * 20 + 5).toFixed(1)}% YoY)`,
            recommendation: 'Increase allocation to AI R&D by 15% based on ROI projections',
            confidence: parseFloat((Math.random() * 0.3 + 0.7).toFixed(2)),
            data: {
                revenue: Math.floor(Math.random() * 10000000) + 5000000,
                expenses: Math.floor(Math.random() * 5000000) + 2000000,
                net_margin: parseFloat((Math.random() * 20 + 10).toFixed(1)),
            },
        },
        // AgentShield reads this for cost tracking
        usage: {
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            model_name: 'gpt-4o',       // triggers auto cost estimation
            cost_cents: 0,               // 0 = AgentShield will auto-calculate
        },
    });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`finance-agent listening on :${PORT}`));
