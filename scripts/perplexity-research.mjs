#!/usr/bin/env node
/**
 * perplexity-research.mjs - Perplexity automation via Playwright CLI
 *
 * Usage:
 *   node perplexity-research.mjs ensure-session --session 0
 *   node perplexity-research.mjs init-pool --count 3
 *   node perplexity-research.mjs start --context "..." --question "..." --mode search --topicslug "my-topic" --session 0
 *   node perplexity-research.mjs followup --question "..." --session 0
 *   node perplexity-research.mjs download --session 0
 *   node perplexity-research.mjs synthesize --include "..." --exclude "..." --session 0
 *   node perplexity-research.mjs close --session 0
 *   node perplexity-research.mjs close-pool --count 3
 */

import { createRequire } from 'module';

// Import CommonJS lib modules
const require = createRequire(import.meta.url);
const { platform, playwright, sessionState, sessionCookie, cli, config, logger, PATHS } = require('./lib');
const { sleep, parseArgs } = cli;
const { saveSessionState, getSessionState, clearSessionState } = sessionState;
const { buildStartPrompt, buildFollowupPrompt, buildSynthesisPrompt } = require('./lib/research-prompts');
const { configureSession, submitQuery, getDownloadCount, closePhantomTabs, waitForResponse, readResponseText, downloadResponse } = require('./lib/research-ui');

// Per-session logging helper
const researchDate = new Date().toISOString().slice(0, 10);
function getLog(sessionId) {
  return logger.create(`research-${sessionId}-${researchDate}`);
}

//region Configuration

const RESEARCH_CONFIG = {
  validation: {
    context: 10,
    question: 10,
    include: 10
  },
  timeout: {
    search: 120000,
    searchExtended: 300000,  // search with thinking or auto-routed model
    deep: 600000
  },
  pollInterval: 3000,
  pool: {
    staggerDelay: 1500,
    readyWait: 3000,
    closeWait: 500
  }
};

// Register CWD in tracked dirs and ensure .playwright-cli/ exists
config.registerCwd();

//endregion

//region Commands

async function cmdInitPool(args) {
  const count = parseInt(args.count, 10);
  if (!count || count < 1 || count > 10) {
    throw new Error('Count must be between 1 and 10');
  }

  console.log(`Starting ${count} Perplexity session(s)...`);

  for (let i = 0; i < count; i++) {
    playwright.startSession(i);
    console.log(`  Started session perplexity-${i}`);
    if (i < count - 1) await sleep(RESEARCH_CONFIG.pool.staggerDelay);
  }

  await sleep(RESEARCH_CONFIG.pool.readyWait);
  platform.minimizeWindows('Perplexity');

  console.log(`Started ${count} sessions: perplexity-0 through perplexity-${count - 1}`);
}

async function cmdClosePool(args) {
  const count = parseInt(args.count, 10);
  if (!count || count < 1 || count > 10) {
    throw new Error('Count must be between 1 and 10');
  }

  for (let i = 0; i < count; i++) {
    playwright.stopSession(i);
    clearSessionState(i);
  }

  await sleep(RESEARCH_CONFIG.pool.closeWait);
  console.log(`Closed ${count} sessions`);
}

