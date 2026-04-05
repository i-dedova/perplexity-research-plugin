/**
 * test-structure.js - Plugin existence, lib exports, logger module
 *
 * Tests: pluginStructure + libImports + loggerModule
 */

const { existsSync, readFileSync, unlinkSync } = require('fs');
const { join } = require('path');
const {
  PLUGIN_ROOT, LIB_PATH,
  log, test,
  assert, assertEqual, assertType, assertFunction, assertObject,
  lib
} = require('./test-utils');

function run() {
  const l = lib();

  // === Plugin Structure ===
  log('\n=== Plugin Structure ===');

  test('Plugin root exists', () => {
    assert(existsSync(PLUGIN_ROOT), `Plugin not found at ${PLUGIN_ROOT}`);
  });

  test('scripts/lib directory exists', () => {
    assert(existsSync(LIB_PATH), 'scripts/lib directory not found');
  });

  test('All lib modules exist', () => {
    const modules = ['index.js', 'config.js', 'platform.js', 'playwright.js',
                     'session-status.js', 'session-cookie.js', 'session-state.js', 'cli.js',
                     'file-lock.js', 'logger.js', 'research-prompts.js', 'research-ui.js'];
    for (const mod of modules) {
      assert(existsSync(join(LIB_PATH, mod)), `Missing: ${mod}`);
    }
  });

  test('All scripts exist', () => {
    const scripts = ['setup.js', 'perplexity-research.mjs', 'cleanup.js'];
    for (const script of scripts) {
      assert(existsSync(join(PLUGIN_ROOT, 'scripts', script)), `Missing: ${script}`);
    }
  });

  test('All hooks exist', () => {
    const hooks = ['check-research-agent.js', 'validate-research-session.js', 'inject-templates.js', 'extract-research-output.js'];
    for (const hook of hooks) {
      assert(existsSync(join(PLUGIN_ROOT, 'hooks', hook)), `Missing: ${hook}`);
    }
  });

  test('plugin.json exists', () => {
    assert(existsSync(join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json')), 'plugin.json not found');
  });

  // === Library Imports ===
  log('\n=== Library Imports ===');

  test('Main lib index imports', () => {
    assert(l, 'lib should be defined');
  });

  test('lib.config exports', () => {
    assertObject(l, 'config');
    assertObject(l.config, 'PATHS');
    assertObject(l.config, 'DEFAULTS');
    assertObject(l.config, 'VALID_MODELS');
    assertFunction(l.config, 'getConfig');
    assertFunction(l.config, 'getBrowser');
    assertFunction(l.config, 'getCleanupDays');
    assertFunction(l.config, 'getDefaultModel');
    assertFunction(l.config, 'getDefaultThinking');
    assertFunction(l.config, 'getSubscriptionTier');
    assertFunction(l.config, 'getModelDisplayName');
    assertFunction(l.config, 'getModelsForTier');
    assertFunction(l.config, 'ensureConfigDir');
    assertFunction(l.config, 'writeConfig');
    assertFunction(l.config, 'setBrowser');
    assertFunction(l.config, 'setCleanupDays');
    assertFunction(l.config, 'setDefaultModel');
    assertFunction(l.config, 'setDefaultThinking');
    assertFunction(l.config, 'setSubscriptionTier');
  });

  test('lib.platform exports', () => {
    assertObject(l, 'platform');
    assertFunction(l.platform, 'getPlatform');
    assertFunction(l.platform, 'isWindows');
    assertFunction(l.platform, 'getPlaywrightSessionDir');
    assertFunction(l.platform, 'minimizeWindows');
    assertFunction(l.platform, 'clearSessionRestore');
    assertFunction(l.platform, 'stripCliXml');
  });

  test('lib.playwright exports', () => {
    assertObject(l, 'playwright');
    assertFunction(l.playwright, 'checkPlaywrightCli');
    assertFunction(l.playwright, 'getPlaywrightCliPath');
    assertFunction(l.playwright, 'runCli');
    assertFunction(l.playwright, 'runCode');
    assertFunction(l.playwright, 'startSession');
    assertFunction(l.playwright, 'stopSession');
    assertFunction(l.playwright, 'isSessionRunning');
    assertFunction(l.playwright, 'verifySessionRunning');
    assertFunction(l.playwright, 'pressKey');
    assertFunction(l.playwright, 'tabSelect');
    assertFunction(l.playwright, 'tabClose');
    assertFunction(l.playwright, 'getTabCount');
    assertType(l.playwright.CLI_TIMEOUT, 'number', 'CLI_TIMEOUT');
  });

  test('lib.sessionStatus exports', () => {
    assertObject(l, 'sessionStatus');
    assertFunction(l.sessionStatus, 'getSessionStatus');
    assertFunction(l.sessionStatus, 'saveSessionStatus');
    assertFunction(l.sessionStatus, 'updateSessionStatus');
    assertFunction(l.sessionStatus, 'isSessionExpired');
    assertFunction(l.sessionStatus, 'findValidDonorSession');
    assertFunction(l.sessionStatus, 'checkSessionPool');
    assertFunction(l.sessionStatus, 'getSessionPath');
    assertFunction(l.sessionStatus, 'getMasterSessionPath');
    assertFunction(l.sessionStatus, 'copySessionFrom');
    assertFunction(l.sessionStatus, 'copySessionFromMaster');
  });

  test('lib.sessionCookie exports', () => {
    assertObject(l, 'sessionCookie');
    assertFunction(l.sessionCookie, 'checkSessionCookie');
    assertFunction(l.sessionCookie, 'refreshSession');
    assertFunction(l.sessionCookie, 'ensureSessionValid');
  });

  test('lib.sessionState exports', () => {
    assertObject(l, 'sessionState');
    assertFunction(l.sessionState, 'getSessionStateFile');
    assertFunction(l.sessionState, 'saveSessionState');
    assertFunction(l.sessionState, 'getSessionState');
    assertFunction(l.sessionState, 'hasSessionState');
    assertFunction(l.sessionState, 'clearSessionState');
  });

  test('lib.cli exports', () => {
    assertObject(l, 'cli');
    assertFunction(l.cli, 'parseArgs');
    assertFunction(l.cli, 'sleep');
    assertFunction(l.cli, 'meetsMinVersion');
  });

  test('lib.fileLock exports', () => {
    assertObject(l, 'fileLock');
    assertFunction(l.fileLock, 'acquireLock');
    assertFunction(l.fileLock, 'releaseLock');
    assertFunction(l.fileLock, 'atomicWriteJson');
    assertFunction(l.fileLock, 'withLockedFile');
  });

  test('Convenience re-exports', () => {
    assertObject(l, 'PATHS');
    assertObject(l, 'DEFAULTS');
    assertFunction(l, 'sleep');
  });

  // === Logger Module ===
  log('\n=== logger.js Module ===');

  test('lib.logger exports', () => {
    assertObject(l, 'logger');
    assertFunction(l.logger, 'create');
    assertType(l.logger.LOGS_DIR, 'string', 'LOGS_DIR');
  });

  test('LOGS_DIR is under configDir', () => {
    assert(l.logger.LOGS_DIR.includes('perplexity'), 'LOGS_DIR should be under perplexity config');
    assert(l.logger.LOGS_DIR.includes('logs'), 'LOGS_DIR should contain "logs"');
  });

  test('create() returns logger with info/warn/error/file', () => {
    const testLogger = l.logger.create('smoke-test-logger');
    assertFunction(testLogger, 'info');
    assertFunction(testLogger, 'warn');
    assertFunction(testLogger, 'error');
    assertType(testLogger.file, 'string', 'logger.file');
    assert(testLogger.file.includes('smoke-test-logger'), 'file should contain logger name');
  });

  // Logger checks PERPLEXITY_TEST at create() time — unset it so write tests work,
  // then restore after. This lets us test real I/O even when the harness is in test mode.
  test('Logger writes to file', () => {
    const saved = process.env.PERPLEXITY_TEST;
    delete process.env.PERPLEXITY_TEST;

    const testLogger = l.logger.create('smoke-test-write');
    testLogger.info('test message');

    process.env.PERPLEXITY_TEST = saved;

    assert(existsSync(testLogger.file), 'Log file should exist after write');
    const content = readFileSync(testLogger.file, 'utf8');
    assert(content.includes('INFO test message'), 'Log file should contain the message');
    assert(content.match(/\[\d{2}:\d{2}:\d{2}\.\d{3}\]/), 'Log entry should have timestamp');

    try { unlinkSync(testLogger.file); } catch {}
  });

  test('Logger writes all levels', () => {
    const saved = process.env.PERPLEXITY_TEST;
    delete process.env.PERPLEXITY_TEST;

    const testLogger = l.logger.create('smoke-test-levels');
    testLogger.info('info-msg');
    testLogger.warn('warn-msg');
    testLogger.error('error-msg');

    process.env.PERPLEXITY_TEST = saved;

    const content = readFileSync(testLogger.file, 'utf8');
    assert(content.includes('INFO info-msg'), 'Should have INFO level');
    assert(content.includes('WARN warn-msg'), 'Should have WARN level');
    assert(content.includes('ERROR error-msg'), 'Should have ERROR level');

    const lines = content.trim().split('\n');
    assertEqual(lines.length, 3, 'Should have 3 log lines');

    try { unlinkSync(testLogger.file); } catch {}
  });
}

module.exports = { run };
