#!/usr/bin/env node
/**
 * Utility script - full validation for research-agent spawning
 *
 * Called by check-research-agent.js (gate) only when subagent_type is research-agent.
 * Checks: playwright-cli, config, session pool, session validity, browser start + minimize
 */

const { execFileSync } = require('child_process');
const { readFileSync } = require('fs');
const { join } = require('path');

const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT || join(__dirname, '..');
const { config, playwright, sessionStatus, platform, logger } = require(join(PLUGIN_ROOT, 'scripts', 'lib'));
const { findFreeSession } = require(join(PLUGIN_ROOT, 'scripts', 'lib', 'session-cookie'));
const { spawn } = require('child_process');

const date = new Date().toISOString().slice(0, 10);
const fileLog = logger.create(`hook-${date}`);

// Fire-and-forget cleanup check — runs detached, no delay to hook
(function triggerCleanupIfDue() {
  try {
    const cfg = config.getConfig();
    const cleanupDays = cfg.cleanupDays || 7;
    const lastCleanup = cfg.lastCleanup ? new Date(cfg.lastCleanup) : null;
    if (lastCleanup) {
      const daysSince = (Date.now() - lastCleanup.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince < cleanupDays) return;
    }
    const cleanupScript = join(PLUGIN_ROOT, 'scripts', 'cleanup.js');
    const child = spawn(process.execPath, [cleanupScript, '--force'], {
      detached: true, stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true
    });
    child.unref();
    fileLog.info(`cleanup: triggered (last: ${lastCleanup ? lastCleanup.toISOString() : 'never'})`);
  } catch {}
})();

