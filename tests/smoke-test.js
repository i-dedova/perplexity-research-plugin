#!/usr/bin/env node
/**
 * Perplexity Research Plugin - Smoke Tests
 *
 * Cross-platform smoke tests for all programmatic components.
 * Run outside the plugin directory to avoid bundling with distribution.
 *
 * Usage:
 *   node smoke-test.js           - Run all tests
 *   node smoke-test.js --verbose - Run with detailed output
 *   node smoke-test.js --ci      - CI mode (exit code reflects pass/fail)
 *
 * Location: ~/.claude/plugin-tests/perplexity-research/smoke-test.js
 */

const { platform } = require('os');
const {
  PLUGIN_ROOT,
  setVerbose, log,
  setupTempDir, cleanupTempDir,
  getResults, printSummary
} = require('./test-utils');

// Parse args
const args = process.argv.slice(2);
const VERBOSE = args.includes('--verbose') || args.includes('-v');
const CI_MODE = args.includes('--ci');
setVerbose(VERBOSE);

// Test modules (order matters: structure first, async last)
const testStructure = require('./test-structure');
const testConfig = require('./test-config');
const testPlatformCli = require('./test-platform-cli');
const testSession = require('./test-session');
const testPlaywright = require('./test-playwright');
const testScriptsHooks = require('./test-scripts-hooks');
const testFileLock = require('./test-file-lock');

async function main() {
  log('╔════════════════════════════════════════════════════╗');
  log('║  Perplexity Research Plugin - Smoke Tests          ║');
  log('╠════════════════════════════════════════════════════╣');
  log(`║  Platform: ${platform().padEnd(41)}║`);
  log(`║  Node: ${process.version.padEnd(45)}║`);
  log(`║  Plugin: ${PLUGIN_ROOT.slice(-42).padEnd(43)}║`);
  log('╚════════════════════════════════════════════════════╝');

  setupTempDir();

  try {
    testStructure.run();
    testConfig.run();
    testPlatformCli.run();
    testSession.run();
    await testPlaywright.run();
    testScriptsHooks.run();
    await testFileLock.run();
  } finally {
    cleanupTempDir();
  }

  printSummary();

  if (CI_MODE) {
    const { failed: f } = getResults();
    process.exit(f > 0 ? 1 : 0);
  }
}

main().catch(e => {
  console.error('Smoke test crashed:', e);
  process.exit(1);
});
