/**
 * config.js - Configuration management for Perplexity Research Plugin
 *
 * Handles:
 * - Config file paths
 * - Reading/writing config.local.md
 * - Browser and cleanup settings
 */

const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('fs');
const { join } = require('path');
const { homedir } = require('os');
const { atomicWriteJson, withLockedFile } = require('./file-lock');

//region Paths

const PATHS = {
  configDir: join(homedir(), '.claude', 'perplexity'),
  configFile: join(homedir(), '.claude', 'perplexity', 'config.local.md'),
  sessionStatusFile: join(homedir(), '.claude', 'perplexity', 'session-status.json'),
  trackedDirsFile: join(homedir(), '.claude', 'perplexity', 'tracked-dirs.json'),
  logsDir: join(homedir(), '.claude', 'perplexity', 'logs'),
  downloadsDir: join(process.cwd(), '.playwright-cli')
};

//endregion

//region Defaults

const DEFAULTS = {
  browser: process.platform === 'win32' ? 'msedge' : 'chrome',
  cleanupDays: 7,
  minCleanupDays: 1,
  maxCleanupDays: 30,
  logRetentionDays: 7,
  minLogRetentionDays: 1,
  maxLogRetentionDays: 30,
  sessionExpiryBufferHours: 1,
  defaultModel: 'dynamic',
  defaultThinking: 'dynamic',
  subscriptionTier: 'pro',
  outputDir: 'docs/research'
};

const VALID_MODELS = {
  'best': { display: 'Best', tier: 'free' },
  'sonar': { display: 'Sonar', tier: 'pro' },
  'gpt-5.4': { display: 'GPT-5.4', tier: 'pro' },
  'gemini-3.1-pro': { display: 'Gemini 3.1 Pro', tier: 'pro' },
  'claude-sonnet-4.6': { display: 'Claude Sonnet 4.6', tier: 'pro' },
  'nemotron-3-super': { display: 'Nemotron 3 Super', tier: 'pro' },
  'claude-opus-4.6': { display: 'Claude Opus 4.6', tier: 'max' }
};

const THINKING_TOGGLEABLE = ['gpt-5.4', 'claude-sonnet-4.6'];
const THINKING_ALWAYS_ON = ['gemini-3.1-pro', 'nemotron-3-super'];

//endregion

//region Config Reading

/**
 * Read full config from ~/.claude/perplexity/config.local.md
 * @returns {{ exists: boolean, browser: string|null, cleanupDays: number|null }}
 */
function getConfig() {
  const result = {
    exists: false,
    browser: null,
    cleanupDays: null,
    logRetentionDays: null,
    defaultModel: null,
    defaultThinking: null,
    subscriptionTier: null,
    outputDir: null,
    lastCleanup: null
  };

  if (!existsSync(PATHS.configFile)) {
    return result;
  }

  try {
    const content = readFileSync(PATHS.configFile, 'utf8');
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (match) {
      const yaml = match[1];

      // Parse browser
      const browserMatch = yaml.match(/browser:\s*(\S+)/);
      if (browserMatch) {
        const browser = browserMatch[1].toLowerCase();
        if (['msedge', 'chrome'].includes(browser)) {
          result.browser = browser;
          result.exists = true;
        }
      }

      // Parse cleanup_days
      const cleanupMatch = yaml.match(/cleanup_days:\s*(\S+)/);
      if (cleanupMatch) {
        const days = parseInt(cleanupMatch[1], 10);
        if (!isNaN(days) && days >= DEFAULTS.minCleanupDays && days <= DEFAULTS.maxCleanupDays) {
          result.cleanupDays = days;
        }
      }

      // Parse log_retention_days
      const logRetentionMatch = yaml.match(/log_retention_days:\s*(\S+)/);
      if (logRetentionMatch) {
        const days = parseInt(logRetentionMatch[1], 10);
        if (!isNaN(days) && days >= DEFAULTS.minLogRetentionDays && days <= DEFAULTS.maxLogRetentionDays) {
          result.logRetentionDays = days;
        }
      }

      // Parse default_model
      const modelMatch = yaml.match(/default_model:\s*(\S+)/);
      if (modelMatch) {
        const model = modelMatch[1].toLowerCase();
        if (model === 'dynamic' || model in VALID_MODELS) {
          result.defaultModel = model;
        }
      }

      // Parse default_thinking
      const thinkingMatch = yaml.match(/default_thinking:\s*(\S+)/);
      if (thinkingMatch) {
        const thinking = thinkingMatch[1].toLowerCase();
        if (['dynamic', 'true', 'false'].includes(thinking)) {
          result.defaultThinking = thinking;
        }
      }

      // Parse subscription_tier
      const tierMatch = yaml.match(/subscription_tier:\s*(\S+)/);
      if (tierMatch) {
        const tier = tierMatch[1].toLowerCase();
        if (['pro', 'max'].includes(tier)) {
          result.subscriptionTier = tier;
        }
      }

      // Parse output_dir
      const outputDirMatch = yaml.match(/output_dir:\s*(.+)/);
      if (outputDirMatch) {
        const dir = outputDirMatch[1].trim();
        if (dir && dir !== 'null') {
          result.outputDir = dir;
        }
      }

      // Parse last_cleanup
      const cleanupMatch2 = yaml.match(/last_cleanup:\s*(\S+)/);
      if (cleanupMatch2 && cleanupMatch2[1] !== 'null') {
        result.lastCleanup = cleanupMatch2[1];
      }
    }
  } catch {
    // Config read failed
  }

  return result;
}