const logs = [];
function log(msg) {
  fileLog.info(msg);
  logs.push(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

function extractSessionFromPrompt(prompt) {
  const match = prompt.match(/Session:\s*(\d+)/i) || prompt.match(/--session\s+(\d+)/i);
  return match ? parseInt(match[1], 10) : -1;
}

function extractTopicSlug(prompt) {
  const match = prompt.match(/TopicSlug:\s*([a-z0-9-]+)/i) || prompt.match(/Topic\s*slug:\s*([a-z0-9-]+)/i);
  return match ? match[1] : '';
}

/**
 * Step 0: Validate the research agent prompt has all required fields.
 * Returns array of missing field names (empty = valid).
 */
function validatePromptFields(prompt) {
  const missing = [];

  // Session: must be a number 0-9
  const session = extractSessionFromPrompt(prompt);
  if (session < 0 || session > 9) missing.push('Session (0-9)');

  // TopicSlug: lowercase-hyphens identifier
  if (!extractTopicSlug(prompt)) missing.push('TopicSlug (lowercase-hyphens)');

  // Mode: search or deep
  if (!/Mode:\s*(search|deep)/i.test(prompt)) missing.push('Mode (search|deep)');

  // Model: any model identifier
  if (!/Model:\s*\S+/i.test(prompt)) missing.push('Model (best|sonar|etc.)');

  // Thinking: true or false
  if (!/Thinking:\s*(true|false)/i.test(prompt)) missing.push('Thinking (true|false)');

  // Strategy: single or parallel
  if (!/Strategy:\s*(single|parallel)/i.test(prompt)) missing.push('Strategy (single|parallel)');

  // Context: at least 20 chars of substantive context
  const contextMatch = prompt.match(/Context:\s*(.+)/i);
  if (!contextMatch || contextMatch[1].trim().length < 20) missing.push('Context (substantive background, min 20 chars)');

  // Sources: optional, defaults to web — no validation needed

  return missing;
}

const REQUIRED_FORMAT = `Question: {research question}

Context: {background, current state, problem, success criteria}

Mode: {search|deep}
Model: {best|sonar|gpt-5.4|...}
Thinking: {true|false}
TopicSlug: {slug}
Session: {0-9}
Strategy: {single|parallel}
Sources: {web|academic|social}`;

function ensureSessionValid(sessionId) {
  const setupScript = join(PLUGIN_ROOT, 'scripts', 'setup.js');
  log(`ensure-valid ${sessionId}: calling setup.js`);
  try {
    const result = execFileSync(process.execPath, [setupScript, 'ensure-valid', String(sessionId)], {
      encoding: 'utf8',
      timeout: 60000,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    log(`ensure-valid ${sessionId}: stdout=${result.trim().substring(0, 200)}`);
    const jsonLine = result.trim().split('\n').find(l => l.startsWith('{'));
    if (jsonLine) {
      const parsed = JSON.parse(jsonLine);
      log(`ensure-valid ${sessionId}: parsed=${JSON.stringify(parsed)}`);
      return parsed;
    }
    log(`ensure-valid ${sessionId}: NO JSON found in output, returning fallback success`);
    return { success: true };
  } catch (e) {
    log(`ensure-valid ${sessionId}: CAUGHT ERROR code=${e.status} stderr=${(e.stderr || '').substring(0, 200)}`);
    if (e.stderr) {
      const jsonMatch = e.stderr.match(/\{.*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          log(`ensure-valid ${sessionId}: parsed from stderr=${JSON.stringify(parsed)}`);
          return parsed;
        } catch {}
      }
    }
    return { success: false, error: e.message };
  }
}

//region Extracted Steps

/**
 * Steps 1-3: Check playwright-cli, browser config, session pool.
 * Returns composite result with accumulated issues.
 */
function checkPrerequisites() {
  const issues = [];

  const cliCheck = playwright.checkPlaywrightCli();
  if (!cliCheck.installed) {
    issues.push('playwright-cli is not installed');
  }
  log(`step1: cli installed=${cliCheck.installed} version=${cliCheck.version}`);

  const cfg = config.getConfig();
  if (!cfg.browser) {
    issues.push('Browser preference not configured');
  }
  log(`step2: browser=${cfg.browser} exists=${cfg.exists}`);

  const poolCheck = sessionStatus.checkSessionPool(cfg.browser);
  if (!poolCheck.hasMinimum) {
    issues.push('No Perplexity sessions found (login required)');
  }
  log(`step3: poolCount=${poolCheck.poolCount} hasMinimum=${poolCheck.hasMinimum}`);

  return { issues, cliCheck, cfg, poolCheck };
}

/**
 * Step 4: Claim a free session (self-healing: auto-reassigns if occupied).
 */
function claimSession(requestedSession, topicSlug) {
  log(`step4: requestedSession=${requestedSession} topicSlug=${topicSlug}`);

  const claim = findFreeSession(requestedSession, topicSlug);
  if (!claim) {
    return { assignedSession: requestedSession, wasReassigned: false, issue: 'All 10 sessions are currently occupied by other agents. Try again shortly.' };
  }

  const assignedSession = claim.sessionId;
  const wasReassigned = claim.reassigned;
  if (wasReassigned) {
    log(`step4: session ${requestedSession} occupied, reassigned to ${assignedSession}`);
  } else {
    log(`step4: claimed session ${assignedSession}`);
  }

  return { assignedSession, wasReassigned, issue: null };
}

/**
 * Steps 5-6: Validate session cookie and ensure browser is running.
 */
function validateAndStartBrowser(assignedSession, cfg) {
  // Step 5: Cookie validation
  const sessionResult = ensureSessionValid(assignedSession);
  log(`step5: ensureSessionValid returned success=${sessionResult.success} sessionStarted=${sessionResult.sessionStarted} refreshedFrom=${sessionResult.refreshedFrom}`);

  if (!sessionResult.success) {
    const issue = sessionResult.needsRelogin
      ? 'All sessions expired. Run /perplexity-setup to re-login.'
      : `Session validation failed: ${sessionResult.error || 'unknown error'}`;
    return { sessionResult, browserStarted: false, issue };
  }

  // Step 6: Ensure browser running
  const isRunning = playwright.isSessionRunning(assignedSession);
  log(`step6: isRunning=${isRunning} after ensure-valid`);

  if (isRunning) {
    log(`step6: session already running, minimizing`);
    platform.minimizeWindows('Perplexity');
    return { sessionResult, browserStarted: false, issue: null };
  }

  log(`step6: session NOT running, starting manually`);
  playwright.startSession(assignedSession, cfg.browser);

  // Poll for up to 10 seconds
  const startTime = Date.now();
  let nowRunning = false;

  while (Date.now() - startTime < 10000) {
    try {
      execFileSync(process.execPath, ['-e', 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000)'], {
        timeout: 2000, windowsHide: true, stdio: 'ignore'
      });
    } catch {}

    nowRunning = playwright.isSessionRunning(assignedSession);
    if (nowRunning) break;
  }

  if (!nowRunning) {
    log(`step6: FAILED to start after 10s polling`);
    return { sessionResult, browserStarted: true, issue: `Failed to start browser session perplexity-${assignedSession}` };
  }

  log(`step6: session started after ${Date.now() - startTime}ms`);
  platform.minimizeWindows('Perplexity');
  return { sessionResult, browserStarted: true, issue: null };
}

/**
 * Step 7: Build and emit the hook JSON response (allow or deny).
 */
function buildOutput({ issues, cliCheck, poolCheck, assignedSession, requestedSession, wasReassigned, sessionResult, browserStarted }) {
  const logSummary = logs.join('\n');

  log(`result: issues=${issues.length} decision=${issues.length === 0 ? 'allow' : 'deny'}`);

  if (issues.length === 0) {
    let statusMsg = `✓ Perplexity research ready (playwright-cli ${cliCheck.version}, ${poolCheck.poolCount} sessions)`;
    if (sessionResult?.refreshedFrom !== undefined) {
      statusMsg += ` [cookie refreshed from session ${sessionResult.refreshedFrom}]`;
    }
    if (browserStarted) {
      statusMsg += ` [browser started]`;
    }
    if (wasReassigned) {
      statusMsg += ` [reassigned: ${requestedSession}→${assignedSession}]`;
    }

    let sessionNotice = `Session perplexity-${assignedSession} is running.\nUse: node "${PLUGIN_ROOT}/scripts/perplexity-research.mjs" <command> --session ${assignedSession}`;
    if (wasReassigned) {
      sessionNotice = `IMPORTANT: Your assigned session is ${assignedSession} (requested ${requestedSession} was occupied). Use --session ${assignedSession} for ALL commands in this research session.\n\n${sessionNotice}`;
    }

    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        additionalContext: `${statusMsg}\n\n${sessionNotice}\n\nHook log:\n${logSummary}`
      }
    }));
  } else {
    const issueList = issues.map(i => `• ${i}`).join('\n');

    const actionInstructions = `
SETUP REQUIRED - Research cannot proceed.

Issues found:
${issueList}

ACTION REQUIRED:
1. Run: /perplexity-setup
2. Follow the setup wizard to configure browser and login to Perplexity
3. Then retry your research request

DO NOT attempt to spawn research agents until setup is complete.

Hook log:
${logSummary}`.trim();

    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: actionInstructions
      }
    }));
  }
}

