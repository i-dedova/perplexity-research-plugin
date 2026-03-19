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
    assertType(cliCheck.installed, 'boolean', 'installed');
    if (cliCheck.installed) {
      assertType(cliCheck.version, 'string', 'version');
    }
  });

  test('isSessionRunning returns boolean', () => {
    const result = playwright.isSessionRunning('non-existent-session');
    assertType(result, 'boolean', 'isSessionRunning');
    assertEqual(result, false, 'Non-existent session should not be running');
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
      skip('stopSession', 'No session pool configured');
    }
  } else {
    skip('startSession', 'playwright-cli not installed');
    skip('isSessionRunning (live)', 'playwright-cli not installed');
    skip('runCode', 'playwright-cli not installed');
    skip('pressKey', 'playwright-cli not installed');
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
    const { execFileSync, spawn: cpSpawn } = require('child_process');
    const { getPlaywrightCliPath } = playwright;
    const ciEnv = { ...process.env, PLAYWRIGHT_CLI_SESSION: CI_SESSION };

    test('spawn browser with example.com (no Cloudflare)', () => {
      const jsPath = getPlaywrightCliPath();
      const args = ['open', 'https://example.com', '--persistent', '--headed', '--browser', 'chromium'];
      if (jsPath) {
        const child = cpSpawn(process.execPath, [jsPath, ...args], {
          stdio: 'ignore', windowsHide: true,
          detached: process.platform !== 'win32', env: ciEnv
        });
        child.on('error', () => {});
        child.unref();
      } else {
        execFileSync('playwright-cli', args, {
          timeout: 15000, windowsHide: true, env: ciEnv,
          stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf8'
        });
      }
      syncSleep(8000);
    });

    test('isSessionRunning detects CI session', () => {
      const jsPath = getPlaywrightCliPath();
      let output;
      if (jsPath) {
        output = execFileSync(process.execPath, [jsPath, 'list'], {
          encoding: 'utf8', timeout: 5000, windowsHide: true
        });
      } else {
        output = execFileSync('playwright-cli', ['list'], {
          encoding: 'utf8', timeout: 5000, windowsHide: true
        });
      }
      assert(output.includes(CI_SESSION), `Session ${CI_SESSION} should appear in list`);
      assert(output.includes('open'), 'Session should have status: open');
    });

    test('close CI session cleanly', () => {
      const jsPath = getPlaywrightCliPath();
      if (jsPath) {
        execFileSync(process.execPath, [jsPath, 'close'], {
          encoding: 'utf8', timeout: 10000, windowsHide: true, env: ciEnv
        });
      } else {
        execFileSync('playwright-cli', ['close'], {
          encoding: 'utf8', timeout: 10000, windowsHide: true, env: ciEnv
        });
      }
      syncSleep(1000);
    });

    test('session no longer running after close', () => {
      const jsPath = getPlaywrightCliPath();
      let output;
      if (jsPath) {
        output = execFileSync(process.execPath, [jsPath, 'list'], {
          encoding: 'utf8', timeout: 5000, windowsHide: true
        });
      } else {
        output = execFileSync('playwright-cli', ['list'], {
          encoding: 'utf8', timeout: 5000, windowsHide: true
        });
      }
      const isOpen = new RegExp(`${CI_SESSION}[\\s\\S]*?status:\\s*open`).test(output);
      assert(!isOpen, `Session ${CI_SESSION} should not be running after close`);
    });
  }
}

module.exports = { run };
