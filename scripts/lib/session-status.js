/**
 * session-status.js - Session status tracking for Perplexity Research Plugin
 *
 * Handles:
 * - Reading/writing session-status.json
 * - Session expiry checking
 * - Finding valid donor sessions
 * - Session pool checking
 */

const { existsSync, readFileSync, cpSync } = require('fs');
const { join } = require('path');
const { PATHS, DEFAULTS, getBrowser, ensureConfigDir } = require('./config');
const { getPlaywrightSessionDir } = require('./platform');
const { atomicWriteJson, withLockedFile } = require('./file-lock');

//region Session Status File

/**
 * Get session status from tracking file
 * @returns {{ sessions: Object, lastFullScan: string|null }}
 */
function getSessionStatus() {
  if (!existsSync(PATHS.sessionStatusFile)) {
    return { sessions: {}, lastFullScan: null };
  }
  try {
    return JSON.parse(readFileSync(PATHS.sessionStatusFile, 'utf8'));
  } catch {
    return { sessions: {}, lastFullScan: null };
  }
}

/**
 * Save session status to tracking file (atomic write, no lock)
 * @param {object} status
 */
function saveSessionStatus(status) {
  ensureConfigDir();
  atomicWriteJson(PATHS.sessionStatusFile, status);
}

/**
 * Update a single session's status (locked read-modify-write)
 * @param {number|string} sessionId
 * @param {object} info - { expires, isPro, lastChecked }
 */
function updateSessionStatus(sessionId, info) {
  let result;
  withLockedFile(PATHS.sessionStatusFile, (status) => {
    status.sessions = status.sessions || {};
    status.sessions[sessionId] = {
      ...info,
      lastChecked: info.lastChecked || new Date().toISOString()
    };
    result = status;
  });
  return result;
}

//endregion

//region Expiry Checking

/**
 * Check if a session is expired (with buffer)
 * @param {string} expiresIso - ISO date string
 * @returns {boolean}
 */
function isSessionExpired(expiresIso) {
  if (!expiresIso) return true;
  const expiryDate = new Date(expiresIso);
  const bufferMs = DEFAULTS.sessionExpiryBufferHours * 60 * 60 * 1000;
  return expiryDate.getTime() - bufferMs < Date.now();
}

/**
 * Find a valid donor session (not expired)
 * @param {object} status - Session status object
 * @param {number|string} [excludeSession] - Session to exclude
 * @returns {string|null} - Session ID or null
 */
function findValidDonorSession(status, excludeSession = null) {
  const validSessions = [];

  for (const [sessionId, info] of Object.entries(status.sessions)) {
    if (sessionId === String(excludeSession)) continue;
    if (!isSessionExpired(info.expires)) {
      validSessions.push({ id: sessionId, expires: info.expires });
    }
  }

  // Sort by expiry date descending (freshest first)
  validSessions.sort((a, b) => new Date(b.expires) - new Date(a.expires));
  return validSessions.length > 0 ? validSessions[0].id : null;
}

//endregion

//region Session Pool

/**
 * Check session pool status
 * @param {string} [browser] - Browser name (defaults to config)
 * @returns {object} - Pool status
 */
function checkSessionPool(browser) {
  const sessionDir = getPlaywrightSessionDir();
  if (!sessionDir) {
    return {
      sessionDir: null,
      masterExists: false,
      poolCount: 0,
      poolSessions: [],
      missingSessions: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
      hasMinimum: false
    };
  }

  const browserName = browser || getBrowser();
  const masterName = `ud-perplexity-pro-${browserName}`;
  const masterPath = join(sessionDir, masterName);
  const masterExists = existsSync(masterPath);

  const poolSessions = [];
  const missingSessions = [];

  for (let i = 0; i < 10; i++) {
    const sessionName = `ud-perplexity-${i}-${browserName}`;
    const sessionPath = join(sessionDir, sessionName);
    if (existsSync(sessionPath)) {
      poolSessions.push(i);
    } else {
      missingSessions.push(i);
    }
  }

  return {
    sessionDir,
    masterExists,
    poolCount: poolSessions.length,
    poolSessions,
    missingSessions,
    hasMinimum: poolSessions.length >= 1
  };
}

/**
 * Get session directory path for a specific session
 * @param {number|string} sessionId
 * @param {string} [browser]
 * @returns {string|null}
 */
function getSessionPath(sessionId, browser) {
  const sessionDir = getPlaywrightSessionDir();
  if (!sessionDir) return null;

  const browserName = browser || getBrowser();
  return join(sessionDir, `ud-perplexity-${sessionId}-${browserName}`);
}

/**
 * Get master session path
 * @param {string} [browser]
 * @returns {string|null}
 */
function getMasterSessionPath(browser) {
  const sessionDir = getPlaywrightSessionDir();
  if (!sessionDir) return null;

  const browserName = browser || getBrowser();
  return join(sessionDir, `ud-perplexity-pro-${browserName}`);
}

//endregion

//region Session Refresh

/**
 * Refresh a session from a donor
 * @param {number|string} targetSessionId
 * @param {string} donorSessionId
 * @param {string} [browser]
 */
function copySessionFrom(targetSessionId, donorSessionId, browser) {
  const sessionDir = getPlaywrightSessionDir();
  if (!sessionDir) {
    throw new Error('Session directory not found');
  }

  const browserName = browser || getBrowser();
  const donorPath = join(sessionDir, `ud-perplexity-${donorSessionId}-${browserName}`);
  const targetPath = join(sessionDir, `ud-perplexity-${targetSessionId}-${browserName}`);

  if (!existsSync(donorPath)) {
    throw new Error(`Donor session ${donorSessionId} not found`);
  }

  // Remove old target if exists
  if (existsSync(targetPath)) {
    const { rmSync } = require('fs');
    rmSync(targetPath, { recursive: true, force: true });
  }

  // Copy donor to target
  cpSync(donorPath, targetPath, { recursive: true });

  // Update status (locked to prevent concurrent overwrites)
  withLockedFile(PATHS.sessionStatusFile, (status) => {
    status.sessions = status.sessions || {};
    if (status.sessions[donorSessionId]) {
      status.sessions[targetSessionId] = {
        ...status.sessions[donorSessionId],
        lastChecked: new Date().toISOString()
      };
    }
  });
}

/**
 * Refresh a session from master
 * @param {number|string} targetSessionId
 * @param {string} [browser]
 */
function copySessionFromMaster(targetSessionId, browser) {
  const sessionDir = getPlaywrightSessionDir();
  if (!sessionDir) {
    throw new Error('Session directory not found');
  }

  const browserName = browser || getBrowser();
  const masterPath = join(sessionDir, `ud-perplexity-pro-${browserName}`);
  const targetPath = join(sessionDir, `ud-perplexity-${targetSessionId}-${browserName}`);

  if (!existsSync(masterPath)) {
    throw new Error('Master session not found. Please re-login.');
  }

  // Remove old target if exists
  if (existsSync(targetPath)) {
    const { rmSync } = require('fs');
    rmSync(targetPath, { recursive: true, force: true });
  }

  // Copy master to target
  cpSync(masterPath, targetPath, { recursive: true });
}

//endregion

module.exports = {
  getSessionStatus,
  saveSessionStatus,
  updateSessionStatus,
  isSessionExpired,
  findValidDonorSession,
  checkSessionPool,
  getSessionPath,
  getMasterSessionPath,
  copySessionFrom,
  copySessionFromMaster
};
