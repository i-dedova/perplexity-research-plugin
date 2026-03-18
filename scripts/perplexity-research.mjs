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
import { existsSync, readdirSync, renameSync, statSync } from 'fs';
import { join } from 'path';

// Import CommonJS lib modules
const require = createRequire(import.meta.url);
const { platform, playwright, sessionState, sessionCookie, cli, config, logger, PATHS } = require('./lib');
const { sleep, parseArgs } = cli;
const { saveSessionState, getSessionState, clearSessionState } = sessionState;

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

//region UI Interactions

function setResearchMode(sessionId, mode) {
  if (mode !== 'deep') return;
  const code = `async page => {
    await page.getByRole('button', { name: 'Add files or tools' }).click();
    await page.waitForTimeout(400);
    await page.getByRole('menuitemradio', { name: 'Deep research' }).click();
    await page.waitForTimeout(300);
  }`;
  playwright.runCode(sessionId, code.replace(/\n/g, ' '), 10000);
}

function setSources(sessionId, sources) {
  // Open "+" menu → "Connectors and sources" submenu
  playwright.runCode(sessionId, `async page => {
    await page.getByRole('button', { name: 'Add files or tools' }).click();
    await page.waitForTimeout(400);
    await page.getByRole('menuitem', { name: 'Connectors and sources' }).click();
    await page.waitForTimeout(400);
  }`.replace(/\n/g, ' '), 10000);

  // Toggle academic/social (Web checked by default)
  for (const source of sources) {
    if (['academic', 'social'].includes(source.toLowerCase())) {
      const name = source.charAt(0).toUpperCase() + source.slice(1).toLowerCase();
      playwright.runCode(sessionId,
        `async page => await page.getByRole('menuitemcheckbox', { name: '${name}' }).click()`);
    }
  }
  playwright.pressKey(sessionId, 'Escape');
}

function configureModel(sessionId, modelSlug, thinking) {
  if (!modelSlug || modelSlug === 'best') return;

  const displayName = config.getModelDisplayName(modelSlug);
  if (!displayName) return;

  // Open model dropdown and select model
  playwright.runCode(sessionId, `async page => {
    const btn = page.locator('button').filter({ hasText: /choose a model|${displayName}/i }).first();
    await btn.click();
    await page.waitForTimeout(400);
    await page.getByRole('menuitem', { name: '${displayName}' }).click();
    await page.waitForTimeout(300);
  }`.replace(/\n/g, ' '), 10000);

  // Handle thinking toggle for toggleable models
  const { THINKING_TOGGLEABLE, THINKING_ALWAYS_ON } = config;
  if (THINKING_TOGGLEABLE.includes(modelSlug) && thinking !== undefined && thinking !== null) {
    const wantThinking = thinking === 'true' || thinking === true;
    playwright.runCode(sessionId, `async page => {
      const btn = page.locator('button').filter({ hasText: /choose a model|${displayName}/i }).first();
      await btn.click();
      await page.waitForTimeout(400);
      const toggle = page.getByRole('switch', { name: 'Toggle option' });
      if (await toggle.count() > 0) {
        const checked = await toggle.getAttribute('aria-checked');
        const isOn = checked === 'true';
        if (${wantThinking} !== isOn) {
          await toggle.click();
          await page.waitForTimeout(200);
        }
      }
      await page.keyboard.press('Escape');
    }`.replace(/\n/g, ' '), 10000);
  }
}

function configureSession(sessionId, { model, thinking, mode, sources }) {
  if (model && model !== 'dynamic') {
    configureModel(sessionId, model, thinking);
  }
  setResearchMode(sessionId, mode);
  if (sources && sources.length > 0 && !sources.every(s => s === 'web')) {
    setSources(sessionId, sources);
  }
}

function submitQuery(sessionId, prompt) {
  const b64Prompt = Buffer.from(prompt).toString('base64');
  const code = `async page => {
    const decoded = await page.evaluate((b64) => atob(b64), '${b64Prompt}');
    await page.locator('#ask-input').fill(decoded);
  }`;
  playwright.runCode(sessionId, code.replace(/\n/g, ' '));
  playwright.pressKey(sessionId, 'Enter');
}

