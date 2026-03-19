/**
 * test-utils.js - Shared test framework for Perplexity Research Plugin tests
 *
 * Extracts common test infrastructure: assertions, logging, temp dir management.
 * Import in any test file to get consistent reporting and utilities.
 */

const { execSync } = require('child_process');
const { existsSync, mkdirSync, rmSync } = require('fs');
const { join } = require('path');
const { homedir, tmpdir } = require('os');

//region Configuration

const PLUGIN_ROOT = process.env.PERPLEXITY_PLUGIN_ROOT || join(homedir(), '.claude', 'plugins', 'perplexity-research');
const LIB_PATH = join(PLUGIN_ROOT, 'scripts', 'lib');
const TEMP_DIR = join(tmpdir(), 'perplexity-research-smoke-test');

//endregion

//region Test Framework

let passed = 0;
let failed = 0;
let skipped = 0;
const failures = [];

let VERBOSE = false;

function setVerbose(v) {
  VERBOSE = v;
}

function log(msg) {
  console.log(msg);
}

function logVerbose(msg) {
  if (VERBOSE) console.log(`  ${msg}`);
}

function pass(name) {
  passed++;
  log(`✓ ${name}`);
}

function fail(name, error) {
  failed++;
  failures.push({ name, error });
  log(`✗ ${name}`);
  if (VERBOSE) {
    console.log(`  Error: ${error.message || error}`);
    if (error.stack) console.log(`  Stack: ${error.stack.split('\n').slice(1, 3).join('\n')}`);
  }
}

function skip(name, reason) {
  skipped++;
  log(`○ ${name} (skipped: ${reason})`);
}

function test(name, fn) {
  try {
    fn();
    pass(name);
  } catch (e) {
    fail(name, e);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    pass(name);
  } catch (e) {
    fail(name, e);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message || 'Values not equal'}: expected "${expected}", got "${actual}"`);
  }
}

function assertType(value, type, name) {
  const actualType = typeof value;
  if (actualType !== type) {
    throw new Error(`${name} should be ${type}, got ${actualType}`);
  }
}

function assertFunction(obj, name) {
  assertType(obj[name], 'function', `${name}`);
}

function assertObject(obj, name) {
  assertType(obj[name], 'object', `${name}`);
}

function assertThrows(fn, expectedMsg, description) {
  let threw = false;
  try {
    fn();
  } catch (e) {
    threw = true;
    if (expectedMsg) {
      assert(e.message.includes(expectedMsg),
        `${description}: expected error containing "${expectedMsg}", got "${e.message}"`);
    }
  }
  assert(threw, `${description}: expected to throw but did not`);
}

/**
 * Synchronous sleep - cross-platform
 */
function syncSleep(ms) {
  try {
    execSync(`node -e "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${ms})"`, {
      timeout: ms + 5000,
      windowsHide: true,
      stdio: 'ignore'
    });
  } catch {
    // Timeout or error - continue anyway
  }
}

//endregion

//region Setup & Teardown

function setupTempDir() {
  if (existsSync(TEMP_DIR)) {
    rmSync(TEMP_DIR, { recursive: true, force: true });
  }
  mkdirSync(TEMP_DIR, { recursive: true });
}

function cleanupTempDir() {
  if (existsSync(TEMP_DIR)) {
    rmSync(TEMP_DIR, { recursive: true, force: true });
  }
}

//endregion

//region Summary

function getResults() {
  return { passed, failed, skipped, failures };
}

function printSummary() {
  log('\n════════════════════════════════════════════════════');
  log(`  Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  log('════════════════════════════════════════════════════');

  if (failures.length > 0) {
    log('\nFailures:');
    for (const { name, error } of failures) {
      log(`  ✗ ${name}: ${error.message || error}`);
    }
  }
}

//endregion

//region Helpers

/**
 * Cached lib accessor — eliminates repeated require() calls across test files
 */
let _lib = null;
function lib() {
  if (!_lib) _lib = require(LIB_PATH);
  return _lib;
}

/**
 * Session state with auto-cleanup — eliminates boilerplate mkdir + try/finally
 * @param {string} testId - Session ID for the test
 * @param {Array} saveArgs - Arguments to pass to saveSessionState after testId: [mode, slug, strategy?, model?, thinking?]
 * @param {Function} fn - Test body receiving (sessionState) module
 */
function withSessionState(testId, saveArgs, fn) {
  const { sessionState, PATHS } = lib();
  if (!existsSync(PATHS.downloadsDir)) {
    mkdirSync(PATHS.downloadsDir, { recursive: true });
  }
  try {
    sessionState.saveSessionState(testId, ...saveArgs);
    return fn(sessionState);
  } finally {
    try { sessionState.clearSessionState(testId); } catch {}
  }
}

/**
 * Hook runner — eliminates repeated execSync blocks for hook scripts
 */
function runHook(hookName, input, opts = {}) {
  const hookPath = join(PLUGIN_ROOT, 'hooks', hookName);
  return execSync(`node "${hookPath}"`, {
    input: JSON.stringify(input),
    encoding: 'utf8',
    timeout: opts.timeout || 5000,
    windowsHide: true,
    cwd: opts.cwd,
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, PERPLEXITY_TEST: '1', ...opts.env }
  });
}

/**
 * Script runner — eliminates repeated script exec blocks
 */
function runScript(scriptName, args = '', opts = {}) {
  const { execFileSync } = require('child_process');
  const scriptPath = join(PLUGIN_ROOT, 'scripts', scriptName);
  const argsList = args ? args.split(' ') : [];
  return execFileSync(process.execPath, [scriptPath, ...argsList], {
    encoding: 'utf8',
    timeout: opts.timeout || 10000,
    windowsHide: true,
    ...opts
  });
}

/**
 * Extract function body from source code by finding matching braces
 */
function extractFunctionBody(source, funcName) {
  const startIdx = source.indexOf(`function ${funcName}(`);
  if (startIdx === -1) return null;
  let depth = 0;
  let inBody = false;
  for (let i = startIdx; i < source.length; i++) {
    if (source[i] === '{') { depth++; inBody = true; }
    if (source[i] === '}') { depth--; }
    if (inBody && depth === 0) return source.slice(startIdx, i + 1);
  }
  return null;
}

//endregion

module.exports = {
  PLUGIN_ROOT,
  LIB_PATH,
  TEMP_DIR,
  setVerbose,
  log,
  logVerbose,
  pass,
  fail,
  skip,
  test,
  testAsync,
  assert,
  assertEqual,
  assertType,
  assertFunction,
  assertObject,
  assertThrows,
  syncSleep,
  setupTempDir,
  cleanupTempDir,
  getResults,
  printSummary,
  lib,
  withSessionState,
  runHook,
  runScript,
  extractFunctionBody
};
