#!/usr/bin/env node
/**
 * setup.js - Perplexity Research Plugin Setup Script
 *
 * CLI for setup, configuration, and session management.
 *
 * Usage:
 *   node setup.js check                - Check setup status
 *   node setup.js preflight            - JSON status for automation
 *   node setup.js set-browser <name>   - Set browser preference
 *   node setup.js set-cleanup <days>   - Set cleanup interval
 *   node setup.js clone-pool           - Clone master session to pool
 *   node setup.js check-session <N>    - Check session cookie validity
 *   node setup.js scan-sessions        - Scan all sessions
 *   node setup.js refresh-session <N>  - Refresh from valid donor
 *   node setup.js ensure-valid <N>     - Ensure session valid (for hooks)
 */

const { existsSync, cpSync } = require('fs');

// Import shared library
const { config, platform, playwright, sessionStatus, sessionCookie, cli, fileLock, PATHS, DEFAULTS } = require('./lib');
const { parseArgs } = cli;
const { checkSessionCookie, refreshSession, ensureSessionValid, validateMasterSession, validatePoolSessions } = sessionCookie;

//region Status Functions

function checkCliAlias() {
  try {
    const { existsSync } = require('fs');
    const { join } = require('path');
    const { homedir } = require('os');
    // Check if wrapper script exists at ~/.claude/bin/ppx-research
    const wrapperPath = join(homedir(), '.claude', 'bin', 'ppx-research');
    return existsSync(wrapperPath);
  } catch {
    return false;
  }
}

function getSetupStatus() {
  const cliCheck = playwright.checkPlaywrightCli();
  const aliasInstalled = checkCliAlias();
  const cfg = config.getConfig();
  const browser = cfg.browser || DEFAULTS.browser;
  const poolCheck = sessionStatus.checkSessionPool(browser);

  // Check session health from cached session-status.json (no browser needed)
  const cachedStatus = sessionStatus.getSessionStatus();
  const masterInfo = cachedStatus.sessions?.pro;
  const masterExpired = poolCheck.masterExists && (!masterInfo || sessionStatus.isSessionExpired(masterInfo.expires));
  let expiredPoolCount = 0;
  if (poolCheck.poolCount > 0) {
    for (const id of poolCheck.poolSessions) {
      const info = cachedStatus.sessions?.[id];
      if (!info || sessionStatus.isSessionExpired(info.expires)) expiredPoolCount++;
    }
  }

  const status = {
    platform: platform.getPlatform(),
    playwrightCli: {
      installed: cliCheck.installed,
      version: cliCheck.version
    },
    cliAlias: {
      installed: aliasInstalled
    },
    config: {
      exists: cfg.exists,
      browser: cfg.browser,
      cleanupDays: cfg.cleanupDays,
      defaultModel: cfg.defaultModel,
      defaultThinking: cfg.defaultThinking,
      subscriptionTier: cfg.subscriptionTier,
      outputDir: cfg.outputDir,
      file: PATHS.configFile
    },
    sessions: {
      directoryFound: !!poolCheck.sessionDir,
      masterExists: poolCheck.masterExists,
      masterExpired,
      poolCount: poolCheck.poolCount,
      poolSessions: poolCheck.poolSessions,
      expiredPoolCount,
      healthy: poolCheck.masterExists && !masterExpired && poolCheck.poolCount > 0 && expiredPoolCount === 0
    },
    missing: [],
    nextSteps: []
  };

  // Determine what's missing
  if (!cliCheck.installed) {
    status.missing.push('playwright-cli');
    status.nextSteps.push('install-playwright');
  }
  if (!aliasInstalled) {
    status.missing.push('cli-alias');
    status.nextSteps.push('register-alias');
  }
  if (!cfg.browser) {
    status.missing.push('browser');
    status.nextSteps.push('select-browser');
  }
  if (!cfg.cleanupDays) {
    status.missing.push('cleanup_days');
    status.nextSteps.push('configure-cleanup');
  }
  if (!cfg.outputDir) {
    status.missing.push('output_dir');
    status.nextSteps.push('configure-output-dir');
  }
  if (!poolCheck.masterExists || masterExpired) {
    status.missing.push('master-session');
    status.nextSteps.push('create-master-session');
  }
  if (poolCheck.poolCount === 0) {
    status.missing.push('session-pool');
    status.nextSteps.push('clone-pool');
  } else if (expiredPoolCount > 0 && !masterExpired && poolCheck.masterExists) {
    // Pool has expired sessions but master is still valid — just re-clone
    status.missing.push('expired-pool');
    status.nextSteps.push('clone-pool');
  }

  status.isComplete = status.missing.length === 0;
  status.needsConfiguration = !cfg.browser || !cfg.cleanupDays;
  status.needsSessionSetup = !poolCheck.masterExists || poolCheck.poolCount === 0 || masterExpired || expiredPoolCount > 0;

  return status;
}