function getDownloadCount(sessionId) {
  const result = playwright.runCode(sessionId, "async page => await page.getByRole('button', { name: 'Download' }).count()");
  const match = result?.match(/### Result\s*\n(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

async function waitForResponse(sessionId, countBefore, timeoutMs) {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const count = getDownloadCount(sessionId);
    if (count > countBefore) return;
    await sleep(RESEARCH_CONFIG.pollInterval);
  }

  throw new Error(`Timeout waiting for Perplexity response after ${timeoutMs}ms`);
}

function readResponseText(sessionId) {
  const code = 'async page => await page.evaluate(() => { ' +
    'const p = document.querySelectorAll("[class*=\\"prose\\"]"); ' +
    'return p[p.length - 1]?.innerText || null; })';
  const result = playwright.runCode(sessionId, code, 15000);
  if (!result) return null;
  const match = result.match(/### Result\s*\n([\s\S]*)/);
  if (!match) return null;
  try { return JSON.parse(match[1].trim()); }
  catch { return match[1].trim().replace(/^"|"$/g, ''); }
}

async function downloadResponse(sessionId, topicSlug, type) {
  const existingFiles = new Set();
  if (existsSync(PATHS.downloadsDir)) {
    readdirSync(PATHS.downloadsDir).filter(f => f.endsWith('.md')).forEach(f => existingFiles.add(f));
  }

  playwright.runCode(sessionId, "async page => await page.getByRole('button', { name: 'Download' }).last().click()");
  await sleep(1000);
  playwright.runCode(sessionId, "async page => await page.getByRole('menuitem', { name: 'Markdown' }).click()");

  let downloadedFile = null;
  const maxAttempts = 10;
  const retryDelay = 1000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await sleep(retryDelay);
    if (!existsSync(PATHS.downloadsDir)) continue;

    const currentFiles = readdirSync(PATHS.downloadsDir)
      .filter(f => f.endsWith('.md'))
      .map(f => ({
        name: f,
        path: join(PATHS.downloadsDir, f),
        mtime: statSync(join(PATHS.downloadsDir, f)).mtime
      }));

    const startTime = Date.now() - (attempt + 1) * retryDelay - 2000;

    for (const file of currentFiles) {
      if (!existingFiles.has(file.name) || file.mtime.getTime() > startTime) {
        downloadedFile = file;
        break;
      }
    }

    if (downloadedFile) break;
  }

  if (!downloadedFile) {
    throw new Error(`No new markdown file found in ${PATHS.downloadsDir}`);
  }

  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').substring(0, 15);
  const newName = `${topicSlug}-${type}-${timestamp}.md`;
  const newPath = join(PATHS.downloadsDir, newName);

  renameSync(downloadedFile.path, newPath);
  return newPath;
}

//endregion

//region Prompt Building

const SEARCH_METHODOLOGY = `Before responding, create a brief research plan:
1. Identify the key aspects to investigate
2. For each aspect, consult multiple independent sources
3. Cross-validate findings — a claim supported by 3+ sources is a pattern; a single-source claim is anecdotal, flag it as such

Focus on depth and reliability over speed. Prioritize:
- Authoritative, primary sources over secondary summaries
- Patterns confirmed across multiple sources over one-off claims
- Contradictions between sources — flag these explicitly
- Practical, actionable findings over theoretical overviews`;

function buildStartPrompt(context, question, mode) {
  if (mode === 'deep') {
    return `${question}

${context}

---

Respond in chat directly. Do not create downloadable documents or files.
All output in plain Markdown format — text, headers, bullets, code blocks,
and inline Markdown tables. Use Markdown tables for all comparisons.

Before researching, create a brief research plan:
1. Break the question into key aspects to investigate
2. For each aspect, identify what evidence would be most valuable
3. Prioritize primary and authoritative sources over secondary summaries

Think critically about each finding:
- Evaluate source credibility and recency
- Distinguish established best practices from emerging or contested approaches
- Where sources contradict each other, assess the strongest arguments on each side
- Cross-validate claims across multiple independent sources

Structure your response as a detailed reference document.
Someone should be able to make informed decisions from this alone.

## Findings

### {Theme/Topic 1}
For each finding:
- State what you found and the strength of evidence (how many sources agree)
- Include specific details: versions, configurations, code examples, exact numbers
- Where sources contradict, present the strongest argument on each side
- Cover trade-offs, edge cases, and failure modes
- Flag single-source claims separately from cross-validated patterns

### {Theme/Topic 2}
{Same depth}

## Contradictions and Open Questions
- Where sources disagreed and the strongest argument on each side
- Questions that remain unanswered despite thorough search
- Areas where the landscape is actively changing

## Recommendations
1. **{Recommendation}**: Detailed rationale including why alternatives were
   rejected, conditions where this applies, and risks to watch for

Start directly with the research plan, then findings.
Each finding appears once, in one section only.
Specific over general: exact versions, real benchmarks, actual code.
End with Recommendations as the final section.`;
  }

  return `${question}

${context}

---

${SEARCH_METHODOLOGY}

Respond in chat directly. Do not create downloadable documents or files.
All output in plain Markdown format — text, headers, bullets, code blocks, and inline Markdown tables.

## Findings
{Organize by topic/theme with headers}
- Use bullets for key points
- Code snippets where relevant, short and focused
- Flag whether each finding is a cross-validated pattern or single-source claim
- Note contradictions between sources
- Each finding appears once, in one section only
- End with Recommendations as the final section

## Recommendations
1. **{Recommendation}**: {rationale}`;
}

function buildFollowupPrompt(question) {
  return `${question}

---

Respond in chat directly. Do not create downloadable documents or files.
All output in plain Markdown format — text, headers, bullets, code blocks, and inline Markdown tables.
Continue cross-validating across sources. Flag patterns vs single-source claims.

## Findings
{Organize by topic/theme with headers}
- Flag cross-validated patterns vs single-source claims
- Note contradictions between sources
- Each finding appears once, in one section only

## Recommendations
1. **{Recommendation}**: {rationale}`;
}

function buildSynthesisPrompt(include, exclude = '') {
  const excludeSection = exclude ? `\n\nEXCLUDE (do not include these in synthesis):\n${exclude}` : '';

  return `INCLUDE:
${include}${excludeSection}

---

Synthesize this entire research thread into a comprehensive, decision-ready document.

Respond in chat directly. Do not create downloadable documents or files.
All output in plain Markdown format — text, headers, bullets, code blocks, and inline Markdown tables.

Create a thorough synthesis that someone can use to make informed decisions. This is NOT a summary — it should be more detailed and structured than any individual response in this thread.

FORMAT:

## Research Questions
{List each question explored in this thread}

## Findings

### {Theme/Topic 1}
{Detailed findings organized by theme. For each finding:}
- What was found and from how many sources
- Whether this is a cross-validated pattern or single-source claim
- Relevant code examples, configurations, or specifications
- Trade-offs, limitations, and edge cases

### {Theme/Topic 2}
{Same structure}

## Contradictions and Open Questions
- {Where sources disagreed and what each side argues}
- {Questions that remain unanswered or need further investigation}

## Recommendations
1. **{Recommendation}**: {detailed rationale including why alternatives were rejected, conditions where this applies, and risks to watch for}

Start directly with Research Questions.
Each finding appears once, in one section only.
Prefer depth over brevity — include enough detail to act on.
End with Recommendations as the final section.`;
}

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
  saveSessionState(sessionId, mode, topicSlug, strategy, resolvedModel, resolvedThinking);

  const fullPrompt = buildStartPrompt(context, question, mode);
  const countBefore = getDownloadCount(sessionId);
  submitQuery(sessionId, fullPrompt);
  platform.minimizeWindows('Perplexity');

  await waitForResponse(sessionId, countBefore, RESEARCH_CONFIG.timeout[mode]);
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
  platform.minimizeWindows('Perplexity');

  await waitForResponse(sessionId, countBefore, RESEARCH_CONFIG.timeout.search);
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

  await waitForResponse(sessionId, countBefore, 300000);
  const filePath = await downloadResponse(sessionId, state.topicSlug, 'synthesis');
  log.info(`synthesize: completed in ${Date.now() - startTime}ms, saved to ${filePath}`);
  console.log(filePath);
}

function cmdClose(args) {
  const sessionId = args.session || '0';
  const log = getLog(sessionId);
  log.info(`close: session=${sessionId}`);
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
  const result = await sessionCookie.ensureSessionValid(parseInt(sessionId, 10), browser);
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
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}

main();

//endregion
