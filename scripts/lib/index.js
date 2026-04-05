/**
 * Perplexity Research Plugin - Shared Library
 *
 * Re-exports all modules for convenient importing:
 *   const lib = require('./lib');
 *   lib.config.getBrowser();
 *   lib.playwright.startSession(0);
 */

const config = require('./config');
const platform = require('./platform');
const playwright = require('./playwright');
const sessionStatus = require('./session-status');
const sessionCookie = require('./session-cookie');
const sessionState = require('./session-state');
const cli = require('./cli');
const fileLock = require('./file-lock');
const logger = require('./logger');
const researchPrompts = require('./research-prompts');
const researchUi = require('./research-ui');

module.exports = {
  config,
  platform,
  playwright,
  sessionStatus,
  sessionCookie,
  sessionState,
  cli,
  fileLock,
  logger,
  researchPrompts,
  researchUi,

  // Convenience re-exports for common functions
  PATHS: config.PATHS,
  DEFAULTS: config.DEFAULTS,
  sleep: cli.sleep
};
