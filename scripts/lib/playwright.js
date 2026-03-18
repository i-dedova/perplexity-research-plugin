/**
 * playwright.js - Playwright CLI wrapper for Perplexity Research Plugin
 *
 * Handles:
 * - Playwright CLI installation check
 * - Running CLI commands
 * - Session start/stop/list
 *
 * Compatible with playwright-cli 0.1.x (session API: list, close, open --persistent)
 */

const { execSync, spawn } = require('child_process');
const { isWindows } = require('./platform');
const { getBrowser } = require('./config');

//region Constants

const CLI_TIMEOUT = 8000;  // Default timeout for CLI commands

//endregion

//region CLI Check

/**
 * Check if playwright-cli is installed
 * @returns {{ installed: boolean, version: string|null }}
 */
function checkPlaywrightCli() {
  try {
    const result = execSync('playwright-cli --version', {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return { installed: true, version: result.trim() };
  } catch {
    return { installed: false, version: null };
  }
}

//endregion

//region CLI Execution

/**
 * Run a playwright-cli command
 * @param {string} args - Command arguments
 * @param {object} options - Options
 * @param {number} [options.timeout] - Timeout in ms
 * @returns {string} - Command output
 */
function runCli(args, options = {}) {
  const timeout = options.timeout || CLI_TIMEOUT;
  try {
    const result = execSync(`playwright-cli ${args}`, {
      encoding: 'utf8',
      timeout,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return result;
  } catch (error) {
    if (error.killed) {
      throw new Error(`CLI command timed out after ${timeout}ms: playwright-cli ${args}`);
    }
    throw error;
  }
}

/**
 * Run code in a session (simple version - escapes quotes)
 * Uses PLAYWRIGHT_CLI_SESSION env var for session targeting
 * @param {number|string} sessionId - Session ID
 * @param {string} code - JavaScript code to run
 * @param {number} [timeout] - Timeout in ms
 * @returns {string|null} - Result or null on error
 */
function runCode(sessionId, code, timeout = CLI_TIMEOUT) {
  try {
    const result = execSync(
      `playwright-cli run-code "${code.replace(/"/g, '\\"')}"`,
      {
        encoding: 'utf8',
        timeout,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PLAYWRIGHT_CLI_SESSION: `perplexity-${sessionId}` }
      }
    );
    return result;
  } catch {
    return null;
  }
}

//endregion

//region Session Management

/**
 * Start a session in the background with persistent profile.
 * Always uses --persistent --headed (Perplexity blocks headless via Cloudflare).
 * @param {number|string} sessionId - Session ID (0-9)
 * @param {string} [browser] - Browser name (defaults to config)
 */
function startSession(sessionId, browser) {
  const browserName = browser || getBrowser();
  const sessionName = `perplexity-${sessionId}`;
  const sessionEnv = { ...process.env, PLAYWRIGHT_CLI_SESSION: sessionName };

  // Windows: use COMSPEC (full path to cmd.exe) — 'cmd' alone fails with ENOENT in some shells
  const cmd = isWindows() ? (process.env.COMSPEC || 'cmd.exe') : null;

  // 0.1.x: 'open' works for both new and existing sessions
  // --persistent saves profile to disk (required for session cloning)
  // --headed required (Perplexity blocks headless via Cloudflare)
  const cliArgs = ['open', 'https://perplexity.ai',
    '--persistent', '--headed', '--browser', browserName];

  let child;
  if (cmd) {
    child = spawn(cmd, ['/c', 'playwright-cli', ...cliArgs],
      { detached: true, stdio: 'ignore', windowsHide: true, env: sessionEnv });
  } else {
    child = spawn('playwright-cli', cliArgs,
      { detached: true, stdio: 'ignore', env: sessionEnv });
  }

  // Prevent unhandled error from crashing the process
  child.on('error', () => {});
  child.unref();
}

/**
 * Stop a session
 * @param {number|string} sessionId - Session ID
 */
function stopSession(sessionId) {
  try {
    execSync(`playwright-cli close`, {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PLAYWRIGHT_CLI_SESSION: `perplexity-${sessionId}` }
    });
  } catch {
    // Ignore - session may already be closed
  }
}

/**
 * Check if a session is running
 * @param {number|string} sessionId - Session ID
 * @returns {boolean}
 */
function isSessionRunning(sessionId) {
  try {
    const result = execSync('playwright-cli list', {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    // 0.1.x format: "- perplexity-0:\n  - status: open"
    const sessionPattern = new RegExp(`- perplexity-${sessionId}:[\\s\\S]*?status:\\s*open`);
    return sessionPattern.test(result);
  } catch {
    return false;
  }
}

/**
 * Verify a session is running, throw if not
 * @param {number|string} sessionId - Session ID
 */
function verifySessionRunning(sessionId) {
  if (!isSessionRunning(sessionId)) {
    throw new Error(`Session perplexity-${sessionId} is not running. Run 'ppx-research init-pool --count 1' first.`);
  }
}

/**
 * Press a key in a session
 * Uses PLAYWRIGHT_CLI_SESSION env var for session targeting
 * @param {number|string} sessionId - Session ID
 * @param {string} key - Key to press
 */
function pressKey(sessionId, key) {
  try {
    execSync(`playwright-cli press ${key}`, {
      encoding: 'utf8',
      timeout: CLI_TIMEOUT,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PLAYWRIGHT_CLI_SESSION: `perplexity-${sessionId}` }
    });
  } catch {
    // Ignore press errors
  }
}

//endregion

module.exports = {
  CLI_TIMEOUT,
  checkPlaywrightCli,
  runCli,
  runCode,
  startSession,
  stopSession,
  isSessionRunning,
  verifySessionRunning,
  pressKey
};
