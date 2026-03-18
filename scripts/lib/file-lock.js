/**
 * file-lock.js - File locking and atomic write for concurrent safety
 *
 * Prevents data loss when parallel research agents write to the same
 * JSON files (session-status.json, tracked-dirs.json) concurrently.
 *
 * Lock mechanism: exclusive-create .lock file with retry + stale detection.
 * Atomic write: write to .tmp then rename (atomic on same filesystem).
 */

const { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync, statSync, mkdirSync } = require('fs');
const { dirname } = require('path');

//region Constants

const LOCK_RETRY_ATTEMPTS = 15;
const LOCK_RETRY_DELAY_MS = 200;
const LOCK_STALE_THRESHOLD_MS = 30000;

//endregion

//region Lock Primitives

/**
 * Synchronous sleep using Atomics.wait
 * @param {number} ms
 */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Acquire an exclusive lock on a file path
 * @param {string} filePath - The file to lock (lock file will be filePath + '.lock')
 * @throws {Error} if lock cannot be acquired after all retries
 */
function acquireLock(filePath) {
  const lockPath = filePath + '.lock';

  // Ensure parent directory exists
  const dir = dirname(lockPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  for (let attempt = 0; attempt < LOCK_RETRY_ATTEMPTS; attempt++) {
    try {
      // Exclusive create — fails if file already exists
      writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
      return; // Lock acquired
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;

      // Lock file exists — check if stale
      try {
        const stat = statSync(lockPath);
        const ageMs = Date.now() - stat.mtimeMs;
        if (ageMs > LOCK_STALE_THRESHOLD_MS) {
          // Stale lock — remove and retry immediately
          try { unlinkSync(lockPath); } catch {}
          continue;
        }
      } catch {
        // Lock file disappeared between check and stat — retry
        continue;
      }

      // Lock is held by active process — wait and retry
      if (attempt < LOCK_RETRY_ATTEMPTS - 1) {
        sleepSync(LOCK_RETRY_DELAY_MS);
      }
    }
  }

  throw new Error(`Could not acquire lock on ${filePath} after ${LOCK_RETRY_ATTEMPTS} attempts`);
}

/**
 * Release the lock on a file path
 * @param {string} filePath - The file to unlock
 */
function releaseLock(filePath) {
  const lockPath = filePath + '.lock';
  try { unlinkSync(lockPath); } catch {}
}

//endregion

//region Atomic Write

/**
 * Write JSON data atomically (write to .tmp, then rename)
 * @param {string} filePath - Target file path
 * @param {object} data - JSON-serializable data
 */
function atomicWriteJson(filePath, data) {
  const tmpPath = filePath + '.tmp';
  try {
    writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
    renameSync(tmpPath, filePath);
  } catch (err) {
    // Clean up temp file on error
    try { unlinkSync(tmpPath); } catch {}
    throw err;
  }
}

//endregion

//region Locked File Operations

/**
 * Read a JSON file, returning default if missing or corrupt
 * @param {string} filePath
 * @returns {object}
 */
function readJsonSafe(filePath) {
  if (!existsSync(filePath)) return {};
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Lock a file, read its JSON content, call updateFn to mutate, then atomic-write back.
 *
 * @param {string} filePath - JSON file to lock and update
 * @param {(data: object) => void} updateFn - Mutates data in place
 */
function withLockedFile(filePath, updateFn) {
  acquireLock(filePath);
  try {
    const data = readJsonSafe(filePath);
    updateFn(data);
    atomicWriteJson(filePath, data);
  } finally {
    releaseLock(filePath);
  }
}

//endregion

module.exports = {
  acquireLock,
  releaseLock,
  atomicWriteJson,
  withLockedFile
};