//endregion

//region Commands

function cmdCheck() {
  console.log('=== Perplexity Research Plugin Setup Status ===\n');

  const status = getSetupStatus();

  // playwright-cli
  if (status.playwrightCli.installed) {
    console.log(`✓ playwright-cli: ${status.playwrightCli.version}`);
  } else {
    console.log('✗ playwright-cli: NOT INSTALLED');
    console.log('  Install with: npm install -g @playwright/cli@latest');
  }

  // CLI alias
  if (status.cliAlias.installed) {
    console.log('✓ ppx-research alias: registered');
  } else {
    console.log('✗ ppx-research alias: NOT REGISTERED');
    console.log('  Register with: npm link --prefix ~/.claude/plugins/perplexity-research');
  }

  // Config
  if (status.config.browser) {
    console.log(`✓ Browser config: ${status.config.browser}`);
  } else {
    console.log('✗ Browser config: NOT SET');
  }

  if (status.config.cleanupDays) {
    console.log(`✓ Cleanup interval: every ${status.config.cleanupDays} days`);
  } else {
    console.log(`○ Cleanup interval: not set (default: ${DEFAULTS.cleanupDays} days)`);
  }

  // Model settings
  console.log(`○ Default model: ${status.config.defaultModel || `not set (default: ${DEFAULTS.defaultModel})`}`);
  console.log(`○ Default thinking: ${status.config.defaultThinking || `not set (default: ${DEFAULTS.defaultThinking})`}`);
  console.log(`○ Subscription tier: ${status.config.subscriptionTier || `not set (default: ${DEFAULTS.subscriptionTier})`}`);
  console.log(`○ Output directory: ${status.config.outputDir || `not set (default: ${DEFAULTS.outputDir})`}`);

  // Sessions
  const browser = status.config.browser || DEFAULTS.browser;

  if (status.sessions.directoryFound) {
    console.log('✓ Session directory: found');

    if (status.sessions.masterExists && !status.sessions.masterExpired) {
      console.log('✓ Master session: exists (perplexity-pro)');
    } else if (status.sessions.masterExists && status.sessions.masterExpired) {
      console.log('✗ Master session: EXPIRED (re-login required)');
    } else {
      console.log('✗ Master session: NOT FOUND');
      console.log(`  Create with: playwright-cli -s=perplexity-pro open https://perplexity.ai --persistent --headed --browser ${browser}`);
    }

    if (status.sessions.poolCount > 0) {
      const expMsg = status.sessions.expiredPoolCount > 0
        ? ` (${status.sessions.expiredPoolCount} expired)`
        : '';
      console.log(`✓ Session pool: ${status.sessions.poolCount}/10 sessions${expMsg}`);
    } else {
      console.log('✗ Session pool: NO SESSIONS');
    }
  } else {
    console.log('✗ Session directory: NOT FOUND');
  }

  // Summary
  console.log('\n=== Summary ===');
  if (status.isComplete) {
    console.log('✓ Setup complete! Ready for research.');
  } else {
    console.log('✗ Setup incomplete. Run /perplexity-setup');
  }

  return status.isComplete;
}

function cmdPreflight() {
  const status = getSetupStatus();
  console.log(JSON.stringify(status, null, 2));
  return status;
}

function cmdSetBrowser(browser) {
  if (!browser) {
    console.error('Usage: ppx-research setup set-browser <msedge|chrome>');
    process.exit(1);
  }
  const result = config.setBrowser(browser);
  config.registerCwd();
  console.log(`Browser preference saved: ${result.browser}`);
  console.log(`Config file: ${result.configFile}`);
}

function cmdSetCleanup(days) {
  if (!days) {
    console.error('Usage: ppx-research setup set-cleanup <days>');
    process.exit(1);
  }
  const result = config.setCleanupDays(days);
  console.log(`Cleanup interval saved: every ${result.cleanupDays} days`);
  console.log(`Config file: ${result.configFile}`);
}

