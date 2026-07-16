/**
 * AI Sure — YAML Guardrail Test Runner
 * Executes test cases TC-18.x (Validation) and TC-19.x (Conversion) directly against the parser.
 * TC-20.x through TC-23.x require API/DB/UI — those are documented as manual test specs.
 */

// ── Minimal logger mock (parser imports logger but only uses it sparingly) ──
const mockLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
require.cache[require.resolve('../src/config/logger')] = { id: 'logger-mock', filename: 'logger-mock', loaded: true, exports: mockLogger };

const parser = require('../src/guardrails/yaml-parser');

// ── Test harness ──
let passed = 0, failed = 0, total = 0;
const results = [];

function test(id, title, fn) {
    total++;
    try {
        fn();
        passed++;
        results.push({ id, title, status: '✅ PASS' });
    } catch (e) {
        failed++;
        results.push({ id, title, status: '❌ FAIL', error: e.message });
    }
}

function assert(condition, msg) {
    if (!condition) throw new Error(msg || 'Assertion failed');
}
function assertIncludes(str, substring, msg) {
    if (!str || !str.includes(substring)) {
        throw new Error(msg || `Expected "${str}" to include "${substring}"`);
    }
}
function assertEqual(actual, expected, msg) {
    if (actual !== expected) {
        throw new Error(msg || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

// ═══════════════════════════════════════════════════════
// SECTION 18: YAML Parser — Validation
// ═══════════════════════════════════════════════════════

test('TC-18.1', 'Valid minimal YAML', () => {
    const yaml = `guardrail:
  name: Test
  rules:
    - name: R1
      type: content-filter
      severity: high`;
    const result = parser.validate(yaml);
    assertEqual(result.valid, true, `Expected valid=true, got ${result.valid}. Errors: ${result.errors.join(', ')}`);
    assertEqual(result.errors.length, 0, `Expected 0 errors, got: ${result.errors.join(', ')}`);
});

test('TC-18.2', 'Missing top-level "guardrail" key', () => {
    const yaml = `name: Test\nrules: []`;
    const result = parser.validate(yaml);
    assertEqual(result.valid, false);
    assertIncludes(result.errors.join(' '), 'Missing required top-level key');
});

test('TC-18.3', 'Missing profile name', () => {
    const yaml = `guardrail:
  rules:
    - name: R1
      type: pii-shield`;
    const result = parser.validate(yaml);
    assertEqual(result.valid, false);
    assertIncludes(result.errors.join(' '), 'guardrail.name is required');
});

test('TC-18.4', 'Invalid mode', () => {
    const yaml = `guardrail:
  name: Test
  mode: destroy
  rules:
    - name: R1
      type: pii-shield`;
    const result = parser.validate(yaml);
    assertEqual(result.valid, false);
    assertIncludes(result.errors.join(' '), 'mode must be one of');
});

test('TC-18.5', 'Invalid rule type', () => {
    const yaml = `guardrail:
  name: Test
  rules:
    - name: R1
      type: invalid-type`;
    const result = parser.validate(yaml);
    assertEqual(result.valid, false);
    assertIncludes(result.errors.join(' '), 'invalid type "invalid-type"');
});

test('TC-18.6', 'Invalid severity', () => {
    const yaml = `guardrail:
  name: Test
  rules:
    - name: R1
      type: pii-shield
      severity: extreme`;
    const result = parser.validate(yaml);
    assertEqual(result.valid, false);
    assertIncludes(result.errors.join(' '), 'invalid severity "extreme"');
});

test('TC-18.7', 'Empty rules array', () => {
    const yaml = `guardrail:
  name: Test
  rules: []`;
    const result = parser.validate(yaml);
    assertEqual(result.valid, false);
    assertIncludes(result.errors.join(' '), 'rules is required and must be a non-empty array');
});

test('TC-18.8', 'Type alias — hyphenated format', () => {
    const yaml = `guardrail:
  name: Test
  rules:
    - name: R1
      type: pii-shield`;
    const result = parser.validate(yaml);
    assertEqual(result.valid, true, `Errors: ${result.errors.join(', ')}`);
    const parsed = parser.parseGuardrail(yaml);
    assertEqual(parsed.rules[0].rule_type, 'pii_shield');
});

test('TC-18.9', 'Type alias — underscore format', () => {
    const yaml = `guardrail:
  name: Test
  rules:
    - name: R1
      type: prompt_injection`;
    const parsed = parser.parseGuardrail(yaml);
    assertEqual(parsed.rules[0].rule_type, 'prompt_injection');
});

test('TC-18.10', 'Type alias — shorthand "pii"', () => {
    const yaml = `guardrail:
  name: Test
  rules:
    - name: R1
      type: pii`;
    const parsed = parser.parseGuardrail(yaml);
    assertEqual(parsed.rules[0].rule_type, 'pii_shield');
});

test('TC-18.11', 'Malformed YAML syntax', () => {
    const yaml = `guardrail:\n  name: Test\n    rules: broken indent`;
    const result = parser.validate(yaml);
    assertEqual(result.valid, false);
    assertIncludes(result.errors.join(' '), 'YAML parse error');
});

test('TC-18.12', 'Exception — missing agent field', () => {
    const yaml = `guardrail:
  name: Test
  rules:
    - name: R1
      type: pii-shield
  exceptions:
    - skip_rules:
        - R1`;
    const result = parser.validate(yaml);
    assertEqual(result.valid, false);
    assertIncludes(result.errors.join(' '), 'must have an "agent" field');
});

// ═══════════════════════════════════════════════════════
// SECTION 19: YAML Parser — Conversion
// ═══════════════════════════════════════════════════════

test('TC-19.1', 'Config flattening — content_filter keywords', () => {
    const dbRule = {
        name: 'Keyword Filter',
        rule_type: 'content_filter',
        severity: 'high',
        scope: 'input',
        is_enabled: true,
        description: null,
        config: { keywords: ['secret', 'password'] },
    };
    const yamlRule = parser.ruleToYamlRule(dbRule);
    assert(yamlRule.keywords, 'Expected keywords to be flattened');
    assert(Array.isArray(yamlRule.keywords), 'Expected keywords to be an array');
    assertEqual(yamlRule.keywords[0], 'secret');
    assertEqual(yamlRule.keywords[1], 'password');
});

test('TC-19.2', 'Config flattening — token_limit', () => {
    const dbRule = {
        name: 'Token Cap',
        rule_type: 'token_limit',
        severity: 'high',
        scope: 'input',
        is_enabled: true,
        description: null,
        config: { maxTokens: 4096 },
    };
    const yamlRule = parser.ruleToYamlRule(dbRule);
    assertEqual(yamlRule.max_tokens, 4096);
});

test('TC-19.3', 'Config flattening — topic_boundary', () => {
    const dbRule = {
        name: 'Topic Guard',
        rule_type: 'topic_boundary',
        severity: 'medium',
        scope: 'both',
        is_enabled: true,
        description: null,
        config: { allowedTopics: ['finance'], blockedTopics: ['politics'] },
    };
    const yamlRule = parser.ruleToYamlRule(dbRule);
    assert(Array.isArray(yamlRule.allowed_topics), 'Expected allowed_topics array');
    assert(Array.isArray(yamlRule.blocked_topics), 'Expected blocked_topics array');
    assertEqual(yamlRule.allowed_topics[0], 'finance');
    assertEqual(yamlRule.blocked_topics[0], 'politics');
});

test('TC-19.4', 'Config building — YAML keywords to DB config', () => {
    const yaml = `guardrail:
  name: Test
  rules:
    - name: Filter
      type: content-filter
      keywords:
        - bad
        - words`;
    const parsed = parser.parseGuardrail(yaml);
    const config = parsed.rules[0].config;
    assert(config.keywords, 'Expected config.keywords');
    assertEqual(config.keywords[0], 'bad');
    assertEqual(config.keywords[1], 'words');
});

test('TC-19.5', 'Config building — YAML pattern to custom_regex config', () => {
    const yaml = `guardrail:
  name: Test
  rules:
    - name: SSN Pattern
      type: custom-regex
      pattern: "\\\\b\\\\d{3}-\\\\d{2}-\\\\d{4}\\\\b"`;
    const parsed = parser.parseGuardrail(yaml);
    const config = parsed.rules[0].config;
    assert(config.patterns, 'Expected config.patterns');
    assert(Array.isArray(config.patterns), 'Expected patterns array');
    assertEqual(config.patterns[0].flags, 'gi');
});

test('TC-19.6', 'Config building — explicit config merge', () => {
    const yaml = `guardrail:
  name: Test
  rules:
    - name: Custom PII
      type: pii-shield
      config:
        customField: true`;
    const parsed = parser.parseGuardrail(yaml);
    const config = parsed.rules[0].config;
    assertEqual(config.customField, true);
});

test('TC-19.7', 'Slugify for YAML IDs', () => {
    const dbRule = {
        name: 'PII & Safety Shield (v2)',
        rule_type: 'pii_shield',
        severity: 'critical',
        scope: 'both',
        is_enabled: true,
        config: {},
    };
    const yamlRule = parser.ruleToYamlRule(dbRule);
    assertEqual(yamlRule.id, 'pii-safety-shield-v2');
});

test('TC-19.8', 'Type inference from fields (keywords → content_filter)', () => {
    const yaml = `guardrail:
  name: Test
  rules:
    - name: R1
      keywords:
        - test`;
    const parsed = parser.parseGuardrail(yaml);
    assertEqual(parsed.rules[0].rule_type, 'content_filter');
});

test('TC-19.9', 'Disabled rule preservation', () => {
    const yaml = `guardrail:
  name: Test
  rules:
    - name: R1
      type: pii-shield
      enabled: false`;
    const parsed = parser.parseGuardrail(yaml);
    assertEqual(parsed.rules[0].is_enabled, false);
});

// ═══════════════════════════════════════════════════════
// SECTION 21 (partial): YAML generateYaml — Export
// ═══════════════════════════════════════════════════════

test('TC-21.3', 'Export contains header comment', () => {
    const profile = { name: 'Test Profile', mode: 'block', description: 'desc' };
    const rules = [{
        name: 'R1',
        rule_type: 'pii_shield',
        severity: 'high',
        scope: 'both',
        is_enabled: true,
        config: {},
    }];
    const yamlStr = parser.generateYaml(profile, rules);
    assertIncludes(yamlStr, '# AI Sure — Guardrail Profile');
});

test('TC-21.4', 'Export includes all rule types', () => {
    const profile = { name: 'Multi', mode: 'block' };
    const rules = [
        { name: 'R1', rule_type: 'content_filter', severity: 'high', scope: 'input', is_enabled: true, config: { keywords: ['test'] } },
        { name: 'R2', rule_type: 'pii_shield', severity: 'critical', scope: 'both', is_enabled: true, config: {} },
        { name: 'R3', rule_type: 'token_limit', severity: 'medium', scope: 'input', is_enabled: true, config: { maxTokens: 4096 } },
    ];
    const yamlStr = parser.generateYaml(profile, rules);
    assertIncludes(yamlStr, 'content-filter');
    assertIncludes(yamlStr, 'pii-shield');
    assertIncludes(yamlStr, 'token-limit');
});

test('TC-21.5', 'Round-trip fidelity', () => {
    const profile = { name: 'Roundtrip Test', mode: 'block', description: 'Test round-trip' };
    const originalRules = [
        { name: 'PII Rule', rule_type: 'pii_shield', severity: 'critical', scope: 'both', is_enabled: true, config: {} },
        { name: 'Keyword Rule', rule_type: 'content_filter', severity: 'high', scope: 'input', is_enabled: true, config: { keywords: ['secret', 'password'] } },
        { name: 'Token Cap', rule_type: 'token_limit', severity: 'medium', scope: 'input', is_enabled: true, config: { maxTokens: 8192 } },
    ];

    // Export
    const yamlStr = parser.generateYaml(profile, originalRules);

    // Re-import
    const parsed = parser.parseGuardrail(yamlStr);

    // Verify
    assertEqual(parsed.rules.length, 3, `Expected 3 rules, got ${parsed.rules.length}`);
    assertEqual(parsed.rules[0].rule_type, 'pii_shield');
    assertEqual(parsed.rules[0].severity, 'critical');
    assertEqual(parsed.rules[1].rule_type, 'content_filter');
    assertEqual(parsed.rules[1].config.keywords[0], 'secret');
    assertEqual(parsed.rules[1].config.keywords[1], 'password');
    assertEqual(parsed.rules[2].rule_type, 'token_limit');
    assertEqual(parsed.rules[2].config.maxTokens, 8192);
});

// ═══════════════════════════════════════════════════════
// Print results
// ═══════════════════════════════════════════════════════

console.log('\n' + '═'.repeat(70));
console.log('  AI Sure — YAML Guardrail Test Results');
console.log('═'.repeat(70));

let currentSection = '';
for (const r of results) {
    const section = r.id.split('.')[0].replace('TC-', '');
    const sectionNames = {
        '18': '§18 YAML Parser — Validation',
        '19': '§19 YAML Parser — Conversion',
        '21': '§21 YAML API — Export (parser-level)',
    };
    if (section !== currentSection) {
        currentSection = section;
        console.log(`\n  ${sectionNames[section] || `§${section}`}`);
        console.log('  ' + '─'.repeat(50));
    }
    const status = r.status;
    const errorMsg = r.error ? ` → ${r.error}` : '';
    console.log(`  ${status} ${r.id}: ${r.title}${errorMsg}`);
}

console.log('\n' + '─'.repeat(70));
console.log(`  Total: ${total}  |  ✅ Passed: ${passed}  |  ❌ Failed: ${failed}`);
console.log('─'.repeat(70));

if (failed > 0) {
    console.log('\n  ⚠️  Some tests failed. See errors above.');
    process.exit(1);
} else {
    console.log('\n  🎉 All tests passed!');
    process.exit(0);
}
