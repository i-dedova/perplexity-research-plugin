#!/usr/bin/env node
/**
 * Unified CLI entry point for perplexity-research plugin.
 *
 * Routes subcommands to the appropriate script:
 *   ppx-research setup <cmd>     → scripts/setup.js
 *   ppx-research cleanup <opts>  → scripts/cleanup.js
 *   ppx-research <cmd>           → scripts/perplexity-research.mjs
 */

const { execFileSync } = require('child_process');
const { join } = require('path');

const SCRIPTS_DIR = join(__dirname, '..', 'scripts');
const args = process.argv.slice(2);
const subcommand = args[0];

// Show unified help: pull from each script dynamically
if (!subcommand || subcommand === '--help' || subcommand === '-h' || subcommand === 'help') {
  console.log('\nPerplexity Research Plugin — Unified CLI\n');
  console.log('Usage: ppx-research <command> [options]\n');
  console.log('Command groups:');
  console.log('  ppx-research <cmd>           Research (start, followup, download, close, ...)');
  console.log('  ppx-research setup <cmd>     Setup & config (check, clone-pool, set-model, ...)');
  console.log('  ppx-research cleanup <opts>  Temp file cleanup (--status, --force, --dry-run)\n');

  const groups = [
    { label: 'Research', script: 'perplexity-research.mjs' },
    { label: 'Setup', script: 'setup.js' },
    { label: 'Cleanup', script: 'cleanup.js' }
  ];

  for (const { label, script } of groups) {
    try {
      console.log(`--- ${label} ---`);
      execFileSync(process.execPath, [join(SCRIPTS_DIR, script), '--help'], {
        stdio: 'inherit', env: process.env
      });
    } catch {}
    console.log('');
  }
  process.exit(0);
}

const ROUTES = {
  'setup': { script: 'setup.js', args: args.slice(1) },
  'cleanup': { script: 'cleanup.js', args: args.slice(1) }
};

// Route to the correct script
const route = ROUTES[subcommand];
const script = route
  ? join(SCRIPTS_DIR, route.script)
  : join(SCRIPTS_DIR, 'perplexity-research.mjs');
const scriptArgs = route ? route.args : args;

try {
  execFileSync(process.execPath, [script, ...scriptArgs], {
    stdio: 'inherit',
    env: process.env
  });
} catch (e) {
  process.exit(e.status || 1);
}