/**
 * Get browser name, with fallback to default
 * @returns {string}
 */
function getBrowser() {
  const config = getConfig();
  return config.browser || DEFAULTS.browser;
}

/**
 * Get cleanup days, with fallback to default
 * @returns {number}
 */
function getCleanupDays() {
  const config = getConfig();
  return config.cleanupDays || DEFAULTS.cleanupDays;
}

/**
 * Get log retention days, with fallback to default
 * @returns {number}
 */
function getLogRetentionDays() {
  const config = getConfig();
  return config.logRetentionDays || DEFAULTS.logRetentionDays;
}

/**
 * Get default model setting
 * @returns {string} 'dynamic', 'best', or a model slug
 */
function getDefaultModel() {
  const config = getConfig();
  return config.defaultModel || DEFAULTS.defaultModel;
}

/**
 * Get default thinking setting
 * @returns {string} 'dynamic', 'true', or 'false'
 */
function getDefaultThinking() {
  const config = getConfig();
  return config.defaultThinking || DEFAULTS.defaultThinking;
}

/**
 * Get subscription tier
 * @returns {string} 'pro' or 'max'
 */
function getSubscriptionTier() {
  const config = getConfig();
  return config.subscriptionTier || DEFAULTS.subscriptionTier;
}

/**
 * Get output directory, with fallback to default
 * @returns {string}
 */
function getOutputDir() {
  const config = getConfig();
  return config.outputDir || DEFAULTS.outputDir;
}

/**
 * Get display name for a model slug
 * @param {string} slug
 * @returns {string|null}
 */
function getModelDisplayName(slug) {
  const model = VALID_MODELS[slug];
  return model ? model.display : null;
}

/**
 * Get models available for a subscription tier
 * @param {string} tier - 'free', 'pro', or 'max'
 * @returns {string[]} Array of model slugs
 */
function getModelsForTier(tier) {
  const tierOrder = { free: 0, pro: 1, max: 2 };
  const tierLevel = tierOrder[tier] ?? 0;
  return Object.entries(VALID_MODELS)
    .filter(([, info]) => (tierOrder[info.tier] ?? 0) <= tierLevel)
    .map(([slug]) => slug);
}

//endregion

//region Config Writing

/**
 * Ensure config directory exists
 */
function ensureConfigDir() {
  if (!existsSync(PATHS.configDir)) {
    mkdirSync(PATHS.configDir, { recursive: true });
  }
}

/**
 * Write full config file. All fields preserved — callers pass current config merged with changes.
 * @param {object} opts - Config options
 * @param {string} opts.browser
 * @param {number} opts.cleanupDays
 * @param {number} [opts.logRetentionDays]
 * @param {string} [opts.defaultModel]
 * @param {string} [opts.defaultThinking]
 * @param {string} [opts.subscriptionTier]
 * @param {string} [opts.lastCleanup] - ISO timestamp of last cleanup run
 */
