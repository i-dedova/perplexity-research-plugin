/**
 * session-state.js - Runtime session state for research sessions
 *
 * Manages the in-progress state of research sessions:
 * - Current research mode (search/deep)
 * - Topic slug for file naming
 */

const { existsSync, readFileSync, writeFileSync, unlinkSync } = require('fs');
const { join } = require('path');
const { PATHS } = require('./config');

/**
 * Get path to session state file
 * @param {number|string} sessionId
 * @returns {string}
 */
function getSessionStateFile(sessionId) {
  return join(PATHS.downloadsDir, `.session-state-${sessionId}.json`);
}

/**
 * Save session state (mode, topic slug, strategy, model, thinking)
 * @param {number|string} sessionId
 * @param {string} mode - 'search' or 'deep'
 * @param {string} topicSlug - Topic identifier for file naming
 * @param {string} [strategy] - 'single' or 'parallel' (research execution strategy)
 * @param {string} [model] - Model slug used for this session
 * @param {string} [thinking] - Thinking mode: 'true', 'false', or undefined
 */
function saveSessionState(sessionId, mode, topicSlug, strategy, model, thinking) {
  const stateFile = getSessionStateFile(sessionId);
  const state = { mode, topicSlug };
  if (strategy) state.strategy = strategy;
  if (model) state.model = model;
  if (thinking != null) state.thinking = thinking;
  writeFileSync(stateFile, JSON.stringify(state), 'utf8');
}

/**
 * Get session state
 * @param {number|string} sessionId
 * @returns {{ mode: string, topicSlug: string }}
 * @throws {Error} If no state exists
 */
function getSessionState(sessionId) {
  const stateFile = getSessionStateFile(sessionId);
  if (!existsSync(stateFile)) {
    throw new Error(`No session state found for session ${sessionId}. Run 'start' first.`);
  }
  return JSON.parse(readFileSync(stateFile, 'utf8'));
}

/**
 * Check if session has state
 * @param {number|string} sessionId
 * @returns {boolean}
 */
function hasSessionState(sessionId) {
  return existsSync(getSessionStateFile(sessionId));
}

/**
 * Clear session state
 * @param {number|string} sessionId
 */
function clearSessionState(sessionId) {
  const stateFile = getSessionStateFile(sessionId);
  if (existsSync(stateFile)) {
    unlinkSync(stateFile);
  }
}

module.exports = {
  getSessionStateFile,
  saveSessionState,
  getSessionState,
  hasSessionState,
  clearSessionState
};