function cmdSetModel(model) {
  if (!model) {
    console.error('Usage: ppx-research setup set-model <dynamic|best|model-slug>');
    process.exit(1);
  }
  const result = config.setDefaultModel(model);
  console.log(`Default model saved: ${result.defaultModel}`);
  console.log(`Config file: ${result.configFile}`);
}

function cmdSetThinking(thinking) {
  if (!thinking) {
    console.error('Usage: ppx-research setup set-thinking <dynamic|true|false>');
    process.exit(1);
  }
  const result = config.setDefaultThinking(thinking);
  console.log(`Default thinking saved: ${result.defaultThinking}`);
  console.log(`Config file: ${result.configFile}`);
}

function cmdSetTier(tier) {
  if (!tier) {
    console.error('Usage: ppx-research setup set-tier <pro|max>');
    process.exit(1);
  }
  const result = config.setSubscriptionTier(tier);
  console.log(`Subscription tier saved: ${result.subscriptionTier}`);
  console.log(`Config file: ${result.configFile}`);
}

function cmdSetOutputDir(dir) {
  if (!dir) {
    console.error('Usage: ppx-research setup set-output-dir <folder-name>');
    process.exit(1);
  }
  const result = config.setOutputDir(dir);
  console.log(`Output directory saved: ${result.outputDir}`);
  console.log(`Config file: ${result.configFile}`);
}

async function cmdClonePool(args) {
  const count = args.count ? parseInt(args.count, 10) : 10;
  const browser = args.browser || config.getBrowser();
  const skipValidation = args.skipvalidation || false;

  if (count < 1 || count > 10) {
    throw new Error('Count must be between 1 and 10');
  }

  const sessionDir = platform.getPlaywrightSessionDir();
  if (!sessionDir) {
    throw new Error('Playwright session directory not found. Run "playwright-cli -s=perplexity-pro open https://perplexity.ai --persistent --headed" at least once.');
  }

  const masterPath = sessionStatus.getMasterSessionPath(browser);
  if (!masterPath || !existsSync(masterPath)) {
    throw new Error('Master session not found. Log into Perplexity first.');
  }

  // Step 1: Validate master session — if expired, try to promote a valid pool session
  const masterCheck = await validateMasterSession(browser, { log: console.log });
  if (!masterCheck.loggedIn) {
    console.log('Master session expired. Searching for valid pool session to promote...');
    const cachedStatus = sessionStatus.getSessionStatus();
    const donorId = sessionStatus.findValidDonorSession(cachedStatus, 'pro');

    if (donorId !== null) {
      console.log(`  Found valid session ${donorId} — promoting to master`);
      const { cpSync, rmSync } = require('fs');
      const donorPath = sessionStatus.getSessionPath(donorId, browser);
      rmSync(masterPath, { recursive: true, force: true });
      cpSync(donorPath, masterPath, { recursive: true });

      // Re-validate the promoted master
      const recheck = await validateMasterSession(browser, { log: console.log });
      if (!recheck.loggedIn) {
        throw new Error('Promoted session also expired. Please re-login.');
      }
      console.log(`  Master refreshed from session ${donorId}`);
    } else {
      throw new Error('Master session is not logged in and no valid pool sessions found. Please re-login.');
    }
  }

  // Step 2: Clone master to pool sessions
  console.log(`\nCloning master session to ${count} pool sessions...`);

  let cloned = 0, skipped = 0;

  for (let i = 0; i < count; i++) {
    const targetPath = sessionStatus.getSessionPath(i, browser);

    try {
      if (existsSync(targetPath)) {
        const { rmSync } = require('fs');
        rmSync(targetPath, { recursive: true, force: true });
        console.log(`  Session ${i}: replaced (overwritten from master)`);
      } else {
        console.log(`  Session ${i}: created`);
      }
      cpSync(masterPath, targetPath, { recursive: true });
      cloned++;
    } catch (error) {
      console.log(`  Session ${i}: FAILED - ${error.message}`);
    }
  }

  console.log(`\nCloned ${cloned} new, skipped ${skipped} existing.`);

  // Step 3: Validate each pool session individually
  if (!skipValidation) {
    const results = await validatePoolSessions(browser, count, { log: console.log });
    return { cloned, skipped, total: cloned + skipped, validation: results };
  }

  return { cloned, skipped, total: cloned + skipped };
}

function parseSessionId(sessionId, commandName) {
  if (sessionId === undefined) {
    console.error(`Usage: ppx-research setup ${commandName} <0-9>`);
    process.exit(1);
  }
  const id = parseInt(sessionId, 10);
  if (isNaN(id) || id < 0 || id > 9) {
    console.error('Session number must be 0-9');
    process.exit(1);
  }
  return id;
}

