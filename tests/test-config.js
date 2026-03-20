/**
 * test-config.js - Config module, log retention, model config, model selection
 *
 * Tests: configModule + configLogRetention + modelConfig + modelSelection
 */

const { existsSync, readFileSync } = require('fs');
const { homedir } = require('os');
const { join } = require('path');
const {
  PLUGIN_ROOT,
  log, test,
  assert, assertEqual, assertType, assertThrows,
  lib, runScript
} = require('./test-utils');

function run() {
  const { config, PATHS, DEFAULTS } = lib();

  // === config.js Module ===
  log('\n=== config.js Module ===');

  test('PATHS has required keys', () => {
    assert(PATHS.configDir, 'PATHS.configDir missing');
    assert(PATHS.configFile, 'PATHS.configFile missing');
    assert(PATHS.sessionStatusFile, 'PATHS.sessionStatusFile missing');
    assert(PATHS.trackedDirsFile, 'PATHS.trackedDirsFile missing');
    assert(PATHS.downloadsDir, 'PATHS.downloadsDir missing');
    assert(!PATHS.tempDir, 'PATHS.tempDir should be removed');
  });

  test('PATHS contains home directory', () => {
    const home = homedir();
    assert(PATHS.configDir.includes(home) || PATHS.configDir.includes('.claude'),
           'PATHS.configDir should reference home or .claude');
  });

  test('DEFAULTS has required keys', () => {
    const expectedBrowser = process.platform === 'win32' ? 'msedge' : 'chrome';
    assertEqual(DEFAULTS.browser, expectedBrowser, 'Default browser should match platform');
    assertEqual(DEFAULTS.cleanupDays, 7, 'Default cleanup days');
    assertEqual(DEFAULTS.minCleanupDays, 1, 'Min cleanup days');
    assertEqual(DEFAULTS.maxCleanupDays, 30, 'Max cleanup days');
    assertEqual(DEFAULTS.sessionExpiryBufferHours, 1, 'Session expiry buffer');
  });

  test('getConfig returns valid structure', () => {
    const cfg = config.getConfig();
    assert('exists' in cfg, 'Should have exists property');
    assert('browser' in cfg, 'Should have browser property');
    assert('cleanupDays' in cfg, 'Should have cleanupDays property');
  });

  test('getBrowser returns string', () => {
    const browser = config.getBrowser();
    assertType(browser, 'string', 'Browser');
    assert(['msedge', 'chrome'].includes(browser), 'Browser must be msedge or chrome');
  });

  test('getCleanupDays returns number', () => {
    const days = config.getCleanupDays();
    assertType(days, 'number', 'Cleanup days');
    assert(days >= 1 && days <= 30, 'Cleanup days should be 1-30');
  });

  test('setBrowser validates input', () => {
    assertThrows(
      () => config.setBrowser('invalid-browser'),
      'Invalid browser',
      'setBrowser with invalid browser'
    );
  });

  test('setCleanupDays validates range', () => {
    assertThrows(
      () => config.setCleanupDays(100),
      'between',
      'setCleanupDays with out-of-range value'
    );
  });

  test('getTrackedDirs returns valid structure', () => {
    const registry = config.getTrackedDirs();
    assert('dirs' in registry, 'Should have dirs property');
    assert(typeof registry.dirs === 'object', 'dirs should be an object');
  });

  test('PATHS.downloadsDir is CWD-relative', () => {
    assert(PATHS.downloadsDir.includes('.playwright-cli'), 'Should contain .playwright-cli');
    assert(PATHS.downloadsDir.includes(process.cwd()), 'Should be relative to CWD');
  });

  // === config.js Log Retention ===
  log('\n=== config.js Log Retention ===');

  test('DEFAULTS has logRetentionDays', () => {
    assertEqual(DEFAULTS.logRetentionDays, 7, 'Default log retention');
    assertEqual(DEFAULTS.minLogRetentionDays, 1, 'Min log retention');
    assertEqual(DEFAULTS.maxLogRetentionDays, 30, 'Max log retention');
  });

  test('getLogRetentionDays returns number', () => {
    const days = config.getLogRetentionDays();
    assertType(days, 'number', 'Log retention days');
    assert(days >= 1 && days <= 30, 'Log retention should be 1-30');
  });

  test('getConfig includes logRetentionDays', () => {
    const cfg = config.getConfig();
    assert('logRetentionDays' in cfg, 'Should have logRetentionDays property');
  });

  test('setLogRetentionDays validates range', () => {
    assertThrows(
      () => config.setLogRetentionDays(100),
      'between',
      'setLogRetentionDays with out-of-range value'
    );
  });

  test('setLogRetentionDays validates non-number', () => {
    assertThrows(
      () => config.setLogRetentionDays('abc'),
      'Invalid',
      'setLogRetentionDays with non-number'
    );
  });

  test('PATHS.logsDir exists', () => {
    assert(PATHS.logsDir, 'PATHS.logsDir should be defined');
    assert(PATHS.logsDir.includes('logs'), 'Should contain "logs"');
  });

  // === Model Configuration ===
  log('\n=== Model Configuration ===');

  test('VALID_MODELS exported and complete', () => {
    assert(config.VALID_MODELS, 'VALID_MODELS should be exported');
    const slugs = Object.keys(config.VALID_MODELS);
    assert(slugs.includes('best'), 'Should include best');
    assert(slugs.includes('sonar'), 'Should include sonar');
    assert(slugs.includes('claude-sonnet-4.6'), 'Should include claude-sonnet-4.6');
    assert(slugs.length >= 7, `Should have at least 7 models, got ${slugs.length}`);
  });

  test('THINKING_TOGGLEABLE exported', () => {
    assert(Array.isArray(config.THINKING_TOGGLEABLE), 'Should be array');
    assert(config.THINKING_TOGGLEABLE.includes('gpt-5.4'), 'Should include gpt-5.4');
    assert(config.THINKING_TOGGLEABLE.includes('claude-sonnet-4.6'), 'Should include claude-sonnet-4.6');
  });

  test('THINKING_ALWAYS_ON exported', () => {
    assert(Array.isArray(config.THINKING_ALWAYS_ON), 'Should be array');
    assert(config.THINKING_ALWAYS_ON.includes('gemini-3.1-pro'), 'Should include gemini-3.1-pro');
    assert(config.THINKING_ALWAYS_ON.includes('nemotron-3-super'), 'Should include nemotron-3-super');
  });

  test('DEFAULTS has model fields', () => {
    assertEqual(DEFAULTS.defaultModel, 'dynamic', 'Default model');
    assertEqual(DEFAULTS.defaultThinking, 'dynamic', 'Default thinking');
    assertEqual(DEFAULTS.subscriptionTier, 'pro', 'Default tier');
  });

  test('getDefaultModel returns string', () => {
    assertType(config.getDefaultModel(), 'string', 'Default model');
  });

  test('getDefaultThinking returns string', () => {
    assertType(config.getDefaultThinking(), 'string', 'Default thinking');
  });

  test('getSubscriptionTier returns string', () => {
    const tier = config.getSubscriptionTier();
    assertType(tier, 'string', 'Subscription tier');
    assert(['pro', 'max'].includes(tier), `Tier must be pro or max, got ${tier}`);
  });

  test('getModelDisplayName returns correct names', () => {
    assertEqual(config.getModelDisplayName('best'), 'Best', 'Best display name');
    assertEqual(config.getModelDisplayName('sonar'), 'Sonar', 'Sonar display name');
    assertEqual(config.getModelDisplayName('invalid'), null, 'Invalid should return null');
  });

  test('getModelsForTier filters correctly', () => {
    const freeModels = config.getModelsForTier('free');
    assert(freeModels.includes('best'), 'Free tier includes best');
    assert(!freeModels.includes('sonar'), 'Free tier excludes pro models');

    const proModels = config.getModelsForTier('pro');
    assert(proModels.includes('best'), 'Pro tier includes free models');
    assert(proModels.includes('sonar'), 'Pro tier includes pro models');
    assert(!proModels.includes('claude-opus-4.6'), 'Pro tier excludes max models');

    const maxModels = config.getModelsForTier('max');
    assert(maxModels.includes('claude-opus-4.6'), 'Max tier includes max models');
  });

  test('setDefaultModel validates input', () => {
    assertThrows(
      () => config.setDefaultModel('invalid-model'),
      'Invalid model',
      'setDefaultModel with invalid slug'
    );
  });

  test('setDefaultThinking validates input', () => {
    assertThrows(
      () => config.setDefaultThinking('maybe'),
      'Invalid thinking',
      'setDefaultThinking with invalid value'
    );
  });

  test('setSubscriptionTier validates input', () => {
    assertThrows(
      () => config.setSubscriptionTier('ultra'),
      'Invalid tier',
      'setSubscriptionTier with invalid value'
    );
  });

  test('getConfig includes model fields', () => {
    const cfg = config.getConfig();
    assert('defaultModel' in cfg, 'Should have defaultModel');
    assert('defaultThinking' in cfg, 'Should have defaultThinking');
    assert('subscriptionTier' in cfg, 'Should have subscriptionTier');
  });

  // === Config CRLF Handling ===
  log('\n=== Config CRLF Handling ===');

  test('config parser handles CRLF line endings', () => {
    const { writeFileSync, readFileSync, renameSync } = require('fs');
    const configFile = PATHS.configFile;
    const backupFile = configFile + '.crlf-test-backup';
    const hadConfig = existsSync(configFile);

    if (hadConfig) {
      renameSync(configFile, backupFile);
    }

    try {
      // Write config with CRLF (simulates Windows Notepad)
      const crlfContent = '---\r\nbrowser: chrome\r\ncleanup_days: 5\r\nlog_retention_days: 3\r\ndefault_model: best\r\ndefault_thinking: true\r\nsubscription_tier: max\r\nlast_cleanup: null\r\n---\r\n';
      writeFileSync(configFile, crlfContent, 'utf8');

      const cfg = config.getConfig();
      assertEqual(cfg.browser, 'chrome', 'CRLF: browser should parse');
      assertEqual(cfg.cleanupDays, 5, 'CRLF: cleanupDays should parse');
      assertEqual(cfg.defaultModel, 'best', 'CRLF: defaultModel should parse');
      assertEqual(cfg.subscriptionTier, 'max', 'CRLF: subscriptionTier should parse');
    } finally {
      if (hadConfig) {
        renameSync(backupFile, configFile);
      } else {
        try { require('fs').unlinkSync(configFile); } catch {}
      }
    }
  });

  // === Config Write/Read Cycle ===
  log('\n=== Config Write/Read Cycle ===');

  test('writeConfig and getConfig roundtrip preserves all values', () => {
    const { renameSync } = require('fs');
    const configFile = PATHS.configFile;
    const backupFile = configFile + '.roundtrip-backup';
    const hadConfig = existsSync(configFile);

    if (hadConfig) {
      renameSync(configFile, backupFile);
    }

    try {
      // Write via public API
      config.setBrowser('chrome');
      config.setCleanupDays(3);
      config.setDefaultModel('best');
      config.setSubscriptionTier('max');

      // Read back
      const cfg = config.getConfig();
      assertEqual(cfg.browser, 'chrome', 'Roundtrip: browser');
      assertEqual(cfg.cleanupDays, 3, 'Roundtrip: cleanupDays');
      assertEqual(cfg.defaultModel, 'best', 'Roundtrip: defaultModel');
      assertEqual(cfg.subscriptionTier, 'max', 'Roundtrip: subscriptionTier');
      assertEqual(cfg.exists, true, 'Roundtrip: config should exist');
    } finally {
      if (hadConfig) {
        renameSync(backupFile, configFile);
      } else {
        try { require('fs').unlinkSync(configFile); } catch {}
      }
    }
  });

  // === Fresh Install Preflight (no defaults leak) ===
  log('\n=== Fresh Install Preflight ===');

  test('preflight shows null for unconfigured values (not defaults)', () => {
    // Simulate fresh install: temporarily rename config file
    const { existsSync, renameSync } = require('fs');
    const configFile = PATHS.configFile;
    const backupFile = configFile + '.test-backup';
    const hadConfig = existsSync(configFile);

    if (hadConfig) {
      renameSync(configFile, backupFile);
    }

    try {
      const result = runScript('setup.js', 'preflight');
      const json = JSON.parse(result.trim());

      // All config values must be null on fresh install — NOT default values
      assertEqual(json.config.browser, null, 'browser must be null on fresh install');
      assertEqual(json.config.cleanupDays, null, 'cleanupDays must be null on fresh install');
      assertEqual(json.config.defaultModel, null, 'defaultModel must be null (not "dynamic")');
      assertEqual(json.config.defaultThinking, null, 'defaultThinking must be null (not "dynamic")');
      assertEqual(json.config.subscriptionTier, null, 'subscriptionTier must be null (not "pro")');
      assertEqual(json.config.exists, false, 'config.exists must be false');
    } finally {
      if (hadConfig) {
        renameSync(backupFile, configFile);
      }
    }
  });

  // === Model Selection ===
  log('\n=== Model Selection ===');

  test('model-selection.md reference exists', () => {
    const refPath = join(PLUGIN_ROOT, 'skills', 'perplexity-research', 'references', 'model-selection.md');
    assert(existsSync(refPath), 'model-selection.md should exist');
  });

  test('model-selection.md contains all model slugs', () => {
    const refPath = join(PLUGIN_ROOT, 'skills', 'perplexity-research', 'references', 'model-selection.md');
    const content = readFileSync(refPath, 'utf8');
    for (const slug of Object.keys(config.VALID_MODELS)) {
      assert(content.includes(slug), `Reference should mention ${slug}`);
    }
  });

  test('setup.js set-model command works', () => {
    const help = runScript('setup.js', '--help');
    assert(help.includes('set-model'), 'Help should mention set-model');
    assert(help.includes('set-thinking'), 'Help should mention set-thinking');
    assert(help.includes('set-tier'), 'Help should mention set-tier');
  });
}

module.exports = { run };
