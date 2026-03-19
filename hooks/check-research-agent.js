#!/usr/bin/env node
/**
 * PreToolUse gate - checks if Task is spawning a research-agent
 *
 * Minimal imports (fs/child_process/path only). Exits silently for non-matching agents.
 * On match, delegates to validate-research-session.js for full validation.
 */

const { execFileSync } = require('child_process');
const { readFileSync } = require('fs');
const { join } = require('path');

function main() {
  let raw;
  try {
    raw = readFileSync(0, 'utf8');
  } catch {
    process.exit(0);
  }

  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  const subagentType = (input.tool_input || {}).subagent_type || '';

  // Not a research-agent — exit silently, fast
  if (!subagentType.includes('research-agent')) {
    process.exit(0);
  }

  // Match — delegate to full validation utility
  const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT || join(__dirname, '..');
  const utilityScript = join(PLUGIN_ROOT, 'hooks', 'validate-research-session.js');

  try {
    const result = execFileSync(process.execPath, [utilityScript], {
      input: raw,
      encoding: 'utf8',
      timeout: 70000,
      windowsHide: true
    });
    if (result) process.stdout.write(result);
  } catch (e) {
    // Utility exited with error — pass through its stdout
    if (e.stdout) process.stdout.write(e.stdout);
    process.exit(e.status || 1);
  }
}

main();