async function cmdStart(args) {
  const { context, question, mode, topicSlug, session, sources, strategy, model, thinking, ensure } = args;

  if (!context || context.length < RESEARCH_CONFIG.validation.context) {
    throw new Error(`Context must be at least ${RESEARCH_CONFIG.validation.context} characters`);
  }
  if (!question || question.length < RESEARCH_CONFIG.validation.question) {
    throw new Error(`Question must be at least ${RESEARCH_CONFIG.validation.question} characters`);
  }
  if (!['search', 'deep'].includes(mode)) {
    throw new Error(`Mode must be 'search' or 'deep'`);
  }
  if (strategy && !['single', 'parallel'].includes(strategy)) {
    throw new Error(`Strategy must be 'single' or 'parallel'`);
  }

  const sessionId = session || '0';
  const log = getLog(sessionId);
  const startTime = Date.now();

  // Resolve model: use passed value, fall back to config default
  const resolvedModel = model || config.getDefaultModel();
  const resolvedThinking = thinking || config.getDefaultThinking();
  log.info(`start: mode=${mode} model=${resolvedModel} thinking=${resolvedThinking} slug=${topicSlug} strategy=${strategy || 'unset'} session=${sessionId}`);

  // Validate session: --ensure does inline validation (fast no-op if hook already started it)
  if (ensure) {
    const isRunning = playwright.isSessionRunning(sessionId);
    if (!isRunning) {
      log.info(`start: session not running, running ensure logic`);
      const browser = config.getBrowser();
      const result = await sessionCookie.ensureSessionValid(parseInt(sessionId, 10), browser);
      if (!result.success) throw new Error(`Session validation failed: ${result.error || 'unknown'}`);
      if (result.sessionStarted) platform.minimizeWindows('Perplexity');
    }
  } else {
    playwright.verifySessionRunning(sessionId);
  }

  configureSession(sessionId, { model: resolvedModel, thinking: resolvedThinking, mode, sources });
  closePhantomTabs(sessionId, log);
  saveSessionState(sessionId, mode, topicSlug, strategy, resolvedModel, resolvedThinking);

  const fullPrompt = buildStartPrompt(context, question, mode);
  const countBefore = getDownloadCount(sessionId);
  submitQuery(sessionId, fullPrompt);
  closePhantomTabs(sessionId, log);
  platform.minimizeWindows('Perplexity');

  // Use extended timeout for search with thinking or auto-routed model
  const needsExtendedTimeout = mode === 'search' && (resolvedThinking === 'true' || resolvedModel === 'best');
  const timeoutKey = mode === 'deep' ? 'deep' : (needsExtendedTimeout ? 'searchExtended' : 'search');
  const timeoutMs = RESEARCH_CONFIG.timeout[timeoutKey];
  log.info(`start: using timeout=${timeoutMs}ms (${timeoutKey})`);

  await waitForResponse(sessionId, countBefore, timeoutMs, log);
  playwright.tabSelect(sessionId, 0);
  const text = readResponseText(sessionId);
  if (!text) throw new Error('Failed to read response from page');
  log.info(`start: completed in ${Date.now() - startTime}ms, response=${text.length}chars`);
  console.log(text);
}

async function cmdFollowup(args) {
  const { question, session } = args;

  if (!question || question.length < RESEARCH_CONFIG.validation.question) {
    throw new Error(`Question must be at least ${RESEARCH_CONFIG.validation.question} characters`);
  }

  const sessionId = session || '0';
  const log = getLog(sessionId);
  const startTime = Date.now();
  log.info(`followup: session=${sessionId} question=${question.length}chars`);

  const state = getSessionState(sessionId);

  if (state.mode === 'deep') {
    throw new Error('Deep research does not support follow-ups. Use download → close instead.');
  }

  const fullPrompt = buildFollowupPrompt(question);
  const countBefore = getDownloadCount(sessionId);
  submitQuery(sessionId, fullPrompt);
  closePhantomTabs(sessionId, log);
  platform.minimizeWindows('Perplexity');

  await waitForResponse(sessionId, countBefore, RESEARCH_CONFIG.timeout.search, log);
  playwright.tabSelect(sessionId, 0);
  const text = readResponseText(sessionId);
  if (!text) throw new Error('Failed to read response from page');
  log.info(`followup: completed in ${Date.now() - startTime}ms, response=${text.length}chars`);
  console.log(text);
}

async function cmdDownload(args) {
  const sessionId = args.session || '0';
  const log = getLog(sessionId);
  log.info(`download: session=${sessionId}`);
  const state = getSessionState(sessionId);
  const filePath = await downloadResponse(sessionId, state.topicSlug, 'response');
  log.info(`download: saved to ${filePath}`);
  console.log(filePath);
}

async function cmdSynthesize(args) {
  const { include, exclude, session } = args;

  if (!include || include.length < RESEARCH_CONFIG.validation.include) {
    throw new Error(`Include must be at least ${RESEARCH_CONFIG.validation.include} characters`);
  }

  const sessionId = session || '0';
  const log = getLog(sessionId);
  const startTime = Date.now();
  log.info(`synthesize: session=${sessionId} include=${include.length}chars`);

  const state = getSessionState(sessionId);

  if (state.mode === 'deep') {
    throw new Error('Deep research does not support synthesize. Use download → close instead.');
  }

  const fullPrompt = buildSynthesisPrompt(include, exclude || '');
  const countBefore = getDownloadCount(sessionId);
  submitQuery(sessionId, fullPrompt);
  closePhantomTabs(sessionId, log);

  await waitForResponse(sessionId, countBefore, 300000, log);
  const filePath = await downloadResponse(sessionId, state.topicSlug, 'synthesis');
  log.info(`synthesize: completed in ${Date.now() - startTime}ms, saved to ${filePath}`);
  console.log(filePath);
}

