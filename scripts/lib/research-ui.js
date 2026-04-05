/**
 * research-ui.js - Playwright UI automation for Perplexity research
 *
 * Handles:
 * - Model and source configuration
 * - Query submission
 * - Response polling and download
 * - Phantom tab detection and cleanup
 */

const { existsSync, readdirSync, statSync, renameSync } = require('fs');
const { join } = require('path');
const playwright = require('./playwright');
const { sleep } = require('./cli');
const config = require('./config');

//region Constants

const POLL_INTERVAL = 3000;

//endregion

//region Configuration

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
  const { THINKING_TOGGLEABLE } = config;
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

//endregion

//region Query & Response

function submitQuery(sessionId, prompt) {
  const b64Prompt = Buffer.from(prompt).toString('base64');
  // Find the Perplexity page (has #ask-input), bring it to front, then fill
  const code = `async page => {
    const pages = page.context().pages();
    for (const p of pages) {
      const input = p.locator('#ask-input');
      if (await input.count() > 0) {
        await p.bringToFront();
        const decoded = await p.evaluate((b64) => atob(b64), '${b64Prompt}');
        await input.fill(decoded);
        return;
      }
    }
  }`;
  playwright.runCode(sessionId, code.replace(/\n/g, ' '));
  playwright.pressKey(sessionId, 'Enter');
}

/**
 * Get download button count by scanning ALL pages in the context.
 * Phantom tabs (about:blank) can be tab 0, pushing Perplexity to tab 1+.
 * Scanning all pages makes this work regardless of tab order.
 */
function getDownloadCount(sessionId) {
  const code = `async page => {
    const pages = page.context().pages();
    for (const p of pages) {
      const count = await p.getByRole('button', { name: 'Download' }).count();
      if (count > 0) return count;
    }
    return 0;
  }`;
  const result = playwright.runCode(sessionId, code.replace(/\n/g, ' '));
  const match = result?.match(/### Result\s*\n(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Detect and close phantom tabs (about:blank or empty pages).
 * Closes any page whose URL is about:blank, regardless of tab position.
 * @param {number|string} sessionId
 * @param {object} log - Logger with .warn() method
 * @returns {number} Number of phantom tabs closed
 */
function closePhantomTabs(sessionId, log) {
  // Find tabs that are NOT Perplexity — covers about:blank, Edge's ntp.msn.com,
  // Chrome's new tab page, or any other non-Perplexity page
  const detectCode = `async page => {
    const pages = page.context().pages();
    const phantom = [];
    for (let i = 0; i < pages.length; i++) {
      const url = pages[i].url();
      if (!url.includes('perplexity')) phantom.push(i);
    }
    return JSON.stringify({ total: pages.length, phantom });
  }`;
  const result = playwright.runCode(sessionId, detectCode.replace(/\n/g, ' '));
  if (!result) return 0;

  const jsonMatch = result.match(/### Result\s*\n([\s\S]*)/);
  if (!jsonMatch) return 0;

  let info;
  try { info = JSON.parse(jsonMatch[1].trim()); }
  catch { return 0; }

  if (!info.phantom || info.phantom.length === 0) return 0;
  // Don't close all tabs — keep at least one
  if (info.phantom.length >= info.total) return 0;

  log.warn(`phantom-tabs: ${info.phantom.length} non-Perplexity tab(s) at indices [${info.phantom}], closing`);

  // Close phantom tabs from highest index to lowest (preserves lower indices)
  for (let i = info.phantom.length - 1; i >= 0; i--) {
    playwright.tabClose(sessionId, info.phantom[i]);
  }
  playwright.tabSelect(sessionId, 0);

  return info.phantom.length;
}

/**
 * Poll for Perplexity response completion by watching download button count.
 * Scans all pages — doesn't assume which tab has Perplexity.
 * @param {number|string} sessionId
 * @param {number} countBefore - Download button count before query
 * @param {number} timeoutMs - Maximum wait time
 * @param {object} log - Logger with .warn() method
 */
async function waitForResponse(sessionId, countBefore, timeoutMs, log) {
  const startTime = Date.now();
  let iteration = 0;

  while (Date.now() - startTime < timeoutMs) {
    // Periodically close phantom tabs that appear mid-search
    if (iteration > 0 && iteration % 3 === 0) {
      closePhantomTabs(sessionId, log);
    }
    // getDownloadCount scans ALL pages — works regardless of tab order
    const count = getDownloadCount(sessionId);
    if (count > countBefore) return;
    await sleep(POLL_INTERVAL);
    iteration++;
  }

  throw new Error(`Timeout waiting for Perplexity response after ${timeoutMs}ms`);
}

/**
 * Read response text from the Perplexity page (scans all pages).
 */
function readResponseText(sessionId) {
  const code = `async page => {
    const pages = page.context().pages();
    for (const p of pages) {
      const prose = await p.evaluate(() => {
        const els = document.querySelectorAll("[class*='prose']");
        return els[els.length - 1]?.innerText || null;
      });
      if (prose) return prose;
    }
    return null;
  }`;
  const result = playwright.runCode(sessionId, code.replace(/\n/g, ' '), 15000);
  if (!result) return null;
  const match = result.match(/### Result\s*\n([\s\S]*)/);
  if (!match) return null;
  try { return JSON.parse(match[1].trim()); }
  catch { return match[1].trim().replace(/^"|"$/g, ''); }
}

//endregion

//region Download

/**
 * Download a Perplexity response as markdown file.
 * @param {number|string} sessionId
 * @param {string} topicSlug - Topic identifier for filename
 * @param {string} type - File type suffix ('response' or 'synthesis')
 * @returns {Promise<string>} Path to downloaded file
 */
async function downloadResponse(sessionId, topicSlug, type) {
  const downloadsDir = config.PATHS.downloadsDir;
  const existingFiles = new Set();
  if (existsSync(downloadsDir)) {
    readdirSync(downloadsDir).filter(f => f.endsWith('.md')).forEach(f => existingFiles.add(f));
  }

  // Find and click Download on the Perplexity page (may not be tab 0 if phantom tabs exist)
  playwright.runCode(sessionId, `async page => {
    const pages = page.context().pages();
    for (const p of pages) {
      const btn = p.getByRole('button', { name: 'Download' }).last();
      if (await btn.count() > 0) { await btn.click(); return; }
    }
  }`.replace(/\n/g, ' '));
  await sleep(1000);
  playwright.runCode(sessionId, `async page => {
    const pages = page.context().pages();
    for (const p of pages) {
      const item = p.getByRole('menuitem', { name: 'Markdown' });
      if (await item.count() > 0) { await item.click(); return; }
    }
  }`.replace(/\n/g, ' '));

  let downloadedFile = null;
  const maxAttempts = 10;
  const retryDelay = 1000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await sleep(retryDelay);
    if (!existsSync(downloadsDir)) continue;

    const currentFiles = readdirSync(downloadsDir)
      .filter(f => f.endsWith('.md'))
      .map(f => ({
        name: f,
        path: join(downloadsDir, f),
        mtime: statSync(join(downloadsDir, f)).mtime
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
    throw new Error(`No new markdown file found in ${downloadsDir}`);
  }

  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').substring(0, 15);
  const newName = `${topicSlug}-${type}-${timestamp}.md`;
  const newPath = join(downloadsDir, newName);

  renameSync(downloadedFile.path, newPath);
  return newPath;
}

//endregion

module.exports = {
  setResearchMode,
  setSources,
  configureModel,
  configureSession,
  submitQuery,
  getDownloadCount,
  closePhantomTabs,
  waitForResponse,
  readResponseText,
  downloadResponse,
  POLL_INTERVAL
};
