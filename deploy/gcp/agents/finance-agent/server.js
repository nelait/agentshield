// ============================================
// Finance Agent — AI-powered financial analysis
// Uses Gemini to generate contextual financial
// analysis with realistic token usage tracking.
// Used for:
//   - Token usage recording
//   - Auto cost estimation (model pricing)
//   - Budget enforcement (hard block / soft warn)
//   - Cost forecasting
// ============================================
const express = require('express');
const app = express();
app.use(express.json());

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

const SYSTEM_PROMPT = `You are a senior financial analyst AI. Respond to financial queries with:
1. A concise summary (1-2 sentences)
2. A specific recommendation  
3. Supporting data points with numbers
Keep responses professional, data-driven, and under 200 words.
Format your response as plain text, not JSON.`;

app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        agent: 'finance-agent',
        ai_enabled: !!GEMINI_API_KEY,
        timestamp: new Date().toISOString(),
    });
});

app.post('/', async (req, res) => {
    const prompt = req.body.prompt || req.body.message || 'Provide a financial overview';
    const startTime = Date.now();

    try {
        if (!GEMINI_API_KEY) {
            // Fallback: mock response
            return res.json({
                agent: 'finance-agent',
                response: `[Mock] Financial analysis for: "${prompt}". Configure GEMINI_API_KEY for AI-powered responses.`,
                ai_powered: false,
                usage: { input_tokens: 0, output_tokens: 0, model_name: 'mock', cost_cents: 0 },
            });
        }

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [
                    { role: 'user', parts: [{ text: `${SYSTEM_PROMPT}\n\nUser query: ${prompt}` }] },
                ],
                generationConfig: {
                    maxOutputTokens: 800,
                    temperature: 0.6,
                },
            }),
        });

        const data = await response.json();
        const latencyMs = Date.now() - startTime;

        if (data.error) {
            throw new Error(data.error.message || 'Gemini API error');
        }

        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || 'Analysis unavailable';
        const usage = data.usageMetadata || {};

        res.json({
            agent: 'finance-agent',
            response: text,
            ai_powered: true,
            model: GEMINI_MODEL,
            latency_ms: latencyMs,
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
            agent: 'finance-agent',
            response: `[Error] Could not generate analysis: ${err.message}`,
            ai_powered: false,
            error: err.message,
            usage: { input_tokens: 0, output_tokens: 0, model_name: 'error', cost_cents: 0 },
        });
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`finance-agent listening on :${PORT} (AI: ${GEMINI_API_KEY ? 'enabled' : 'disabled'})`));