function writeConfig(opts) {
  const { browser, cleanupDays, logRetentionDays, defaultModel, defaultThinking, subscriptionTier, outputDir, lastCleanup } = opts;

  ensureConfigDir();

  const logDays = logRetentionDays ?? DEFAULTS.logRetentionDays;
  const model = defaultModel ?? DEFAULTS.defaultModel;
  const thinking = defaultThinking ?? DEFAULTS.defaultThinking;
  const tier = subscriptionTier ?? DEFAULTS.subscriptionTier;
  const outDir = outputDir ?? 'null';
  const cleanup = lastCleanup ?? 'null';

  const content = `---
browser: ${browser}
cleanup_days: ${cleanupDays}
log_retention_days: ${logDays}
default_model: ${model}
default_thinking: ${thinking}
subscription_tier: ${tier}
output_dir: ${outDir}
last_cleanup: ${cleanup}
---

# Perplexity Research Configuration

Edit the YAML frontmatter above to change settings:

| Setting | Values | Description |
|---------|--------|-------------|
| browser | \`msedge\` or \`chrome\` | Browser for Playwright automation |
| cleanup_days | \`1\` to \`30\` | Days between automatic temp file cleanups |
| log_retention_days | \`1\` to \`30\` | Days to keep plugin log files |
| default_model | \`dynamic\`, \`best\`, or model slug | AI model for research queries |
| default_thinking | \`dynamic\`, \`true\`, \`false\` | Enable reasoning/thinking mode |
| subscription_tier | \`pro\` or \`max\` | Perplexity subscription level |
| output_dir | Folder path relative to project | Where research outputs are saved (e.g. \`docs/research\`) |

**Models:** best, sonar, gpt-5.4, gemini-3.1-pro, claude-sonnet-4.6, nemotron-3-super, claude-opus-4.6 (max tier)

**Temp files cleaned:** Playwright logs, page snapshots, response downloads.
Your final research output is never deleted.
`;

  writeFileSync(PATHS.configFile, content, 'utf8');
}

/**
 * Set browser preference (preserves other settings)
 * @param {string} browser - 'msedge' or 'chrome'
 */
function setBrowser(browser) {
  const validBrowsers = ['msedge', 'chrome'];
  const normalized = browser.toLowerCase();

  if (!validBrowsers.includes(normalized)) {
    throw new Error(`Invalid browser: ${browser}. Must be: ${validBrowsers.join(' or ')}`);
  }

  const current = getConfig();
  writeConfig({
    browser: normalized,
    cleanupDays: current.cleanupDays || DEFAULTS.cleanupDays,
    logRetentionDays: current.logRetentionDays || DEFAULTS.logRetentionDays,
    defaultModel: current.defaultModel,
    defaultThinking: current.defaultThinking,
    subscriptionTier: current.subscriptionTier,
    outputDir: current.outputDir,
    lastCleanup: current.lastCleanup
  });
  return { browser: normalized, configFile: PATHS.configFile };
}

/**
 * Set cleanup interval (preserves other settings)
 * @param {number|string} days
 */
function setCleanupDays(days) {
  const daysNum = parseInt(days, 10);

  if (isNaN(daysNum)) {
    throw new Error(`Invalid cleanup_days: ${days}. Must be a number.`);
  }
  if (daysNum < DEFAULTS.minCleanupDays || daysNum > DEFAULTS.maxCleanupDays) {
    throw new Error(`cleanup_days must be between ${DEFAULTS.minCleanupDays} and ${DEFAULTS.maxCleanupDays}.`);
  }

  const current = getConfig();
  writeConfig({
    browser: current.browser || DEFAULTS.browser,
    cleanupDays: daysNum,
    logRetentionDays: current.logRetentionDays || DEFAULTS.logRetentionDays,
    defaultModel: current.defaultModel,
    defaultThinking: current.defaultThinking,
    subscriptionTier: current.subscriptionTier,
    outputDir: current.outputDir,
    lastCleanup: current.lastCleanup
  });
  return { cleanupDays: daysNum, configFile: PATHS.configFile };
}

/**
 * Set log retention days (preserves other settings)
 * @param {number|string} days
 */
