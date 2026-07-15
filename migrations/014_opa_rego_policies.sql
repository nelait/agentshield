-- Migration: Add OPA/Rego policy-as-code support
-- Extends the existing policies table with Rego format columns

-- Add policy format discriminator (json = existing, rego = OPA Rego)
ALTER TABLE policies ADD COLUMN IF NOT EXISTS policy_format VARCHAR(10) DEFAULT 'json'
  CHECK (policy_format IN ('json', 'rego'));

-- Raw Rego source code (human-readable, editable)
ALTER TABLE policies ADD COLUMN IF NOT EXISTS rego_source TEXT;

-- Compiled WASM bundle (binary, for fast in-process evaluation)
ALTER TABLE policies ADD COLUMN IF NOT EXISTS rego_wasm BYTEA;

-- OPA package name extracted from the Rego source (e.g., 'aisure.authz')
ALTER TABLE policies ADD COLUMN IF NOT EXISTS rego_package VARCHAR(255);
