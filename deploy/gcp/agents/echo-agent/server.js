// ============================================
// Echo Agent — Baseline test agent with Gemini AI
// Echoes input through Gemini for natural responses.
// Used for:
//   - Policy enforcement testing
//   - Auth/JWT testing
//   - Audit log verification
//   - Guardrail input testing (prompt injection)
// ============================================
const express = require('express');
const app = express();
app.use(express.json());

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        agent: 'echo-agent',
        ai_enabled: !!GEMINI_API_KEY,
        timestamp: new Date().toISOString(),
    });
});

app.post('/', async (req, res) => {
    const input = req.body.prompt || req.body.message || JSON.stringify(req.body);
    const startTime = Date.now();

    try {
        if (!GEMINI_API_KEY) {
            // Fallback: simple echo (no AI key configured)
            return res.json({
                agent: 'echo-agent',
                message: `Echo: ${input}`,
                ai_powered: false,
                timestamp: new Date().toISOString(),
                metadata: {
                    forwarded_by: req.headers['x-forwarded-by'] || null,
                    has_auth: !!req.headers['authorization'],
                    request_size: JSON.stringify(req.body).length,
                },
            });
        }

        // Call Gemini API
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: input }] }],
                generationConfig: {
                    maxOutputTokens: 512,
                    temperature: 0.7,
                },
            }),
        });

        const data = await response.json();
        const latencyMs = Date.now() - startTime;

        if (data.error) {
            throw new Error(data.error.message || 'Gemini API error');
        }

        const candidate = data.candidates?.[0];
        const text = candidate?.content?.parts?.[0]?.text || 'No response generated';
        const usage = data.usageMetadata || {};

        res.json({
            agent: 'echo-agent',
            message: text,
            ai_powered: true,
            model: GEMINI_MODEL,
            timestamp: new Date().toISOString(),
            metadata: {
                forwarded_by: req.headers['x-forwarded-by'] || null,
                has_auth: !!req.headers['authorization'],
                latency_ms: latencyMs,
            },
            usage: {
                input_tokens: usage.promptTokenCount || 0,
                output_tokens: usage.candidatesTokenCount || 0,
                total_tokens: usage.totalTokenCount || 0,
                model_name: GEMINI_MODEL,
                cost_cents: 0, // AgentShield auto-calculates
            },
        });
    } catch (err) {
        res.json({
            agent: 'echo-agent',
            message: `Echo (AI error): ${input}`,
            error: err.message,
            ai_powered: false,
            timestamp: new Date().toISOString(),
        });
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`echo-agent listening on :${PORT} (AI: ${GEMINI_API_KEY ? 'enabled' : 'disabled'})`));