function setLogRetentionDays(days) {
  const daysNum = parseInt(days, 10);

  if (isNaN(daysNum)) {
    throw new Error(`Invalid log_retention_days: ${days}. Must be a number.`);
  }
  if (daysNum < DEFAULTS.minLogRetentionDays || daysNum > DEFAULTS.maxLogRetentionDays) {
    throw new Error(`log_retention_days must be between ${DEFAULTS.minLogRetentionDays} and ${DEFAULTS.maxLogRetentionDays}.`);
  }

  const current = getConfig();
  writeConfig({
    browser: current.browser || DEFAULTS.browser,
    cleanupDays: current.cleanupDays || DEFAULTS.cleanupDays,
    logRetentionDays: daysNum,
    defaultModel: current.defaultModel,
    defaultThinking: current.defaultThinking,
    subscriptionTier: current.subscriptionTier,
    outputDir: current.outputDir,
    lastCleanup: current.lastCleanup
  });
  return { logRetentionDays: daysNum, configFile: PATHS.configFile };
}

/**
 * Set default model (preserves other settings)
 * @param {string} model - 'dynamic', 'best', or a valid model slug
 */
function setDefaultModel(model) {
  const normalized = model.toLowerCase();
  if (normalized !== 'dynamic' && !(normalized in VALID_MODELS)) {
    const valid = ['dynamic', ...Object.keys(VALID_MODELS)].join(', ');
    throw new Error(`Invalid model: ${model}. Must be one of: ${valid}`);
  }

  const current = getConfig();
  writeConfig({
    browser: current.browser || DEFAULTS.browser,
    cleanupDays: current.cleanupDays || DEFAULTS.cleanupDays,
    logRetentionDays: current.logRetentionDays || DEFAULTS.logRetentionDays,
    defaultModel: normalized,
    defaultThinking: current.defaultThinking,
    subscriptionTier: current.subscriptionTier,
    outputDir: current.outputDir,
    lastCleanup: current.lastCleanup
  });
  return { defaultModel: normalized, configFile: PATHS.configFile };
}

/**
 * Set default thinking mode (preserves other settings)
 * @param {string} thinking - 'dynamic', 'true', or 'false'
 */
function setDefaultThinking(thinking) {
  const normalized = thinking.toLowerCase();
  if (!['dynamic', 'true', 'false'].includes(normalized)) {
    throw new Error(`Invalid thinking: ${thinking}. Must be: dynamic, true, or false`);
  }

  const current = getConfig();
  writeConfig({
    browser: current.browser || DEFAULTS.browser,
    cleanupDays: current.cleanupDays || DEFAULTS.cleanupDays,
    logRetentionDays: current.logRetentionDays || DEFAULTS.logRetentionDays,
    defaultModel: current.defaultModel,
    defaultThinking: normalized,
    subscriptionTier: current.subscriptionTier,
    outputDir: current.outputDir,
    lastCleanup: current.lastCleanup
  });
  return { defaultThinking: normalized, configFile: PATHS.configFile };
}

/**
 * Set subscription tier (preserves other settings)
 * @param {string} tier - 'pro' or 'max'
 */
function setSubscriptionTier(tier) {
  const normalized = tier.toLowerCase();
  if (!['pro', 'max'].includes(normalized)) {
    throw new Error(`Invalid tier: ${tier}. Must be: pro or max`);
  }

  const current = getConfig();
  writeConfig({
    browser: current.browser || DEFAULTS.browser,
    cleanupDays: current.cleanupDays || DEFAULTS.cleanupDays,
    logRetentionDays: current.logRetentionDays || DEFAULTS.logRetentionDays,
    defaultModel: current.defaultModel,
    defaultThinking: current.defaultThinking,
    subscriptionTier: normalized,
    outputDir: current.outputDir,
    lastCleanup: current.lastCleanup
  });
  return { subscriptionTier: normalized, configFile: PATHS.configFile };
}

/**
 * Set output directory (preserves other settings)
 * @param {string} dir - Relative folder path (e.g. 'docs/research', 'output/perplexity')
 */
