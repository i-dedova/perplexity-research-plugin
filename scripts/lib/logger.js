/**
 * logger.js - File-based logging for Perplexity Research Plugin
 *
 * Appends log lines to files in ~/.claude/perplexity/logs/
 * Log naming: hook-{date}.log, research-{sessionId}-{date}.log, cleanup-{date}.log
 */

const { appendFileSync, mkdirSync, existsSync } = require('fs');
const { join } = require('path');
const { PATHS } = require('./config');

const LOGS_DIR = join(PATHS.configDir, 'logs');

function ensureLogsDir() {
  if (!existsSync(LOGS_DIR)) mkdirSync(LOGS_DIR, { recursive: true });
}

function create(name) {
  const silent = process.env.PERPLEXITY_TEST === '1';
  if (!silent) ensureLogsDir();
  const logFile = join(LOGS_DIR, `${name}.log`);

  function write(level, msg) {
    if (silent) return;
    const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
    appendFileSync(logFile, `[${ts}] ${level} ${msg}\n`);
  }

  return {
    info: (msg) => write('INFO', msg),
    warn: (msg) => write('WARN', msg),
    error: (msg) => write('ERROR', msg),
    file: logFile
  };
}

module.exports = { create, LOGS_DIR };
