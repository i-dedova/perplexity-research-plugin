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

module.exports = {
  parseArgs,
  sleep
};