function setOutputDir(dir) {
  if (!dir || typeof dir !== 'string') {
    throw new Error('Invalid output_dir: must be a non-empty string.');
  }
  const trimmed = dir.trim().replace(/[\\/]+$/, ''); // strip trailing slashes
  if (!trimmed) {
    throw new Error('Invalid output_dir: must be a non-empty string.');
  }
  if (/^[/~]/.test(trimmed) || /^[A-Za-z]:/.test(trimmed)) {
    throw new Error(`Invalid output_dir: "${trimmed}" looks like an absolute path. Use a relative folder name (e.g. docs/research).`);
  }
  if (trimmed.includes('..')) {
    throw new Error(`Invalid output_dir: "${trimmed}" contains directory traversal (..). Use a simple relative path.`);
  }

  const current = getConfig();
  writeConfig({
    browser: current.browser || DEFAULTS.browser,
    cleanupDays: current.cleanupDays || DEFAULTS.cleanupDays,
    logRetentionDays: current.logRetentionDays || DEFAULTS.logRetentionDays,
    defaultModel: current.defaultModel,
    defaultThinking: current.defaultThinking,
    subscriptionTier: current.subscriptionTier,
    outputDir: trimmed,
    lastCleanup: current.lastCleanup
  });
  return { outputDir: trimmed, configFile: PATHS.configFile };
}

/**
 * Set last cleanup timestamp (preserves other settings)
 * @param {string} isoTimestamp - ISO timestamp string
 */
function setLastCleanup(isoTimestamp) {
  const current = getConfig();
  writeConfig({
    browser: current.browser || DEFAULTS.browser,
    cleanupDays: current.cleanupDays || DEFAULTS.cleanupDays,
    logRetentionDays: current.logRetentionDays || DEFAULTS.logRetentionDays,
    defaultModel: current.defaultModel,
    defaultThinking: current.defaultThinking,
    subscriptionTier: current.subscriptionTier,
    outputDir: current.outputDir,
    lastCleanup: isoTimestamp
  });
}

//endregion

//region Tracked Directories Registry

/**
 * Get tracked directories registry
 * @returns {{ dirs: Object<string, { registered: string, lastUsed: string }> }}
 */
function getTrackedDirs() {
  if (!existsSync(PATHS.trackedDirsFile)) {
    return { dirs: {} };
  }
  try {
    return JSON.parse(readFileSync(PATHS.trackedDirsFile, 'utf8'));
  } catch {
    return { dirs: {} };
  }
}

/**
 * Save tracked directories registry (atomic write, no lock)
 * @param {object} registry
 */
function saveTrackedDirs(registry) {
  ensureConfigDir();
  atomicWriteJson(PATHS.trackedDirsFile, registry);
}

/**
 * Register current working directory in the tracked dirs registry.
 * Creates .playwright-cli/ in CWD if it doesn't exist.
 */
function registerCwd() {
  const cwd = process.cwd();

  withLockedFile(PATHS.trackedDirsFile, (registry) => {
    registry.dirs = registry.dirs || {};
    const now = new Date().toISOString();
    if (registry.dirs[cwd]) {
      registry.dirs[cwd].lastUsed = now;
    } else {
      registry.dirs[cwd] = { registered: now, lastUsed: now };
    }
  });

  // Ensure downloads dir exists (outside lock)
  if (!existsSync(PATHS.downloadsDir)) {
    mkdirSync(PATHS.downloadsDir, { recursive: true });
  }
}

/**
 * Remove a directory from the registry (locked)
 * @param {string} dirPath
 */
function unregisterDir(dirPath) {
  withLockedFile(PATHS.trackedDirsFile, (registry) => {
    registry.dirs = registry.dirs || {};
    delete registry.dirs[dirPath];
  });
}

//endregion

module.exports = {
  PATHS,
  DEFAULTS,
  VALID_MODELS,
  THINKING_TOGGLEABLE,
  THINKING_ALWAYS_ON,
  getConfig,
  getBrowser,
  getCleanupDays,
  getLogRetentionDays,
  getDefaultModel,
  getDefaultThinking,
  getSubscriptionTier,
  getOutputDir,
  getModelDisplayName,
  getModelsForTier,
  ensureConfigDir,
  writeConfig,
  setBrowser,
  setCleanupDays,
  setLogRetentionDays,
  setDefaultModel,
  setDefaultThinking,
  setSubscriptionTier,
  setOutputDir,
  setLastCleanup,
  getTrackedDirs,
  saveTrackedDirs,
  registerCwd,
  unregisterDir
};
