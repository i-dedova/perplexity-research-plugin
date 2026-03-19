/**
 * test-session.js - Session status, session state, deep mode guards
 *
 * Tests: sessionStatus + sessionState + deepModeGuards
 */

const { existsSync, mkdirSync, rmSync } = require('fs');
const {
  PLUGIN_ROOT,
  log, test,
  assert, assertEqual, assertType,
  lib, withSessionState, runHook, runScript
} = require('./test-utils');

function run() {
  const { sessionStatus, sessionState, PATHS } = lib();

  // === session-status.js Module ===
  log('\n=== session-status.js Module ===');

  test('getSessionStatus returns valid structure', () => {
    const status = sessionStatus.getSessionStatus();
    assert('sessions' in status, 'Should have sessions');
    assert('lastFullScan' in status, 'Should have lastFullScan');
    assert(typeof status.sessions === 'object', 'Sessions should be object');
  });

  test('isSessionExpired handles null', () => {
    assertEqual(sessionStatus.isSessionExpired(null), true, 'Null should be expired');
    assertEqual(sessionStatus.isSessionExpired(undefined), true, 'Undefined should be expired');
  });

  test('isSessionExpired handles future date', () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    assertEqual(sessionStatus.isSessionExpired(future), false, 'Future date should not be expired');
  });

  test('isSessionExpired handles past date', () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    assertEqual(sessionStatus.isSessionExpired(past), true, 'Past date should be expired');
  });

  test('findValidDonorSession returns string or null', () => {
    const mockStatus = {
      sessions: {
        '0': { expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() },
        '1': { expires: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() }
      }
    };
    const donor = sessionStatus.findValidDonorSession(mockStatus, '1');
    assertEqual(donor, '0', 'Should find session 0 as valid donor');
  });

  test('findValidDonorSession excludes target', () => {
    const mockStatus = {
      sessions: {
        '0': { expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() }
      }
    };
    const donor = sessionStatus.findValidDonorSession(mockStatus, '0');
    assertEqual(donor, null, 'Should exclude target session');
  });

  test('checkSessionPool returns valid structure', () => {
    const pool = sessionStatus.checkSessionPool();
    assert('sessionDir' in pool, 'Should have sessionDir');
    assert('masterExists' in pool, 'Should have masterExists');
    assert('poolCount' in pool, 'Should have poolCount');
    assert('poolSessions' in pool, 'Should have poolSessions');
    assert('missingSessions' in pool, 'Should have missingSessions');
    assert('hasMinimum' in pool, 'Should have hasMinimum');
    assert(Array.isArray(pool.poolSessions), 'poolSessions should be array');
    assert(Array.isArray(pool.missingSessions), 'missingSessions should be array');
  });

  test('getSessionPath returns string or null', () => {
    const path = sessionStatus.getSessionPath(0);
    assert(path === null || typeof path === 'string', 'Should return string or null');
  });

  test('getMasterSessionPath returns string or null', () => {
    const path = sessionStatus.getMasterSessionPath();
    assert(path === null || typeof path === 'string', 'Should return string or null');
  });

  // === Preflight Session Health ===
  log('\n=== Preflight Session Health ===');

  // Create fake daemon dir structure if it doesn't exist (needed for CI)
  const { platform: platformMod } = lib();
  const sessionDir = platformMod.getPlaywrightSessionDir();
  let createdFakeDaemonDir = null;
  if (!sessionDir) {
    const { homedir: getHome } = require('os');
    const { join: pathJoin } = require('path');
    const home = getHome();
    const p = process.platform;
    let baseDir;
    if (p === 'win32') {
      baseDir = pathJoin(process.env.LOCALAPPDATA || pathJoin(home, 'AppData', 'Local'), 'ms-playwright', 'daemon');
    } else if (p === 'darwin') {
      baseDir = pathJoin(home, 'Library', 'Application Support', 'ms-playwright', 'daemon');
    } else {
      baseDir = pathJoin(home, '.local', 'share', 'ms-playwright', 'daemon');
    }
    // Create: daemon/fakehash/ud-perplexity-pro-msedge/
    const fakeHashDir = pathJoin(baseDir, 'ci-test-hash');
    const fakeMasterDir = pathJoin(fakeHashDir, 'ud-perplexity-pro-msedge');
    mkdirSync(fakeMasterDir, { recursive: true });
    // Also create pool session 0
    mkdirSync(pathJoin(fakeHashDir, 'ud-perplexity-0-msedge'), { recursive: true });
    createdFakeDaemonDir = baseDir;
  }

  test('getSetupStatus detects expired master session', () => {
    const { fileLock, PATHS } = lib();
    // Temporarily set master to expired in session-status.json
    const origStatus = sessionStatus.getSessionStatus();
    const origMaster = origStatus.sessions?.pro;

    fileLock.withLockedFile(PATHS.sessionStatusFile, (s) => {
      s.sessions = s.sessions || {};
      s.sessions.pro = {
        expires: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        isPro: true,
        lastChecked: new Date().toISOString(),
        isMaster: true
      };
    });

    try {
      const result = runScript('setup.js', 'preflight');
      const json = JSON.parse(result.trim());
      assert(json.sessions.masterExpired === true, 'masterExpired should be true for expired master');
      assert(json.missing.includes('master-session'), 'missing should include master-session when expired');
      assert(json.needsSessionSetup === true, 'needsSessionSetup should be true');
    } finally {
      // Restore original master
      fileLock.withLockedFile(PATHS.sessionStatusFile, (s) => {
        s.sessions = s.sessions || {};
        if (origMaster) s.sessions.pro = origMaster;
        else delete s.sessions.pro;
      });
    }
  });

  test('getSetupStatus detects expired pool sessions', () => {
    const { fileLock, PATHS } = lib();
    const origStatus = sessionStatus.getSessionStatus();
    const origSession0 = origStatus.sessions?.['0'];

    fileLock.withLockedFile(PATHS.sessionStatusFile, (s) => {
      s.sessions = s.sessions || {};
      s.sessions['0'] = {
        expires: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        isPro: true,
        lastChecked: new Date().toISOString()
      };
    });

    try {
      const result = runScript('setup.js', 'preflight');
      const json = JSON.parse(result.trim());
      assert(json.sessions.expiredPoolCount >= 1, 'expiredPoolCount should be >= 1');
      assert(json.needsSessionSetup === true, 'needsSessionSetup should be true');
    } finally {
      fileLock.withLockedFile(PATHS.sessionStatusFile, (s) => {
        s.sessions = s.sessions || {};
        if (origSession0) s.sessions['0'] = origSession0;
        else delete s.sessions['0'];
      });
    }
  });

  test('getSetupStatus reports healthy when all sessions valid', () => {
    const result = runScript('setup.js', 'preflight');
    const json = JSON.parse(result.trim());
    assertEqual(json.sessions.masterExpired, false, 'masterExpired should be false for valid master');
    assertType(json.sessions.expiredPoolCount, 'number', 'expiredPoolCount');
  });

  test('findValidDonorSession can find donor for master promotion', () => {
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const mockStatus = {
      sessions: {
        'pro': { expires: pastDate, isMaster: true },
        '0': { expires: pastDate },
        '1': { expires: futureDate },
        '2': { expires: pastDate }
      }
    };
    const donor = sessionStatus.findValidDonorSession(mockStatus, 'pro');
    assertEqual(donor, '1', 'Should find session 1 as valid donor for expired master');
  });

  test('findValidDonorSession returns null when all expired', () => {
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const mockStatus = {
      sessions: {
        'pro': { expires: pastDate },
        '0': { expires: pastDate },
        '1': { expires: null }
      }
    };
    const donor = sessionStatus.findValidDonorSession(mockStatus, 'pro');
    assertEqual(donor, null, 'Should return null when no valid donors');
  });

  // Cleanup fake daemon dir if we created one
  if (createdFakeDaemonDir) {
    try { rmSync(createdFakeDaemonDir, { recursive: true, force: true }); } catch {}
  }

  // === session-state.js Module ===
  log('\n=== session-state.js Module ===');

  test('getSessionStateFile returns string path', () => {
    const path = sessionState.getSessionStateFile(0);
    assertType(path, 'string', 'State file path');
    assert(path.includes('session-state-0'), 'Should contain session ID');
    assert(path.includes('.playwright-cli'), 'Should be in .playwright-cli dir');
  });

  test('hasSessionState returns boolean', () => {
    const result = sessionState.hasSessionState(999);
    assertType(result, 'boolean', 'hasSessionState');
  });

  test('saveSessionState and getSessionState roundtrip', () => {
    if (!existsSync(PATHS.downloadsDir)) {
      mkdirSync(PATHS.downloadsDir, { recursive: true });
    }

    const testSessionId = 'smoke-test-999';
    try {
      sessionState.saveSessionState(testSessionId, 'deep', 'test-topic');
      assert(sessionState.hasSessionState(testSessionId), 'Should exist after save');

      const state = sessionState.getSessionState(testSessionId);
      assertEqual(state.mode, 'deep', 'Mode should match');
      assertEqual(state.topicSlug, 'test-topic', 'Topic slug should match');

      sessionState.clearSessionState(testSessionId);
      assert(!sessionState.hasSessionState(testSessionId), 'Should not exist after clear');
    } finally {
      try { sessionState.clearSessionState(testSessionId); } catch {}
    }
  });

  test('getSessionState throws for missing session', () => {
    let threw = false;
    try {
      sessionState.getSessionState('non-existent-session-12345');
    } catch (e) {
      threw = true;
      assert(e.message.includes('No session state'), 'Error should mention no state');
    }
    assert(threw, 'Should throw for missing session');
  });

  test('saveSessionState with strategy field', () => {
    withSessionState('smoke-test-strategy', ['deep', 'test-slug', 'single'], (ss) => {
      const state = ss.getSessionState('smoke-test-strategy');
      assertEqual(state.mode, 'deep', 'Mode should match');
      assertEqual(state.topicSlug, 'test-slug', 'TopicSlug should match');
      assertEqual(state.strategy, 'single', 'Strategy should be single');
    });
  });

  test('saveSessionState with parallel strategy', () => {
    withSessionState('smoke-test-parallel', ['search', 'multi-topic', 'parallel'], (ss) => {
      const state = ss.getSessionState('smoke-test-parallel');
      assertEqual(state.strategy, 'parallel', 'Strategy should be parallel');
    });
  });

  test('saveSessionState without strategy (backward compat)', () => {
    withSessionState('smoke-test-no-strategy', ['search', 'compat-test'], (ss) => {
      const state = ss.getSessionState('smoke-test-no-strategy');
      assertEqual(state.mode, 'search', 'Mode should match');
      assertEqual(state.topicSlug, 'compat-test', 'TopicSlug should match');
      assert(!state.strategy, 'Strategy should be undefined when not provided');
    });
  });

  // === Deep Mode Guards ===
  log('\n=== Deep Mode Guards ===');

  test('Session state saves model and thinking', () => {
    withSessionState('smoke-test-model', ['search', 'model-test', 'single', 'sonar', 'false'], (ss) => {
      const state = ss.getSessionState('smoke-test-model');
      assertEqual(state.model, 'sonar', 'Model should be saved');
      assertEqual(state.thinking, 'false', 'Thinking should be saved');
    });
  });

  test('Session state backward compat (no model/thinking)', () => {
    withSessionState('smoke-test-compat', ['deep', 'compat-test', 'single'], (ss) => {
      const state = ss.getSessionState('smoke-test-compat');
      assertEqual(state.mode, 'deep', 'Mode should match');
      assert(!state.model, 'Model should be undefined');
      assert(state.thinking === null || state.thinking === undefined, 'Thinking should be null/undefined');
    });
  });

  test('inject-templates.js includes model config', () => {
    const result = runHook('inject-templates.js', {});
    const json = JSON.parse(result.trim());
    const ctx = json.hookSpecificOutput.additionalContext;
    assert(ctx.includes('Default Model:'), 'Should include Default Model');
    assert(ctx.includes('Default Thinking:'), 'Should include Default Thinking');
    assert(ctx.includes('Subscription Tier:'), 'Should include Subscription Tier');
  });
}

module.exports = { run };