async function cmdCheckSession(sessionId) {
  const id = parseSessionId(sessionId, 'check-session');

  console.log(`Checking session ${id}...`);
  const result = await checkSessionCookie(id);

  sessionStatus.updateSessionStatus(id, {
    expires: result.expires,
    isPro: result.isPro
  });

  if (result.loggedIn) {
    console.log(`✓ Session ${id}: logged in (Pro: ${result.isPro})`);
    console.log(`  Expires: ${result.expires}`);
    console.log(`  Status: ${result.isExpired ? 'EXPIRED' : 'valid'}`);
  } else {
    console.log(`✗ Session ${id}: NOT logged in`);
  }

  console.log(`\nJSON: ${JSON.stringify(result)}`);
  return result;
}

async function cmdScanSessions(args) {
  const browser = args.browser || config.getBrowser();
  const poolCheck = sessionStatus.checkSessionPool(browser);

  if (poolCheck.poolCount === 0) {
    console.log('No sessions found. Run clone-pool first.');
    process.exit(1);
  }

  console.log(`Scanning ${poolCheck.poolCount} sessions...`);
  return await validatePoolSessions(browser, poolCheck.poolSessions, { log: console.log });
}

async function cmdRefreshSession(sessionId, args) {
  const id = parseSessionId(sessionId, 'refresh-session');

  const browser = args.browser || config.getBrowser();
  await refreshSession(id, browser, { log: console.log });
}

async function cmdEnsureValid(sessionId, args) {
  const id = parseInt(sessionId, 10);
  if (isNaN(id) || id < 0 || id > 9) {
    console.log(JSON.stringify({ success: false, error: 'Invalid session number' }));
    process.exit(1);
  }

  const browser = args.browser || config.getBrowser();
  console.error(`Validating session ${id}...`);

  // Hook captures stdout for JSON — route status messages to stderr
  const result = await ensureSessionValid(id, browser, { log: msg => console.error(msg) });
  console.log(JSON.stringify(result));

  if (!result.success) {
    process.exit(1);
  }
  return result;
}

//endregion

//region CLI

function showUsage() {
  console.log(`
Perplexity Research Plugin - Setup Script

Usage: ppx-research setup <command> [options]

Commands:
  check                  Check setup status
  preflight              JSON output for automation
  set-browser <name>     Set browser (msedge or chrome)
  set-cleanup <days>     Set cleanup interval (1-30)
  set-model <value>      Set default model (dynamic, best, or model slug)
  set-thinking <value>   Set default thinking (dynamic, true, false)
  set-tier <value>       Set subscription tier (pro, max)
  set-output-dir <path>  Set research output directory (relative to project)
  clone-pool             Clone master to pool (0-9)
  check-session <N>      Check session cookie (0-9)
  scan-sessions          Scan all sessions
  refresh-session <N>    Refresh from valid donor
  ensure-valid <N>       Ensure valid for hooks

Options:
  --browser <name>       Browser for operations
  --count <n>            Sessions for clone-pool (default: 10)
`);
}

async function main() {
  const { command, value, args } = parseArgs(process.argv.slice(2));

  try {
    switch (command) {
      case 'check': cmdCheck(); break;
      case 'preflight': cmdPreflight(); break;
      case 'set-browser': cmdSetBrowser(value); break;
      case 'set-cleanup': cmdSetCleanup(value); break;
      case 'set-model': cmdSetModel(value); break;
      case 'set-thinking': cmdSetThinking(value); break;
      case 'set-tier': cmdSetTier(value); break;
      case 'set-output-dir': cmdSetOutputDir(value); break;
      case 'clone-pool': await cmdClonePool(args); break;
      case 'check-session': await cmdCheckSession(value); break;
      case 'scan-sessions': await cmdScanSessions(args); break;
      case 'refresh-session': await cmdRefreshSession(value, args); break;
      case 'ensure-valid': await cmdEnsureValid(value, args); break;
      case 'help':
      case '--help':
      case '-h':
        showUsage();
        break;
      default:
        if (command) console.error(`Unknown command: ${command}`);
        showUsage();
        process.exit(command ? 1 : 0);
    }
  } catch (error) {
    console.error(`ERROR: ${platform.stripCliXml(error.message)}`);
    process.exit(1);
  }
}

main();
