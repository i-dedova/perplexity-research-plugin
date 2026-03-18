/**
 * playwright.js - Playwright CLI wrapper for Perplexity Research Plugin
 *
 * Handles:
 * - Playwright CLI installation check
 * - Running CLI commands
 * - Session start/stop/list
 *
 * Compatible with playwright-cli 0.1.x (session API: list, close, open --persistent)
 *
 * All CLI calls use execFileSync(node, [cli.js, ...]) to avoid cmd.exe CMD window flash on Windows.
 */

const { execSync, execFileSync, spawn } = require('child_process');
const { existsSync } = require('fs');
const { join } = require('path');
const { isWindows } = require('./platform');
const { getBrowser } = require('./config');

//region Constants

const CLI_TIMEOUT = 8000;  // Default timeout for CLI commands

//endregion

//region CLI Path Resolution

/**
 * Resolve playwright-cli JS entry point path.
 * Uses node + JS file directly to avoid cmd.exe (prevents CMD window flash on Windows).
 * Cached after first resolution.
 * @returns {string|null}
 */
let _cliJsPath;
function getPlaywrightCliPath() {
  if (_cliJsPath !== undefined) return _cliJsPath;
  try {
    const npmRoot = execSync('npm root -g', {
      encoding: 'utf8', timeout: 5000, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
    const jsPath = join(npmRoot, '@playwright', 'cli', 'playwright-cli.js');
    _cliJsPath = existsSync(jsPath) ? jsPath : null;
  } catch {
    _cliJsPath = null;
  }
  return _cliJsPath;
}

/**
 * Run a playwright-cli command via node (no cmd.exe).
 * Falls back to execSync string command if JS path not resolved.
 */
function execCli(args, options = {}) {
  const timeout = options.timeout ?? CLI_TIMEOUT;
  const env = options.env ?? process.env;
  const jsPath = getPlaywrightCliPath();

  if (jsPath) {
    return execFileSync(process.execPath, [jsPath, ...args], {
      encoding: 'utf8', timeout, windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'], env
    });
  }
  // Fallback: string command (may flash on Windows)
  return execSync(`playwright-cli ${args.join(' ')}`, {
    encoding: 'utf8', timeout, windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'], env
  });
}

//endregion

//region CLI Check

/**
 * Check if playwright-cli is installed
 * @returns {{ installed: boolean, version: string|null }}
 */
function checkPlaywrightCli() {
  try {
    const result = execCli(['--version'], { timeout: 5000 });
    return { installed: true, version: result.trim() };
  } catch {
    return { installed: false, version: null };
  }
}

//endregion

//region CLI Execution

/**
 * Run a playwright-cli command
 * @param {string} args - Command arguments (space-separated string)
 * @param {object} options - Options
 * @param {number} [options.timeout] - Timeout in ms
 * @returns {string} - Command output
 */
function runCli(args, options = {}) {
  const timeout = options.timeout || CLI_TIMEOUT;
  try {
    return execCli(args.split(' '), { timeout });
  } catch (error) {
    if (error.killed) {
      throw new Error(`CLI command timed out after ${timeout}ms: playwright-cli ${args}`);
    }
    throw error;
  }
}

/**
 * Run code in a session
 * Uses PLAYWRIGHT_CLI_SESSION env var for session targeting
 * @param {number|string} sessionId - Session ID
 * @param {string} code - JavaScript code to run
 * @param {number} [timeout] - Timeout in ms
 * @returns {string|null} - Result or null on error
 */
function runCode(sessionId, code, timeout = CLI_TIMEOUT) {
  try {
    const env = { ...process.env, PLAYWRIGHT_CLI_SESSION: `perplexity-${sessionId}` };
    return execCli(['run-code', code], { timeout, env });
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

  const cliArgs = ['open', 'https://perplexity.ai',
    '--persistent', '--headed', '--browser', browserName];

  const jsPath = getPlaywrightCliPath();
  let child;
  if (jsPath) {
    child = spawn(process.execPath, [jsPath, ...cliArgs],
      { stdio: 'ignore', windowsHide: true, env: sessionEnv });
  } else {
    child = spawn('playwright-cli', cliArgs,
      { stdio: 'ignore', windowsHide: true, shell: true, env: sessionEnv });
  }

  child.on('error', () => {});
  child.unref();
}

/**
 * Stop a session
 * @param {number|string} sessionId - Session ID
 */
function stopSession(sessionId) {
  try {
    const env = { ...process.env, PLAYWRIGHT_CLI_SESSION: `perplexity-${sessionId}` };
    execCli(['close'], { timeout: 5000, env });
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
    const result = execCli(['list'], { timeout: 5000 });
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
    throw new Error(`Session perplexity-${sessionId} is not running.`);
  }
}

/**
 * Press a key in a session
 * @param {number|string} sessionId - Session ID
 * @param {string} key - Key to press
 */
function pressKey(sessionId, key) {
  try {
    const env = { ...process.env, PLAYWRIGHT_CLI_SESSION: `perplexity-${sessionId}` };
    execCli(['press', key], { timeout: CLI_TIMEOUT, env });
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