//endregion

function main() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    process.exit(0);
  }

  const toolInput = input.tool_input || {};
  const prompt = toolInput.prompt || '';

  // Step 0: Validate prompt format — deny immediately if malformed
  const missingFields = validatePromptFields(prompt);
  if (missingFields.length > 0) {
    log(`step0: PROMPT VALIDATION FAILED — missing: ${missingFields.join(', ')}`);
    const logSummary = logs.join('\n');
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: `PROMPT VALIDATION FAILED — research agent will reject malformed prompts.

Missing required fields: ${missingFields.join(', ')}

Required prompt format (ALL fields mandatory):
${REQUIRED_FORMAT}

CLI: node "${PLUGIN_ROOT}/scripts/perplexity-research.mjs" <command>

Retry the Task call with ALL required fields. Do NOT omit any field.

Hook log:
${logSummary}`
      }
    }));
    process.exit(0);
  }
  log(`step0: prompt validation passed`);

  // Steps 1-3: Prerequisites
  const { issues, cliCheck, cfg, poolCheck } = checkPrerequisites();

  const requestedSession = extractSessionFromPrompt(prompt);
  const topicSlug = extractTopicSlug(prompt);
  let assignedSession = requestedSession;
  let wasReassigned = false;
  let sessionResult = null;
  let browserStarted = false;

  // Step 4: Claim session
  if (issues.length === 0) {
    const claim = claimSession(requestedSession, topicSlug);
    if (claim.issue) {
      issues.push(claim.issue);
    } else {
      assignedSession = claim.assignedSession;
      wasReassigned = claim.wasReassigned;
    }
  }

  // Steps 5-6: Validate cookie + ensure browser
  if (issues.length === 0) {
    const validation = validateAndStartBrowser(assignedSession, cfg);
    sessionResult = validation.sessionResult;
    browserStarted = validation.browserStarted;
    if (validation.issue) issues.push(validation.issue);
  }

  // Step 7: Output
  buildOutput({ issues, cliCheck, poolCheck, assignedSession, requestedSession, wasReassigned, sessionResult, browserStarted });
  process.exit(0);
}

main();
