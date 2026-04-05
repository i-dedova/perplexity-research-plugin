/**
 * cli.js - CLI argument parsing utilities
 *
 * Shared across setup.js and perplexity-research.mjs
 */

/**
 * Parse command line arguments
 * @param {string[]} argv - Arguments (typically process.argv.slice(2))
 * @returns {{ command: string, value: string, args: object }}
 */
function parseArgs(argv, options = {}) {
  const args = {};
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2).replace(/-/g, '');
      // Check if next arg is a value or another flag
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        args[key] = argv[++i];
      } else {
        args[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }

  // Post-process array fields (e.g., --sources "web,academic" → ['web', 'academic'])
  if (options.arrayFields) {
    for (const field of options.arrayFields) {
      if (typeof args[field] === 'string') {
        args[field] = args[field].split(',').map(s => s.trim());
      }
    }
  }

  return {
    command: positional[0],
    value: positional[1],
    args
  };
}

/**
 * Helper to sleep for a duration
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Compare semver strings numerically (handles 0.1.10 > 0.1.2 correctly).
 * @param {string} version - Version to check
 * @param {string} minimum - Minimum required version
 * @returns {boolean} True if version >= minimum
 */
function meetsMinVersion(version, minimum) {
  const v = version.split('.').map(Number);
  const m = minimum.split('.').map(Number);
  for (let i = 0; i < Math.max(v.length, m.length); i++) {
    if ((v[i] || 0) > (m[i] || 0)) return true;
    if ((v[i] || 0) < (m[i] || 0)) return false;
  }
  return true; // equal
}

module.exports = {
  parseArgs,
  sleep,
  meetsMinVersion
};
