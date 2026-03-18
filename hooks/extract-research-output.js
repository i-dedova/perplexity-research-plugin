#!/usr/bin/env node
/**
 * SubagentStop hook - extracts research output and handles single-agent file preservation
 *
 * Responsibilities:
 * 1. Extract output file path from agent transcript
 * 2. Read session state to determine strategy (single/parallel)
 * 3. If single: copy output file to docs/research/{topic-slug}.md
 * 4. Always: clean up session state file (moved here from cmdClose)
 * 5. Log all actions
 */

const { readFileSync, existsSync, copyFileSync, mkdirSync, readdirSync, writeFileSync } = require('fs');
const { join, resolve, sep } = require('path');

const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT || join(__dirname, '..');
const { sessionState, logger } = require(join(PLUGIN_ROOT, 'scripts', 'lib'));

const date = new Date().toISOString().slice(0, 10);
const log = logger.create(`hook-extract-${date}`);

//region Helpers

/**
 * Extract session ID and output file paths from agent transcript.
 */
function extractFilesFromTranscript(transcriptContent) {
  const sessionIdMatch = transcriptContent.match(/--session\s+(\d+)/);
  const sessionId = sessionIdMatch ? sessionIdMatch[1] : null;

  const filePattern = /[A-Za-z]:[^\s"'`*]*[\\\/]\.playwright-cli[\\\/][^\s"'`*]+\.md/gi;
  let responseFile = null;
  let synthesisFile = null;

  const lines = transcriptContent.trim().split('\n');
  for (const line of lines) {
    try {
      const matches = line.match(filePattern);
      if (matches) {
        for (const match of matches) {
          const normalizedPath = match.replace(/\\\\/g, '/').replace(/\\/g, '/');
          if (normalizedPath.includes('-synthesis-')) {
            synthesisFile = normalizedPath;
          } else if (normalizedPath.includes('-response-')) {
            responseFile = normalizedPath;
          }
        }
      }
    } catch {
      continue;
    }
  }

  return { sessionId, responseFile, synthesisFile };
}

/**
 * Determine the final output file (synthesis takes priority over response).
 */
function determineFinalOutput(responseFile, synthesisFile) {
  if (synthesisFile) return { finalOutput: synthesisFile, outputType: 'synthesis' };
  if (responseFile) return { finalOutput: responseFile, outputType: 'response' };
  return { finalOutput: null, outputType: null };
}

/**
 * Copy output file to docs/research/ for single-agent strategy.
 */
function preserveSingleOutput(outputPath, topicSlug, cwd) {
  const resolved = resolve(outputPath.replace(/\//g, sep));

  if (!existsSync(resolved)) {
    log.warn(`Output file not found for copy: ${resolved}`);
    return null;
  }

  const outputDir = join(cwd, 'docs', 'research');
  mkdirSync(outputDir, { recursive: true });

  const destFile = join(outputDir, `${topicSlug || 'research'}.md`);
  copyFileSync(resolved, destFile);
  log.info(`Single-agent output saved: ${destFile}`);
  return destFile;
}

/**
 * Write breadcrumb JSON for PostToolUse:Task handler.
 */
function writeBreadcrumb(data, cwd) {
  const breadcrumbPath = join(cwd, '.playwright-cli', '.research-output.json');
  try {
    writeFileSync(breadcrumbPath, JSON.stringify({
      ...data,
      timestamp: Date.now(),
    }));
    log.info(`Breadcrumb written: ${breadcrumbPath}`);
  } catch (e) {
    log.warn(`Failed to write breadcrumb: ${e.message}`);
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

  // Check for session state files — only created by perplexity-research.mjs start.
  // This is the definitive signal that a research agent ran (not playwright for other tools).
  const downloadsDir = join(process.cwd(), '.playwright-cli');
  let sessionStateFiles = [];
  if (existsSync(downloadsDir)) {
    try {
      sessionStateFiles = readdirSync(downloadsDir).filter(f => f.match(/^\.session-state-\d+\.json$/));
    } catch {}
  }
  if (sessionStateFiles.length === 0) {
    process.exit(0); // No research session state — not our agent
  }

  const transcriptPath = input.agent_transcript_path;
  if (!transcriptPath || !existsSync(transcriptPath)) {
    process.exit(0);
  }

  // Read agent transcript (JSONL format)
  const transcriptContent = readFileSync(transcriptPath, 'utf8');

  // Extract files and session ID
  const { sessionId, responseFile, synthesisFile } = extractFilesFromTranscript(transcriptContent);
  log.info(`Research agent stopped: sessionId=${sessionId || 'not found'}`);

  const { finalOutput, outputType } = determineFinalOutput(responseFile, synthesisFile);
  log.info(`Output found: type=${outputType || 'none'} file=${finalOutput || 'none'}`);

  // Read session state and handle single-agent file preservation
  let strategy = null;
  let topicSlug = null;

  if (sessionId && sessionState.hasSessionState(sessionId)) {
    try {
      const state = sessionState.getSessionState(sessionId);
      strategy = state.strategy || null;
      topicSlug = state.topicSlug || null;
      log.info(`Session state: strategy=${strategy || 'unset'} topicSlug=${topicSlug || 'unset'}`);
    } catch (e) {
      log.error(`Failed to read session state: ${e.message}`);
    }
  }

  // Single-agent strategy: copy output to docs/research/
  let savedTo = null;
  if (strategy === 'single' && finalOutput) {
    savedTo = preserveSingleOutput(finalOutput, topicSlug, process.cwd());
  }

  // Write breadcrumb for PostToolUse:Task handler
  if (savedTo || finalOutput) {
    writeBreadcrumb({ savedTo, outputType, topicSlug, finalOutput, strategy }, process.cwd());
  }

  // Clean up session state (moved here from cmdClose)
  if (sessionId && sessionState.hasSessionState(sessionId)) {
    sessionState.clearSessionState(sessionId);
    log.info(`Session state cleaned up: session=${sessionId}`);
  }

  // Build output message for Claude
  if (finalOutput || savedTo) {
    let message = `## Research Output\n\n`;
    message += `**Type:** ${outputType === 'synthesis' ? 'Multi-round synthesis' : 'Single response'}\n`;
    message += `**Final output:** \`${finalOutput}\`\n`;

    if (strategy) {
      message += `**Strategy:** ${strategy}\n`;
    }

    if (savedTo) {
      message += `**Saved to:** \`${savedTo}\`\n`;
      message += `\nThe research output has been automatically saved to the project research directory.\n`;
    }

    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SubagentStop",
        additionalContext: message
      }
    }));
  }

  process.exit(0);
}

main();
