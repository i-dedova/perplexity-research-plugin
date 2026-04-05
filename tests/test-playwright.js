/**
 * test-playwright.js - Browser session lifecycle (conditional on playwright-cli)
 *
 * Tests: playwrightModule
 */

const {
  log, logVerbose, test, testAsync, skip,
  assert, assertEqual, assertType,
  syncSleep, lib
} = require('./test-utils');

async function run() {
  const { playwright, sessionStatus } = lib();

  log('\n=== playwright.js Module ===');

  const cliCheck = playwright.checkPlaywrightCli();

  test('CLI_TIMEOUT is reasonable', () => {
    assert(playwright.CLI_TIMEOUT >= 1000, 'Timeout should be >= 1000ms');
    assert(playwright.CLI_TIMEOUT <= 60000, 'Timeout should be <= 60000ms');
  });

  test('checkPlaywrightCli returns valid structure', () => {
    assert('installed' in cliCheck, 'Should have installed property');
    assert('version' in cliCheck, 'Should have version property');
    assert('packageVersion' in cliCheck, 'Should have packageVersion property');
    assertType(cliCheck.installed, 'boolean', 'installed');
    if (cliCheck.installed) {
      assertType(cliCheck.version, 'string', 'version');
      assertType(cliCheck.packageVersion, 'string', 'packageVersion');
      // Package version must be semver-like (0.1.x)
      assert(cliCheck.packageVersion.match(/^\d+\.\d+\.\d+/),
        `packageVersion should be semver, got: ${cliCheck.packageVersion}`);
      logVerbose(`CLI version: ${cliCheck.version}, package: ${cliCheck.packageVersion}`);
    }
  });

  test('packageVersion meets minimum 0.1.1', () => {
    if (!cliCheck.installed) return;
    assert(cliCheck.packageVersion >= '0.1.1',
      `Package version ${cliCheck.packageVersion} is below minimum 0.1.1`);
  });

  test('isSessionRunning returns boolean', () => {
    const result = playwright.isSessionRunning('non-existent-session');
    assertType(result, 'boolean', 'isSessionRunning');
    assertEqual(result, false, 'Non-existent session should not be running');
  });

  // Tab management — unit tests (no session needed)
  test('getTabCount returns -1 for non-existent session', () => {
    const count = playwright.getTabCount('non-existent-999');
    assertEqual(count, -1, 'Should return -1 when session does not exist');
  });

  test('tabSelect does not throw for non-existent session', () => {
    playwright.tabSelect('non-existent-999', 0);
  });

  test('tabClose does not throw for non-existent session', () => {
    playwright.tabClose('non-existent-999', 0);
  });

  // Conditional tests - run if playwright-cli is installed (local dev)
  if (cliCheck.installed) {
    test('runCli executes --version', () => {
      const result = playwright.runCli('--version');
      assert(result.includes(cliCheck.version) || result.length > 0, 'Should return version output');
    });

    test('runCli executes list', () => {
      const result = playwright.runCli('list');
      assertType(result, 'string', 'list output');
    });
  } else {
    skip('runCli --version', 'playwright-cli not installed');
    skip('runCli list', 'playwright-cli not installed');
  }

  // Session tests - only if playwright-cli installed AND session pool exists
  if (cliCheck.installed) {
    const poolCheck = sessionStatus.checkSessionPool();

    if (poolCheck.hasMinimum) {
      const TEST_SESSION = 0;

      test(`startSession opens browser (session ${TEST_SESSION})`, () => {
        playwright.startSession(TEST_SESSION);
        // Give the daemon time to register before polling
        syncSleep(5000);
      });

      test('isSessionRunning detects started session', () => {
        // Edge cold start on Windows can take 15-30 seconds
        const start = Date.now();
        let isRunning = false;

        while (Date.now() - start < 25000) {
          isRunning = playwright.isSessionRunning(TEST_SESSION);
          if (isRunning) break;
          syncSleep(2000);
        }

        assert(isRunning, `Session ${TEST_SESSION} should be running after start`);
      });

      test('session is logged into Perplexity (has session cookie)', () => {
        playwright.runCode(TEST_SESSION, 'async page => await page.goto("https://perplexity.ai")');
        syncSleep(3000);

        const cookieCheck = playwright.runCode(TEST_SESSION,
          'async page => { const cookies = await page.context().cookies(); const c = cookies.find(c => c.name === "__Secure-next-auth.session-token"); return c ? c.expires : null; }'
        );

        assert(cookieCheck !== null, 'Cookie check should return a result');
        const match = cookieCheck.match(/### Result\s*\n([\d.]+)/);
        assert(match, `Session ${TEST_SESSION} should have session cookie (logged in). Got: ${cookieCheck}`);

        const expires = new Date(Math.floor(parseFloat(match[1])) * 1000);
        assert(expires > new Date(), `Session cookie should not be expired. Expires: ${expires.toISOString()}`);
        logVerbose(`Session cookie valid until: ${expires.toISOString()}`);
      });

      test('runCode executes in session', () => {
        const result = playwright.runCode(TEST_SESSION, 'async page => 1 + 1');
        assert(result !== null, 'runCode should return result');
      });

      test('pressKey sends key to session', () => {
        playwright.pressKey(TEST_SESSION, 'Escape');
      });

      // Tab management — integration tests (live session)
      test('getTabCount returns positive number for running session', () => {
        const count = playwright.getTabCount(TEST_SESSION);
        assert(count >= 1, `Expected >= 1 tab, got ${count}`);
        logVerbose(`Tab count: ${count}`);
      });

      test('tabSelect(0) does not throw for running session', () => {
        playwright.tabSelect(TEST_SESSION, 0);
      });

      test('tab-new + getTabCount detects extra tab', () => {
        const before = playwright.getTabCount(TEST_SESSION);
        // Open a phantom tab to simulate the bug
        try {
          require('child_process').execFileSync(
            process.execPath,
            [playwright.getPlaywrightCliPath(), `-s=perplexity-${TEST_SESSION}`, 'tab-new'],
            { encoding: 'utf8', timeout: 8000, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
          );
        } catch { /* tab-new may not be available in all versions */ }

        const after = playwright.getTabCount(TEST_SESSION);
        if (after > before) {
          logVerbose(`Phantom tab created: ${before} → ${after}`);
          // Clean it up via tabClose
          playwright.tabClose(TEST_SESSION, after - 1);
          playwright.tabSelect(TEST_SESSION, 0);
          const final = playwright.getTabCount(TEST_SESSION);
          assertEqual(final, before, `Tab count should return to ${before} after close`);
          logVerbose(`Phantom tab closed: ${after} → ${final}`);
        } else {
          logVerbose(`tab-new did not increase count (before=${before}, after=${after}), skipping close test`);
        }
      });

      await testAsync('checkSessionCookie validates with retry', async () => {
        const { sessionCookie } = lib();
        // Session 0 should already be stopped. checkSessionCookie starts it, checks, stops.
        const result = await sessionCookie.checkSessionCookie(TEST_SESSION);
        assert(typeof result.loggedIn === 'boolean', 'Should have loggedIn field');
        assert(typeof result.isPro === 'boolean', 'Should have isPro field');
        if (result.loggedIn) {
          assert(result.expires !== null, 'loggedIn session should have expires');
          assert(!result.isExpired, 'Fresh session should not be expired');
        }
        logVerbose(`checkSessionCookie: loggedIn=${result.loggedIn} expires=${result.expires}`);
      });

      test('stopSession closes browser', () => {
        playwright.stopSession(TEST_SESSION);
        syncSleep(1000);
        const stillRunning = playwright.isSessionRunning(TEST_SESSION);
        assert(!stillRunning, `Session ${TEST_SESSION} should be stopped`);
      });

    } else {
      skip('startSession', 'No session pool configured');
      skip('isSessionRunning (live)', 'No session pool configured');
      skip('runCode', 'No session pool configured');
      skip('pressKey', 'No session pool configured');
      skip('getTabCount (live)', 'No session pool configured');
      skip('tabSelect (live)', 'No session pool configured');
      skip('tab-new + close cycle', 'No session pool configured');
      skip('stopSession', 'No session pool configured');
    }
  } else {
    skip('startSession', 'playwright-cli not installed');
    skip('isSessionRunning (live)', 'playwright-cli not installed');
    skip('runCode', 'playwright-cli not installed');
    skip('pressKey', 'playwright-cli not installed');
    skip('getTabCount (live)', 'playwright-cli not installed');
    skip('tabSelect (live)', 'playwright-cli not installed');
    skip('tab-new + close cycle', 'playwright-cli not installed');
    skip('stopSession', 'playwright-cli not installed');
  }

  // verifySessionRunning is expected to throw when no session running
  test('verifySessionRunning throws for non-running session', () => {
    if (!cliCheck.installed) {
      return; // Skip silently - already covered by skipped tests above
    }

    let threw = false;
    try {
      playwright.verifySessionRunning('non-existent-999');
    } catch (e) {
      threw = true;
      assert(e.message.includes('not running'), 'Error should mention not running');
    }
    assert(threw, 'Should throw for non-running session');
  });

  // === CI Browser Integration (no auth needed) ===
  // Tests cross-platform browser spawn/close lifecycle using example.com
  if (cliCheck.installed && process.env.CI) {
    log('\n=== CI Browser Integration ===');
    const CI_SESSION = 'ci-test';
    const { execFileSync: ciExecFileSync } = require('child_process');
    const { getPlaywrightCliPath } = playwright;

    // Helper: run playwright-cli with -s= flag (works across all versions)
    function ciCli(args, opts = {}) {
      const jsPath = getPlaywrightCliPath();
      const fullArgs = [`-s=${CI_SESSION}`, ...args];
      if (jsPath) {
        return ciExecFileSync(process.execPath, [jsPath, ...fullArgs], {
          encoding: 'utf8', timeout: opts.timeout || 15000,
          windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
        });
      }
      return ciExecFileSync('playwright-cli', fullArgs, {
        encoding: 'utf8', timeout: opts.timeout || 15000,
        windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
      });
    }

    // Open session and poll until it appears in list.
    // CLI 0.1.5+ registers sessions asynchronously — fixed sleep is insufficient.
    let ciSessionReady = false;

    test('open browser session and verify registration', () => {
      // Open — must NOT swallow errors
      const output = ciCli(['open', 'https://example.com', '--persistent', '--browser', 'chrome'], { timeout: 20000 });
      logVerbose(`open output: ${output.substring(0, 200)}`);

      // Poll until session appears in list (up to 15s)
      const start = Date.now();
      while (Date.now() - start < 15000) {
        try {
          const list = ciCli(['list']);
          if (list.includes(CI_SESSION)) {
            ciSessionReady = true;
            logVerbose(`session registered after ${Date.now() - start}ms`);
            break;
          }
        } catch {}
        syncSleep(2000);
      }
      assert(ciSessionReady, `Session ${CI_SESSION} should appear in list within 15s`);
    });

    // Tab management — tests the phantom tab fix (no extra sleeps, pure CLI calls)
    test('run-code returns tab count of 1 for fresh session', () => {
      if (!ciSessionReady) return;
      const result = ciCli(['run-code', 'async page => page.context().pages().length']);
      logVerbose(`tab count result: ${result.substring(0, 100)}`);
      assert(result.includes('1'), `Fresh session should have 1 tab, got: ${result.trim()}`);
    });

    test('tab-new + tab-close lifecycle', () => {
      if (!ciSessionReady) return;
      ciCli(['tab-new']);
      const after = ciCli(['run-code', 'async page => page.context().pages().length']);
      logVerbose(`after tab-new: ${after.substring(0, 100)}`);

      ciCli(['tab-close', '1']);
      ciCli(['tab-select', '0']);
      const final = ciCli(['run-code', 'async page => page.context().pages().length']);
      logVerbose(`after tab-close: ${final.substring(0, 100)}`);
      assert(final.includes('1'), `Should return to 1 tab after close, got: ${final.trim()}`);
    });

    test('close CI session', () => {
      try {
        ciCli(['close'], { timeout: 10000 });
      } catch {
        // may already be closed
      }
    });

    test('session closed after close command', () => {
      const output = ciCli(['list']);
      const isOpen = new RegExp(`${CI_SESSION}[\\s\\S]*?status:\\s*open`).test(output);
      assert(!isOpen, `Session ${CI_SESSION} should not be open after close`);
    });

    // macOS has a GUI desktop on GitHub Actions — validate --headed --persistent
    // matches the actual setup flow (the flags users run during /perplexity-setup)
    if (require('os').platform() === 'darwin') {
      const CI_HEADED_SESSION = 'ci-headed-test';

      function ciHeadedCli(args, opts = {}) {
        const jsPath = getPlaywrightCliPath();
        const fullArgs = [`-s=${CI_HEADED_SESSION}`, ...args];
        if (jsPath) {
          return ciExecFileSync(process.execPath, [jsPath, ...fullArgs], {
            encoding: 'utf8', timeout: opts.timeout || 15000,
            windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
          });
        }
        return ciExecFileSync('playwright-cli', fullArgs, {
          encoding: 'utf8', timeout: opts.timeout || 15000,
          windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
        });
      }

      test('open headed+persistent session on macOS and verify registration', () => {
        const output = ciHeadedCli(['open', 'https://example.com', '--persistent', '--headed', '--browser', 'chrome'], { timeout: 25000 });
        logVerbose(`headed open output: ${output.substring(0, 200)}`);

        // Poll until session appears (up to 15s)
        const start = Date.now();
        let found = false;
        while (Date.now() - start < 15000) {
          try {
            const list = ciHeadedCli(['list']);
            if (list.includes(CI_HEADED_SESSION)) { found = true; break; }
          } catch {}
          syncSleep(2000);
        }
        assert(found, `Session ${CI_HEADED_SESSION} should appear in list within 15s`);
      });

      test('close headed session', () => {
        try {
          ciHeadedCli(['close'], { timeout: 10000 });
        } catch {
          // may already be closed
        }
      });

      test('headed session closed after close command', () => {
        const output = ciHeadedCli(['list']);
        const isOpen = new RegExp(`${CI_HEADED_SESSION}[\\s\\S]*?status:\\s*open`).test(output);
        assert(!isOpen, `Session ${CI_HEADED_SESSION} should not be open after close`);
      });
    }
  }
}

module.exports = { run };