function cmdClose(args) {
  const sessionId = args.session || '0';
  const log = getLog(sessionId);
  log.info(`close: session=${sessionId}`);
  // Clean up phantom tabs before stopping (prevents stale tabs in persistent profile)
  closePhantomTabs(sessionId, log);
  playwright.stopSession(sessionId);
  // Release session claim so other agents can use it
  sessionCookie.releaseSession(parseInt(sessionId, 10));
  log.info(`close: session perplexity-${sessionId} stopped, claim released`);
  console.log(`Session perplexity-${sessionId} closed`);
}

async function cmdEnsureSession(args) {
  const sessionId = args.session || '0';
  const log = getLog(sessionId);
  const browser = config.getBrowser();

  const isRunning = playwright.isSessionRunning(sessionId);
  log.info(`ensure-session: running=${isRunning} browser=${browser}`);

  if (isRunning) {
    platform.minimizeWindows('Perplexity');
    console.log(`Session perplexity-${sessionId} already running`);
    return;
  }

  console.log(`Ensuring session perplexity-${sessionId} is valid...`);
  const result = await sessionCookie.ensureSessionValid(parseInt(sessionId, 10), browser, { log: console.log });
  log.info(`ensure-session: validation success=${result.success} sessionStarted=${result.sessionStarted}`);

  if (!result.success) {
    log.error(`ensure-session: failed - ${result.error || 'unknown'}`);
    throw new Error(`Session validation failed: ${result.error || 'unknown'}`);
  }

  if (result.sessionStarted) {
    platform.minimizeWindows('Perplexity');
  }

  console.log(`Session perplexity-${sessionId} ready (logged in, cookie valid)`);
}

//endregion

//region CLI

function showUsage() {
  console.log(`
Perplexity Research Automation

Usage: ppx-research <command> [options]

Commands:
  ensure-session  Verify session running + logged in (start if needed)
  init-pool       Start N browser sessions
  close-pool      Close N browser sessions
  start           Begin research thread (returns response text)
  followup        Continue thread (returns response text)
  synthesize      Synthesize thread and download as markdown
  download        Download current response as markdown
  close           Close session

Options:
  --count N          Number of sessions (init-pool, close-pool)
  --session N        Session ID 0-9 (default: 0)
  --context "..."    Background context
  --question "..."   Research question
  --mode search|deep Research mode
  --model <slug>     Model: best, sonar, gpt-5.4, etc.
  --thinking <val>   Thinking mode: true, false
  --topicslug "..."  Topic slug for filenames
  --strategy single|parallel  Research execution strategy
  --sources "..."    Comma-separated: web, academic, social
  --include "..."    Topics to include (synthesize)
  --exclude "..."    Topics to exclude (synthesize)
  --ensure           Validate session inline before start (no separate ensure-session needed)
`);
}

async function main() {
  const { command, args } = parseArgs(process.argv.slice(2), { arrayFields: ['sources'] });

  // Handle help flags
  if (args.help || args.h || command === 'help') {
    showUsage();
    return;
  }

  try {
    switch (command) {
      case 'init-pool': await cmdInitPool(args); break;
      case 'close-pool': await cmdClosePool(args); break;
      case 'start':
        await cmdStart({
          context: args.context,
          question: args.question,
          mode: args.mode,
          model: args.model,
          thinking: args.thinking,
          topicSlug: args.topicslug,
          session: args.session,
          sources: args.sources,
          strategy: args.strategy,
          ensure: args.ensure
        });
        break;
      case 'followup':
        await cmdFollowup({
          question: args.question,
          session: args.session
        });
        break;
      case 'download':
        await cmdDownload({ session: args.session });
        break;
      case 'synthesize':
        await cmdSynthesize({
          include: args.include,
          exclude: args.exclude,
          session: args.session
        });
        break;
      case 'close': cmdClose({ session: args.session }); break;
      case 'ensure-session': await cmdEnsureSession(args); break;
      default:
        if (command) console.error(`Unknown command: ${command}`);
        showUsage();
        process.exit(command ? 1 : 0);
    }
  } catch (error) {
    console.error(`ERROR: ${platform.stripCliXml(error.message)}`);
    process.exit(1);
  }
}

main();

//endregion
