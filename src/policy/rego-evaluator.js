/**
 * OPA/Rego Policy Evaluator
 * 
 * Handles compilation and evaluation of Rego policies using the OPA CLI
 * for compilation and @open-policy-agent/opa-wasm for in-process evaluation.
 * 
 * Architecture:
 *   1. User writes Rego source → stored in DB (rego_source column)
 *   2. On save, compiled to WASM bundle via `opa build` CLI → stored in DB (rego_wasm column)
 *   3. On evaluate, WASM bundle loaded into memory and evaluated with request context as input
 *   4. WASM instances are cached in-memory for performance
 */

const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const os = require('os');
const logger = require('../config/logger');

const execFileAsync = promisify(execFile);

// In-memory cache: policyId → { wasmInstance, loadedAt }
const wasmCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

class RegoEvaluator {
    constructor() {
        this._opaAvailable = null; // lazy check
    }

    /**
     * Check if OPA binary is available on the system
     */
    async isOpaAvailable() {
        if (this._opaAvailable !== null) return this._opaAvailable;
        try {
            const { stdout } = await execFileAsync('opa', ['version'], { timeout: 5000 });
            logger.info(`OPA binary available: ${stdout.trim().split('\n')[0]}`);
            this._opaAvailable = true;
        } catch {
            logger.warn('OPA binary not found — Rego compilation will be unavailable. Install via: brew install opa');
            this._opaAvailable = false;
        }
        return this._opaAvailable;
    }

