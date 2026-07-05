-- ============================================
-- Migration 011: Model Pricing Table + Token Estimation Support
-- ============================================
-- Moves the hardcoded MODEL_PRICING constant from cost/service.js
-- into a database table with admin CRUD support.
-- Also adds is_estimated column to cost_records.
-- ============================================

-- 1. Create model_pricing table
CREATE TABLE IF NOT EXISTS model_pricing (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model_name      VARCHAR(255) NOT NULL UNIQUE,
    vendor          VARCHAR(100) NOT NULL DEFAULT 'unknown',
    input_per_1m    NUMERIC(10,2) NOT NULL,   -- cents per 1M input tokens
    output_per_1m   NUMERIC(10,2) NOT NULL,   -- cents per 1M output tokens
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_model_pricing_name ON model_pricing(model_name);
CREATE INDEX IF NOT EXISTS idx_model_pricing_vendor ON model_pricing(vendor);

-- 2. Add is_estimated flag to cost_records
ALTER TABLE cost_records ADD COLUMN IF NOT EXISTS is_estimated BOOLEAN DEFAULT false;

-- 3. Seed with standard LLM pricing data
-- OpenAI
INSERT INTO model_pricing (model_name, vendor, input_per_1m, output_per_1m) VALUES
    ('gpt-4o',              'OpenAI',    250,    1000),
    ('gpt-4o-mini',         'OpenAI',    15,     60),
    ('gpt-4-turbo',         'OpenAI',    1000,   3000),
    ('gpt-4',               'OpenAI',    3000,   6000),
    ('gpt-3.5-turbo',       'OpenAI',    50,     150),
    ('o1',                  'OpenAI',    1500,   6000),
    ('o1-mini',             'OpenAI',    300,    1200),
    ('o3-mini',             'OpenAI',    110,    440)
ON CONFLICT (model_name) DO NOTHING;

-- Anthropic
INSERT INTO model_pricing (model_name, vendor, input_per_1m, output_per_1m) VALUES
    ('claude-sonnet-4-20250514',   'Anthropic', 300,  1500),
    ('claude-3-5-sonnet-20241022', 'Anthropic', 300,  1500),
    ('claude-3-5-haiku-20241022',  'Anthropic', 80,   400),
    ('claude-3-opus-20240229',     'Anthropic', 1500, 7500)
ON CONFLICT (model_name) DO NOTHING;

-- Google
INSERT INTO model_pricing (model_name, vendor, input_per_1m, output_per_1m) VALUES
    ('gemini-2.5-pro',      'Google',    125,    1000),
    ('gemini-2.5-flash',    'Google',    15,     60),
    ('gemini-2.0-flash',    'Google',    10,     40),
    ('gemini-1.5-pro',      'Google',    125,    500),
    ('gemini-1.5-flash',    'Google',    7.5,    30)
ON CONFLICT (model_name) DO NOTHING;

-- Open Source (typical hosted pricing)
INSERT INTO model_pricing (model_name, vendor, input_per_1m, output_per_1m) VALUES
    ('llama-3.1-70b',       'Meta',      88,     88),
    ('llama-3.1-8b',        'Meta',      18,     18),
    ('mixtral-8x7b',        'Mistral',   24,     24)
ON CONFLICT (model_name) DO NOTHING;
