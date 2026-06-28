/**
 * OpenTelemetry Verification Script
 *
 * Starts the AgentShield server with console exporter and sends test requests
 * to verify spans are being generated correctly.
 *
 * Usage: node scripts/verify-otel.js
 */

const http = require('http');

const BASE_URL = 'http://localhost:3000';

// Colors for terminal output
const colors = {
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    dim: '\x1b[2m',
    reset: '\x1b[0m',
    bold: '\x1b[1m',
};

function log(icon, msg) {
    console.log(`${icon} ${msg}`);
}

function request(method, path, body = null, headers = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, BASE_URL);
        const options = {
            method,
            hostname: url.hostname,
            port: url.port,
            path: url.pathname,
            headers: {
                'Content-Type': 'application/json',
                ...headers,
            },
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, body: JSON.parse(data) });
                } catch {
                    resolve({ status: res.statusCode, body: data });
                }
            });
        });

        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function runTests() {
    console.log('');
    console.log(`${colors.bold}═══════════════════════════════════════════════${colors.reset}`);
    console.log(`${colors.bold}  🔍 AgentShield OpenTelemetry Verification${colors.reset}`);
    console.log(`${colors.bold}═══════════════════════════════════════════════${colors.reset}`);
    console.log('');

    // Test 1: Health endpoint (no auth, basic HTTP span)
    console.log(`${colors.cyan}Test 1: Health Check (auto HTTP span)${colors.reset}`);
    try {
        const res = await request('GET', '/health');
        if (res.status === 200 || res.status === 503) {
            log('✅', `Health endpoint returned ${res.status} — HTTP span should appear in console above`);
            log('  ', `${colors.dim}Look for: name: 'GET /health' in the span output${colors.reset}`);
        } else {
            log('⚠️', `Unexpected status: ${res.status}`);
        }
    } catch (err) {
        log('❌', `Health check failed: ${err.message}`);
        log('  ', `${colors.yellow}Is the server running? Start with: OTEL_EXPORTER_OTLP_ENDPOINT= node src/index.js${colors.reset}`);
        process.exit(1);
    }

    console.log('');

    // Test 2: Unauthenticated request (auth span should show failure)
    console.log(`${colors.cyan}Test 2: Unauthenticated Gateway Request (auth failure span)${colors.reset}`);
    try {
        const res = await request('POST', '/api/v1/gateway/agents/test-agent/invoke', { prompt: 'hello' });
        if (res.status === 401) {
            log('✅', `Got 401 as expected — auth span should show:`);
            log('  ', `${colors.dim}name: 'agentshield.authenticate'${colors.reset}`);
            log('  ', `${colors.dim}attributes: { 'agentshield.auth.method': 'jwt', 'agentshield.auth.success': false }${colors.reset}`);
        }
    } catch (err) {
        log('❌', `Request failed: ${err.message}`);
    }

    console.log('');

    // Test 3: Login to get JWT
    console.log(`${colors.cyan}Test 3: Admin Login (to get JWT for subsequent tests)${colors.reset}`);
    let jwt = null;
    try {
        const res = await request('POST', '/api/v1/auth/login', {
            email: 'admin@agentshield.local',
            password: 'admin123',
        });
        if (res.status === 200 && res.body?.data?.token) {
            jwt = res.body.data.token;
            log('✅', `Got JWT token (${jwt.substring(0, 20)}...)`);
        } else {
            log('⚠️', `Login returned ${res.status}: ${JSON.stringify(res.body).substring(0, 100)}`);
            log('  ', `${colors.yellow}Continuing without auth — some tests will show 401 spans${colors.reset}`);
        }
    } catch (err) {
        log('⚠️', `Login failed: ${err.message} — continuing without auth`);
    }

    console.log('');

    // Test 4: Authenticated gateway request (full span chain)
    console.log(`${colors.cyan}Test 4: Authenticated Gateway Request (full firewall span chain)${colors.reset}`);
    const authHeaders = jwt ? { Authorization: `Bearer ${jwt}` } : {};
    try {
        const res = await request('POST', '/api/v1/gateway/agents/test-agent/invoke',
            { prompt: 'Hello from OTel verification' },
            authHeaders
        );
        log(`${res.status < 500 ? '✅' : '❌'}`, `Gateway returned ${res.status}`);

        if (jwt) {
            log('  ', `${colors.dim}Expected spans in console above:${colors.reset}`);
            log('  ', `${colors.dim}  1. agentshield.authenticate (auth.success=true)${colors.reset}`);
            log('  ', `${colors.dim}  2. agentshield.policy.evaluate (decision=allow/deny)${colors.reset}`);
            log('  ', `${colors.dim}  3. agentshield.budget.check (decision=allow/deny)${colors.reset}`);
            log('  ', `${colors.dim}  4. agentshield.agent.invoke (if policy allowed)${colors.reset}`);
            log('  ', `${colors.dim}  5. agentshield.audit.log (on response finish)${colors.reset}`);
        }
    } catch (err) {
        log('❌', `Request failed: ${err.message}`);
    }

    console.log('');

    // Test 5: Policy pre-check (span for policy evaluation)
    console.log(`${colors.cyan}Test 5: Policy Pre-Check${colors.reset}`);
    try {
        const res = await request('POST', '/api/v1/gateway/policy/check',
            { agentSlug: 'test-agent' },
            authHeaders
        );
        log(`${res.status < 500 ? '✅' : '❌'}`, `Policy check returned ${res.status}: ${JSON.stringify(res.body?.data || res.body?.error || '').substring(0, 80)}`);
    } catch (err) {
        log('❌', `Request failed: ${err.message}`);
    }

    console.log('');

    // Test 6: Verify log correlation
    console.log(`${colors.cyan}Test 6: Log Correlation Check${colors.reset}`);
    log('ℹ️', `Look at Winston log output above for trace_id and span_id fields`);
    log('  ', `${colors.dim}In production (JSON format), each log line will include:${colors.reset}`);
    log('  ', `${colors.dim}  { "trace_id": "abc123...", "span_id": "def456...", "message": "..." }${colors.reset}`);

    console.log('');
    console.log(`${colors.bold}═══════════════════════════════════════════════${colors.reset}`);
    console.log(`${colors.bold}  📊 Verification Summary${colors.reset}`);
    console.log(`${colors.bold}═══════════════════════════════════════════════${colors.reset}`);
    console.log('');
    log('🔍', `Check the console output ABOVE the test results for span data`);
    log('📝', `Each span shows: traceId, name, attributes, status, duration`);
    log('🔗', `Winston logs should include trace_id and span_id for correlation`);
    console.log('');
    log('💡', `${colors.yellow}For visual trace viewing, start Docker Desktop then run:${colors.reset}`);
    log('  ', `docker run -d --name jaeger -p 16686:16686 -p 4318:4318 jaegertracing/all-in-one:latest`);
    log('  ', `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 node src/index.js`);
    log('  ', `Then open: http://localhost:16686`);
    console.log('');
}

runTests().catch(console.error);