    /**
     * Validate Rego source syntax without compiling
     * Returns { valid: boolean, errors: string[] }
     */
    async validate(regoSource) {
        if (!await this.isOpaAvailable()) {
            return { valid: false, errors: ['OPA binary not available on this system'] };
        }

        const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'opa-validate-'));
        const policyFile = path.join(tmpDir, 'policy.rego');

        try {
            await fs.promises.writeFile(policyFile, regoSource, 'utf-8');
            await execFileAsync('opa', ['check', policyFile], { timeout: 10000 });
            return { valid: true, errors: [] };
        } catch (err) {
            const stderr = err.stderr || err.message || 'Unknown validation error';
            // Parse OPA error output into clean messages
            const errors = stderr
                .split('\n')
                .filter(l => l.trim() && !l.startsWith('opa_check'))
                .map(l => l.replace(policyFile + ':', 'line '));
            return { valid: false, errors: errors.length ? errors : [stderr] };
        } finally {
            await this._cleanup(tmpDir);
        }
    }

    /**
     * Compile Rego source to WASM bundle
     * Returns { wasm: Buffer, package: string } or throws on error
     */
    async compile(regoSource) {
        if (!await this.isOpaAvailable()) {
            throw new Error('OPA binary not available — cannot compile Rego policies');
        }

        // Extract package name from source
        const packageName = this._extractPackage(regoSource);
        if (!packageName) {
            throw new Error('Rego source must declare a package (e.g., "package aisure.authz")');
        }

        const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'opa-compile-'));
        const policyFile = path.join(tmpDir, 'policy.rego');
        const outputBundle = path.join(tmpDir, 'bundle.tar.gz');

        try {
            await fs.promises.writeFile(policyFile, regoSource, 'utf-8');

            // Compile to WASM bundle
            // The entrypoint is the package path with slashes (e.g., aisure/authz)
            const entrypoint = packageName.replace(/\./g, '/');
            await execFileAsync('opa', [
                'build',
                '-t', 'wasm',
                '-e', entrypoint,
                '-o', outputBundle,
                policyFile,
            ], { timeout: 30000 });

            // Extract the wasm binary from the tar.gz bundle
            const wasmBuf = await this._extractWasmFromBundle(tmpDir, outputBundle);

            logger.info(`Rego policy compiled: package=${packageName}, wasm=${wasmBuf.length} bytes`);
            return { wasm: wasmBuf, package: packageName };
        } finally {
            await this._cleanup(tmpDir);
        }
    }

    /**
     * Evaluate a compiled WASM policy against an input context
     * Returns { allow: boolean, deny: boolean, reason: string }
     */
    async evaluate(policyId, wasmBuffer, input) {
        try {
            const { loadPolicy } = await this._loadOpaWasm();

            // Get or create cached WASM instance
            let cached = wasmCache.get(policyId);
            if (!cached || Date.now() - cached.loadedAt > CACHE_TTL_MS) {
                const policy = await loadPolicy(wasmBuffer);
                cached = { policy, loadedAt: Date.now() };
                wasmCache.set(policyId, cached);
            }

            // Set input and evaluate
            cached.policy.setInput(input);
            const resultSet = cached.policy.evaluate();

            // OPA WASM returns an array of result objects
            // We look for 'allow' and 'deny' in the result
            if (!resultSet || resultSet.length === 0) {
                return { allow: false, deny: false, reason: 'Rego policy returned no result' };
            }

            const result = resultSet[0]?.result;
            if (typeof result === 'boolean') {
                return { allow: result, deny: !result, reason: result ? 'Rego policy: allowed' : 'Rego policy: denied' };
            }

            // Result is an object with allow/deny keys
            const allow = result?.allow === true;
            const deny = result?.deny === true;
            return {
                allow: allow && !deny,
                deny,
                reason: deny ? `Rego policy: denied${result.reason ? ' — ' + result.reason : ''}`
                    : allow ? 'Rego policy: allowed'
                        : 'Rego policy: no decision',
            };
        } catch (err) {
            logger.error(`Rego evaluation error for policy ${policyId}:`, err.message);
            return { allow: false, deny: false, reason: `Rego evaluation error: ${err.message}` };
        }
    }

    /**
     * Invalidate cached WASM instance for a policy (on update/delete)
     */
    invalidateCache(policyId) {
        wasmCache.delete(policyId);
    }

    /**
     * Clear the entire WASM cache
     */
    clearCache() {
        wasmCache.clear();
    }

    // ── Private helpers ──────────────────────────────────

    /**
     * Extract package name from Rego source
     */
    _extractPackage(source) {
        const match = source.match(/^\s*package\s+([\w.]+)/m);
        return match ? match[1] : null;
    }

    /**
     * Extract the policy.wasm file from the OPA bundle tar.gz
     */
    async _extractWasmFromBundle(tmpDir, bundlePath) {
        const extractDir = path.join(tmpDir, 'extracted');
        await fs.promises.mkdir(extractDir, { recursive: true });

        // Use tar to extract
        await execFileAsync('tar', ['-xzf', bundlePath, '-C', extractDir], { timeout: 10000 });

        // The WASM file is at /policy.wasm inside the bundle
        const wasmPath = path.join(extractDir, 'policy.wasm');
        if (!fs.existsSync(wasmPath)) {
            // Try alternate paths
            const altPath = path.join(extractDir, 'wasm', 'policy.wasm');
            if (fs.existsSync(altPath)) {
                return fs.promises.readFile(altPath);
            }
            throw new Error('Compiled bundle does not contain policy.wasm — compilation may have failed');
        }
        return fs.promises.readFile(wasmPath);
    }

    /**
     * Lazy-load the @open-policy-agent/opa-wasm package
     */
    async _loadOpaWasm() {
        try {
            return require('@open-policy-agent/opa-wasm');
        } catch {
            throw new Error(
                'Package @open-policy-agent/opa-wasm not installed. Run: npm install @open-policy-agent/opa-wasm'
            );
        }
    }

    /**
     * Clean up temporary directory
     */
    async _cleanup(tmpDir) {
        try {
            await fs.promises.rm(tmpDir, { recursive: true, force: true });
        } catch { /* best-effort cleanup */ }
    }
}

module.exports = new RegoEvaluator();
