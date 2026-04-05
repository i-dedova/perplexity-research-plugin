/**
 * session-cookie.js - Session cookie validation and refresh
 *
 * Handles:
 * - Checking session login status via Pro logo
 * - Reading cookie expiry
 * - Refreshing expired sessions from donors
 */

const { existsSync } = require('fs');
const { getBrowser, PATHS } = require('./config');
const { minimizeWindows, clearSessionRestore } = require('./platform');
const { runCode, startSession, stopSession, isSessionRunning, tabSelect, tabClose, getTabCount } = require('./playwright');
const {
  getSessionStatus,
  saveSessionStatus,
  isSessionExpired,
  findValidDonorSession,
  getMasterSessionPath,
  getSessionPath,
  copySessionFrom,
  copySessionFromMaster
} = require('./session-status');
const { withLockedFile } = require('./file-lock');
const { sleep } = require('./cli');

/**
 * Check session cookie validity by opening browser and inspecting
 * @param {number|string} sessionId
 * @param {string} [browser]
 * @param {object} [options]
 * @param {boolean} [options.keepOpen] - Keep session running after check
 * @returns {Promise<object>}
 */
async function checkSessionCookie(sessionId, browser, options = {}) {
  const browserName = browser || getBrowser();
  const keepOpen = options.keepOpen || false;
  const wasRunning = isSessionRunning(sessionId);

  // Track phantom tabs closed (used in return value)
  let phantomTabsClosed = 0;

  // Start session if not running
  if (!wasRunning) {
    // Clear session restore files BEFORE launch — prevents Edge/Chrome from
    // restoring previous tabs (ghost about:blank tabs). Cookies are untouched.
    const userDataDir = getSessionPath(sessionId, browserName);
    clearSessionRestore(userDataDir);

    startSession(sessionId, browserName);
    await sleep(6000);  // Wait for browser to start

    // Navigate to Perplexity (config doesn't auto-navigate for existing sessions)
    runCode(sessionId, 'async page => await page.goto("https://perplexity.ai", { waitUntil: "domcontentloaded", timeout: 15000 })', 20000);
    await sleep(1000);

    // Close any non-Perplexity tabs (Edge opens ntp.msn.com, Chrome opens new tab page).
    // Collect targets first, then close — avoids mutating the pages array during iteration.
    const closeResult = runCode(sessionId, `async page => {
      const pages = page.context().pages();
      const toClose = pages.filter(p => !p.url().includes('perplexity'));
      if (toClose.length >= pages.length) return 0;
      for (const p of toClose) await p.close();
      return toClose.length;
    }`.replace(/\n/g, ' '));
    if (closeResult) {
      const closedMatch = closeResult.match(/### Result\s*\n(\d+)/);
      if (closedMatch && parseInt(closedMatch[1], 10) > 0) {
        phantomTabsClosed = parseInt(closedMatch[1], 10);
      }
    }

    minimizeWindows('Perplexity');
  }

  // Poll for session cookie (page may still be setting cookies after navigation)
  let expires = null;
  let hasSessionCookie = false;
  const cookieCode = 'async page => { const cookies = await page.context().cookies(); const c = cookies.find(c => c.name === "__Secure-next-auth.session-token"); return c ? c.expires : null; }';

  for (let attempt = 0; attempt < 3; attempt++) {
    const cookieCheck = runCode(sessionId, cookieCode);
    if (cookieCheck) {
      const match = cookieCheck.match(/### Result\s*\n([\d.]+)/);
      if (match) {
        expires = new Date(Math.floor(parseFloat(match[1])) * 1000).toISOString();
        hasSessionCookie = true;
        break;
      }
    }
    if (attempt < 2) await sleep(2000);
  }

  // Check for Pro logo (optional - just for tracking)
  const proCheck = runCode(sessionId,
    'async page => await page.locator("use[href=\\"#pplx-logo-pro\\"]").count()'
  );
  const hasPro = proCheck && proCheck.includes('1');

  // Stop session if we started it AND keepOpen is false
  if (!wasRunning && !keepOpen) {
    stopSession(sessionId);
  }

  return {
    loggedIn: hasSessionCookie,  // Based on session cookie, not Pro status
    isPro: hasPro,
    expires,
    isExpired: isSessionExpired(expires),
    sessionStarted: !wasRunning,
    phantomTabsClosed
  };
}

/**
 * Refresh an expired session from a valid donor or master
 * @param {number|string} targetSessionId
 * @param {string} [browser]
 * @param {object} [options]
 * @param {function} [options.log] - Log callback (default: no-op). Callers pass console.log for terminal output.
 * @returns {Promise<object>}
 */
async function refreshSession(targetSessionId, browser, { log = () => {} } = {}) {
  const browserName = browser || getBrowser();
  const status = getSessionStatus();

  // Find valid donor
  const donorId = findValidDonorSession(status, targetSessionId);
  if (!donorId) {
    // Try master session
    const masterPath = getMasterSessionPath(browserName);
    if (!masterPath || !existsSync(masterPath)) {
      throw new Error('No valid donor sessions found. All sessions expired. Please re-login.');
    }

    log('Using master session (perplexity-pro) as donor');
    copySessionFromMaster(targetSessionId, browserName);
    return { refreshedFrom: 'master' };
  }

  log(`Refreshing session ${targetSessionId} from donor session ${donorId}...`);
  stopSession(targetSessionId);
  await sleep(500);

  copySessionFrom(targetSessionId, donorId, browserName);
  log(`Session ${targetSessionId} refreshed from session ${donorId}`);
  return { refreshedFrom: donorId };
}

/**
 * Ensure a session is valid, refreshing if needed
 * Leaves session running for agent to use
 * @param {number|string} sessionId
 * @param {string} [browser]
 * @param {object} [options]
 * @param {function} [options.log] - Log callback (default: no-op)
 * @returns {Promise<object>}
 */
async function ensureSessionValid(sessionId, browser, { log = () => {} } = {}) {
  const browserName = browser || getBrowser();

  // Always validate live
  const liveCheck = await checkSessionCookie(sessionId, browserName, { keepOpen: true });

  // Update tracking (locked)
  let status;
  withLockedFile(PATHS.sessionStatusFile, (s) => {
    s.sessions = s.sessions || {};
    s.sessions[sessionId] = {
      expires: liveCheck.expires,
      isPro: liveCheck.isPro,
      lastChecked: new Date().toISOString()
    };
    status = s;
  });

  // Valid - done
  if (liveCheck.loggedIn && !liveCheck.isExpired) {
    return { success: true, verified: true, sessionStarted: liveCheck.sessionStarted };
  }

  // Expired - try refresh
  stopSession(sessionId);

  const donorId = findValidDonorSession(status, sessionId);
  if (donorId !== null) {
    const refreshResult = await refreshSession(sessionId, browserName, { log });

    // Verify after refresh
    const verifyCheck = await checkSessionCookie(sessionId, browserName, { keepOpen: true });

    // Update tracking (locked)
    withLockedFile(PATHS.sessionStatusFile, (s) => {
      s.sessions = s.sessions || {};
      s.sessions[sessionId] = {
        expires: verifyCheck.expires,
        isPro: verifyCheck.isPro,
        lastChecked: new Date().toISOString()
      };
    });

    if (verifyCheck.loggedIn && !verifyCheck.isExpired) {
      return { success: true, refreshedFrom: refreshResult.refreshedFrom, sessionStarted: true };
    }

    stopSession(sessionId);
    return { success: false, error: 'Refresh failed - donor may be expired', needsRelogin: true };
  }

  return { success: false, error: 'No valid donors available', needsRelogin: true };
}

/**
 * Validate master session and save to status
 * @param {string} [browser]
 * @param {object} [options]
 * @param {function} [options.log] - Log callback (default: no-op)
 * @returns {Promise<object>}
 */
async function validateMasterSession(browser, { log = () => {} } = {}) {
  const browserName = browser || getBrowser();

  log('Validating master session (perplexity-pro)...');
  const check = await checkSessionCookie('pro', browserName, { keepOpen: false });

  withLockedFile(PATHS.sessionStatusFile, (s) => {
    s.sessions = s.sessions || {};
    s.sessions['pro'] = {
      expires: check.expires,
      isPro: check.isPro,
      lastChecked: new Date().toISOString(),
      isMaster: true
    };
  });

  if (check.loggedIn) {
    log(`✓ Master session valid (expires: ${check.expires})`);
  } else {
    log('✗ Master session NOT logged in');
  }

  return check;
}

/**
 * Validate each pool session individually and save to status
 * @param {string} [browser]
 * @param {number} [count] - Number of sessions to validate (default: 10)
 * @param {object} [options]
 * @param {function} [options.log] - Log callback (default: no-op)
 * @returns {Promise<object>}
 */
async function validatePoolSessions(browser, sessionIds, { log = () => {} } = {}) {
  const browserName = browser || getBrowser();
  // Accept array of IDs or a count (backward compat with cmdClonePool passing a number)
  const ids = Array.isArray(sessionIds)
    ? sessionIds
    : Array.from({ length: sessionIds ?? 10 }, (_, i) => i);
  const results = { valid: [], expired: [], notLoggedIn: [] };

  log(`\nValidating ${ids.length} pool sessions individually...`);

  for (const i of ids) {
    const check = await checkSessionCookie(i, browserName, { keepOpen: false });

    // Save each session's status individually (locked)
    withLockedFile(PATHS.sessionStatusFile, (s) => {
      s.sessions = s.sessions || {};
      s.sessions[i] = {
        expires: check.expires,
        isPro: check.isPro,
        lastChecked: new Date().toISOString()
      };
    });

    if (!check.loggedIn) {
      log(`  Session ${i}: NOT LOGGED IN`);
      results.notLoggedIn.push(i);
    } else if (check.isExpired) {
      log(`  Session ${i}: EXPIRED (${check.expires})`);
      results.expired.push(i);
    } else {
      log(`  Session ${i}: valid (expires: ${check.expires})`);
      results.valid.push(i);
    }
  }

  // Update lastFullScan (locked)
  withLockedFile(PATHS.sessionStatusFile, (s) => {
    s.lastFullScan = new Date().toISOString();
  });

  log(`\n=== Validation Summary ===`);
  log(`Valid: ${results.valid.length}`);
  log(`Expired: ${results.expired.length}`);
  log(`Not logged in: ${results.notLoggedIn.length}`);

  return results;
}

// ============================================================================
// Session Claims — prevents multiple agents from using the same session
// ============================================================================

const CLAIM_STALE_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Check if a session's claim is active (not stale)
 * @param {object} session - Session entry from session-status.json
 * @returns {boolean}
 */
function isClaimActive(session) {
  if (!session || !session.claim) return false;
  const age = Date.now() - new Date(session.claim.claimedAt).getTime();
  return age < CLAIM_STALE_MS;
}

/**
 * Claim a session for exclusive use. Returns true if claimed, false if occupied.
 * Uses withLockedFile for atomic read-modify-write.
 * @param {number|string} sessionId
 * @param {string} topicSlug
 * @returns {boolean}
 */
function claimSession(sessionId, topicSlug) {
  let claimed = false;
  withLockedFile(PATHS.sessionStatusFile, (s) => {
    s.sessions = s.sessions || {};
    const entry = s.sessions[sessionId] || {};

    if (isClaimActive(entry)) {
      // Already claimed by another agent
      claimed = false;
      return;
    }

    // Claim it (preserve existing cookie/status fields)
    entry.claim = {
      topicSlug: topicSlug || 'unknown',
      claimedAt: new Date().toISOString()
    };
    s.sessions[sessionId] = entry;
    claimed = true;
  });
  return claimed;
}

/**
 * Release a session claim.
 * @param {number|string} sessionId
 */
function releaseSession(sessionId) {
  withLockedFile(PATHS.sessionStatusFile, (s) => {
    s.sessions = s.sessions || {};
    if (s.sessions[sessionId]) {
      delete s.sessions[sessionId].claim;
    }
  });
}

/**
 * Find a free session. Tries the requested ID first, then scans 0-9.
 * Cleans stale claims during scan.
 * @param {number} requestedId - Preferred session number
 * @param {string} topicSlug - Topic slug for the claim
 * @returns {{ sessionId: number, reassigned: boolean }}
 */
function findFreeSession(requestedId, topicSlug) {
  let result = null;
  withLockedFile(PATHS.sessionStatusFile, (s) => {
    s.sessions = s.sessions || {};

    // Clean stale claims during scan
    for (let i = 0; i <= 9; i++) {
      const entry = s.sessions[i];
      if (entry && entry.claim && !isClaimActive(entry)) {
        delete entry.claim;
      }
    }

    // Try requested session first
    const requested = s.sessions[requestedId] || {};
    if (!isClaimActive(requested)) {
      requested.claim = { topicSlug: topicSlug || 'unknown', claimedAt: new Date().toISOString() };
      s.sessions[requestedId] = requested;
      result = { sessionId: requestedId, reassigned: false };
      return;
    }

    // Requested is occupied — find next free
    for (let i = 0; i <= 9; i++) {
      if (i === requestedId) continue;
      const entry = s.sessions[i] || {};
      if (!isClaimActive(entry)) {
        entry.claim = { topicSlug: topicSlug || 'unknown', claimedAt: new Date().toISOString() };
        s.sessions[i] = entry;
        result = { sessionId: i, reassigned: true };
        return;
      }
    }

    // All 10 sessions occupied (unlikely)
    result = null;
  });
  return result;
}

module.exports = {
  checkSessionCookie,
  refreshSession,
  ensureSessionValid,
  validateMasterSession,
  validatePoolSessions,
  claimSession,
  releaseSession,
  findFreeSession,
  isClaimActive,
  CLAIM_STALE_MS
};
