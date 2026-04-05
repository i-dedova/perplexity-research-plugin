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
 * Cross-platform: all CLI calls use execFileSync(node, [cli.js, ...]) to avoid
 * cmd.exe CMD window flash on Windows. Path resolution probes common locations
 * for nvm/Homebrew/fnm/volta compatibility on macOS/Linux.
 */

const { execSync, execFileSync, spawn } = require('child_process');
const { existsSync } = require('fs');
const { join } = require('path');
const { homedir } = require('os');
const { isWindows, getPlatform } = require('./platform');
const { getBrowser } = require('./config');

//region Constants

const CLI_TIMEOUT = 8000;  // Default timeout for CLI commands

//endregion

//region CLI Path Resolution

/**
 * Resolve playwright-cli JS entry point path.
 * Uses node + JS file directly to avoid cmd.exe (prevents CMD window flash on Windows).
 *
 * Resolution order:
 * 1. `npm root -g` (works for standard installs)
 * 2. Platform-specific common paths (handles nvm, Homebrew, fnm, volta)
 *
 * Cached after first resolution.
 * @returns {string|null}
 */
let _cliJsPath;
function getPlaywrightCliPath() {
  if (_cliJsPath !== undefined) return _cliJsPath;

  const cliRelPath = join('@playwright', 'cli', 'playwright-cli.js');

  // Strategy 1: npm root -g
  try {
    const npmRoot = execSync('npm root -g', {
      encoding: 'utf8', timeout: 5000, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
    const jsPath = join(npmRoot, cliRelPath);
    if (existsSync(jsPath)) {
      _cliJsPath = jsPath;
      return _cliJsPath;
    }
  } catch {
    // npm not on PATH (common with nvm in non-interactive shells)
  }

  // Strategy 2: probe common locations
  const home = homedir();
  const probePaths = [];

  if (isWindows()) {
    // Windows: npm global is in APPDATA
    const appData = process.env.APPDATA || join(home, 'AppData', 'Roaming');
    probePaths.push(join(appData, 'npm', 'node_modules'));
  } else {
    const platform = getPlatform();
    // Shared Unix paths
    probePaths.push(
      '/usr/local/lib/node_modules',
      '/usr/lib/node_modules'
    );

    if (platform === 'macos') {
      // Homebrew ARM (Apple Silicon) and Intel
      probePaths.push(
        '/opt/homebrew/lib/node_modules',
        '/usr/local/lib/node_modules'  // already added but harmless
      );
    }

    // nvm — find active version's node_modules
    const nvmDir = process.env.NVM_DIR || join(home, '.nvm');
    try {
      // Read .nvm/alias/default to find the default version
      const defaultAlias = require('fs').readFileSync(
        join(nvmDir, 'alias', 'default'), 'utf8'
      ).trim();
      // Could be a version like "22" or "lts/jod" — find matching dir
      const versionsDir = join(nvmDir, 'versions', 'node');
      if (existsSync(versionsDir)) {
        const versions = require('fs').readdirSync(versionsDir)
          .filter(v => v.startsWith('v'))
          .sort((a, b) => {
            // Strip 'v' prefix for consistent numeric comparison (v22.1.0 vs v20.10.0)
            const av = a.replace(/^v/, ''), bv = b.replace(/^v/, '');
            return bv.localeCompare(av, undefined, { numeric: true });
          });
        // Match alias: "22" matches "v22.x.x", "lts/jod" → just use latest
        const match = versions.find(v => v.includes(defaultAlias)) || versions[0];
        if (match) {
          probePaths.push(join(versionsDir, match, 'lib', 'node_modules'));
        }
      }
    } catch {
      // No nvm or no default alias — try finding any nvm node version
      const nvmVersionsDir = join(nvmDir, 'versions', 'node');
      if (existsSync(nvmVersionsDir)) {
        try {
          const versions = require('fs').readdirSync(nvmVersionsDir)
            .filter(v => v.startsWith('v'))
            .sort((a, b) => {
            // Strip 'v' prefix for consistent numeric comparison (v22.1.0 vs v20.10.0)
            const av = a.replace(/^v/, ''), bv = b.replace(/^v/, '');
            return bv.localeCompare(av, undefined, { numeric: true });
          });
          if (versions[0]) {
            probePaths.push(join(nvmVersionsDir, versions[0], 'lib', 'node_modules'));
          }
        } catch {}
      }
    }

    // fnm
    const fnmDir = process.env.FNM_MULTISHELL_PATH;
    if (fnmDir) {
      probePaths.push(join(fnmDir, 'lib', 'node_modules'));
    }

    // volta
    const voltaHome = process.env.VOLTA_HOME || join(home, '.volta');
    if (existsSync(join(voltaHome, 'bin'))) {
      probePaths.push(join(voltaHome, 'tools', 'image', 'node'));
      // Volta shims — try to find the actual node_modules
      try {
        const nodeVersions = require('fs').readdirSync(join(voltaHome, 'tools', 'image', 'node'))
          .sort((a, b) => {
            // Strip 'v' prefix for consistent numeric comparison (v22.1.0 vs v20.10.0)
            const av = a.replace(/^v/, ''), bv = b.replace(/^v/, '');
            return bv.localeCompare(av, undefined, { numeric: true });
          });
        if (nodeVersions[0]) {
          probePaths.push(join(voltaHome, 'tools', 'image', 'node', nodeVersions[0], 'lib', 'node_modules'));
        }
      } catch {}
    }
  }

  for (const dir of probePaths) {
    const jsPath = join(dir, cliRelPath);
    if (existsSync(jsPath)) {
      _cliJsPath = jsPath;
      return _cliJsPath;
    }
  }

  _cliJsPath = null;
  return _cliJsPath;
}

/**
 * Run a playwright-cli command via node (no cmd.exe).
 * Falls back to execFileSync with 'playwright-cli' if JS path not resolved.
 * Uses -s= flag for session targeting (works in 0.1.1+ and 0.1.5+, unlike env var).
 * @param {string[]} args - CLI arguments
 * @param {object} [options]
 * @param {number} [options.timeout] - Timeout in ms
 * @param {string} [options.session] - Session name (prepended as -s=<name>)
 */
function execCli(args, options = {}) {
  const timeout = options.timeout ?? CLI_TIMEOUT;
  const sessionArgs = options.session ? [`-s=${options.session}`] : [];
  const fullArgs = [...sessionArgs, ...args];
  const jsPath = getPlaywrightCliPath();

  if (jsPath) {
    return execFileSync(process.execPath, [jsPath, ...fullArgs], {
      encoding: 'utf8', timeout, windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
  }
  // Fallback: try playwright-cli directly via execFileSync
  // On Windows, .cmd files need shell — last resort
  if (isWindows()) {
    return execFileSync(process.env.COMSPEC || 'cmd.exe',
      ['/c', 'playwright-cli', ...fullArgs], {
        encoding: 'utf8', timeout, windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });
  }
  return execFileSync('playwright-cli', fullArgs, {
    encoding: 'utf8', timeout, windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe']
  });
}

//endregion

//region CLI Check

/**
 * Check if playwright-cli is installed.
 * Returns both the CLI's reported version (Playwright library version)
 * and the npm package version (from package.json, for compatibility checks).
 * @returns {{ installed: boolean, version: string|null, packageVersion: string|null }}
 */
function checkPlaywrightCli() {
  try {
    const result = execCli(['--version'], { timeout: 5000 });
    // Read npm package version from package.json (next to the CLI entry point)
    let packageVersion = null;
    const cliPath = getPlaywrightCliPath();
    if (cliPath) {
      try {
        const pkgPath = join(cliPath, '..', 'package.json');
        packageVersion = JSON.parse(require('fs').readFileSync(pkgPath, 'utf8')).version;
      } catch { /* package.json not found or unreadable */ }
    }
    return { installed: true, version: result.trim(), packageVersion };
  } catch {
    return { installed: false, version: null, packageVersion: null };
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
 * @param {number|string} sessionId - Session ID
 * @param {string} code - JavaScript code to run
 * @param {number} [timeout] - Timeout in ms
 * @returns {string|null} - Result or null on error
 */
function runCode(sessionId, code, timeout = CLI_TIMEOUT) {
  try {
    return execCli(['run-code', code], { timeout, session: `perplexity-${sessionId}` });
  } catch {
    return null;
  }
}

//endregion

//region Session Management

/**
 * Start a session in the background with persistent profile.
 * Always uses --persistent --headed (Perplexity blocks headless via Cloudflare).
 *
 * Platform-specific spawn behavior:
 * - Windows: no detached (detached overrides windowsHide, causes CMD flash)
 * - macOS/Linux: detached: true (prevents SIGHUP killing browser on parent exit)
 *
 * @param {number|string} sessionId - Session ID (0-9)
 * @param {string} [browser] - Browser name (defaults to config)
 */
function startSession(sessionId, browser) {
  const browserName = browser || getBrowser();
  const sessionName = `perplexity-${sessionId}`;

  // Use -s= flag (not env var) — works in both 0.1.1 and 0.1.5+
  const cliArgs = [`-s=${sessionName}`, 'open', 'https://perplexity.ai',
    '--persistent', '--headed', '--browser', browserName];

  const jsPath = getPlaywrightCliPath();
  const useDetached = !isWindows();

  // stdio must be 'pipe' (not 'ignore') — CLI 0.1.5+ needs pipe for daemon handshake.
  // Pipes are destroyed after unref to prevent the parent from waiting on them.
  let child;
  if (jsPath) {
    child = spawn(process.execPath, [jsPath, ...cliArgs], {
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: useDetached
    });
  } else {
    if (isWindows()) {
      child = spawn(process.env.COMSPEC || 'cmd.exe',
        ['/c', 'playwright-cli', ...cliArgs], {
          stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true
        });
    } else {
      child = spawn('playwright-cli', cliArgs, {
        stdio: ['pipe', 'pipe', 'pipe'], detached: true
      });
    }
  }

  child.on('error', () => {});
  // Drain and destroy pipes so parent doesn't wait on them
  if (child.stdout) child.stdout.on('data', () => {});
  if (child.stderr) child.stderr.on('data', () => {});
  child.unref();
}

/**
 * Stop a session
 * @param {number|string} sessionId - Session ID
 */
function stopSession(sessionId) {
  try {
    execCli(['close'], { timeout: 5000, session: `perplexity-${sessionId}` });
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
    execCli(['press', key], { timeout: CLI_TIMEOUT, session: `perplexity-${sessionId}` });
  } catch {
    // Ignore press errors
  }
}

//endregion

//region Tab Management

/**
 * Select a tab by index.
 * Critical for multi-tab safety: run-code always targets the active tab,
 * so phantom tabs (opened by the browser itself) can hijack all commands.
 * @param {number|string} sessionId - Session ID
 * @param {number} index - Tab index (0 = first/main tab)
 */
function tabSelect(sessionId, index) {
  try {
    execCli(['tab-select', String(index)], { timeout: CLI_TIMEOUT, session: `perplexity-${sessionId}` });
  } catch {
    // Non-fatal: tab may not exist or session closed
  }
}

/**
 * Close a tab by index (closes current tab if index omitted)
 * @param {number|string} sessionId - Session ID
 * @param {number} [index] - Tab index to close
 */
function tabClose(sessionId, index) {
  try {
    const args = index !== undefined ? ['tab-close', String(index)] : ['tab-close'];
    execCli(args, { timeout: CLI_TIMEOUT, session: `perplexity-${sessionId}` });
  } catch {
    // Non-fatal: tab may already be closed
  }
}

/**
 * Get tab count via run-code (browser-agnostic: works on Edge, Chrome, etc.)
 * @param {number|string} sessionId - Session ID
 * @returns {number} Tab count, or -1 on error
 */
function getTabCount(sessionId) {
  const result = runCode(sessionId, 'async page => page.context().pages().length');
  if (!result) return -1;
  const match = result.match(/### Result\s*\n(\d+)/);
  return match ? parseInt(match[1], 10) : -1;
}

//endregion

module.exports = {
  CLI_TIMEOUT,
  getPlaywrightCliPath,
  checkPlaywrightCli,
  runCli,
  runCode,
  startSession,
  stopSession,
  isSessionRunning,
  verifySessionRunning,
  pressKey,
  tabSelect,
  tabClose,
  getTabCount
};
