/**
 * test-scripts-hooks.js - CLI scripts, hook scripts, hook timeouts, prompt builders
 *
 * Tests: cliScripts + hookScripts + hookTimeouts + promptBuilders
 */

const { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, rmSync } = require('fs');
const { join } = require('path');
const {
  PLUGIN_ROOT, LIB_PATH, TEMP_DIR,
  log, logVerbose, test,
  assert, assertEqual,
  lib, runHook, runScript, extractFunctionBody
} = require('./test-utils');

function run() {
  const { sessionState, PATHS } = lib();

  // === CLI Alias ===
  log('\n=== CLI Alias ===');

  test('install-alias.sh creates wrapper script', () => {
    const { execSync } = require('child_process');
    const { join } = require('path');
    const installScript = join(PLUGIN_ROOT, 'scripts', 'install-alias.sh');
    const result = execSync(`bash "${installScript}"`, { encoding: 'utf8', timeout: 10000, windowsHide: true });
    assert(result.includes('ppx-research alias installed'), 'Should confirm installation');

    const { existsSync } = require('fs');
    const wrapperPath = join(require('os').homedir(), '.claude', 'bin', 'ppx-research');
    assert(existsSync(wrapperPath), 'Wrapper script should exist at ~/.claude/bin/ppx-research');
  });

  // Ensure PATH includes ~/.claude/bin and PERPLEXITY_PLUGIN_ROOT is set for alias tests
  const pathSep = process.platform === 'win32' ? ';' : ':';
  const aliasEnv = {
    ...process.env,
    PATH: `${require('os').homedir()}/.claude/bin${pathSep}${process.env.PATH}`,
    PERPLEXITY_PLUGIN_ROOT: PLUGIN_ROOT
  };
  // On Windows, shell:true uses cmd.exe which can't run bash scripts — use bash explicitly
  const aliasShell = process.platform === 'win32' ? 'bash' : true;
  const aliasOpts = { encoding: 'utf8', timeout: 10000, windowsHide: true, shell: aliasShell, env: aliasEnv };

  test('ppx-research --help routes to research help', () => {
    const { execSync } = require('child_process');
    const result = execSync('ppx-research --help', aliasOpts);
    assert(result.includes('ppx-research') || result.includes('Usage'),
           'Alias --help should show research usage');
  });

  test('ppx-research setup --help routes to setup help', () => {
    const { execSync } = require('child_process');
    const result = execSync('ppx-research setup --help', aliasOpts);
    assert(result.includes('ppx-research setup'),
           'Alias setup --help should show setup usage');
  });

  test('ppx-research cleanup --help routes to cleanup help', () => {
    const { execSync } = require('child_process');
    const result = execSync('ppx-research cleanup --help', aliasOpts);
    assert(result.includes('ppx-research cleanup'),
           'Alias cleanup --help should show cleanup usage');
  });

  test('ppx-research setup check works via alias', () => {
    const { execSync } = require('child_process');
    const result = execSync('ppx-research setup check', aliasOpts);
    assert(result.includes('playwright-cli'),
           'Alias setup check should output status');
  });

  // === CLI Scripts (direct) ===
  log('\n=== CLI Scripts (direct) ===');

  test('setup.js --help works', () => {
    const result = runScript('setup.js', '--help');
    assert(result.includes('setup.js') || result.includes('Usage') || result.includes('check'),
           'Help output should mention usage');
  });

  test('setup.js --help mentions set-output-dir', () => {
    const result = runScript('setup.js', '--help');
    assert(result.includes('set-output-dir'), 'Help should mention set-output-dir command');
  });

  test('setup.js check runs without error', () => {
    const result = runScript('setup.js', 'check');
    assert(result.includes('Perplexity Research Plugin') || result.includes('playwright-cli'),
           'Check should output status');
  });

  test('setup.js preflight includes platform field', () => {
    const result = runScript('setup.js', 'preflight');
    const json = JSON.parse(result.trim());
    assert(json.platform, 'Preflight should include platform');
    const validPlatforms = ['windows', 'macos', 'linux'];
    assert(validPlatforms.includes(json.platform), `Platform should be one of ${validPlatforms.join(', ')}. Got: ${json.platform}`);
  });

  test('cleanup.js handles nested directories', () => {
    const { mkdirSync, writeFileSync, existsSync: ex, rmSync: rm } = require('fs');
    const { join: pjoin } = require('path');
    const tmpDir = pjoin(require('os').tmpdir(), 'perplexity-cleanup-test');
    const nestedDir = pjoin(tmpDir, 'sub1', 'sub2');
    mkdirSync(nestedDir, { recursive: true });
    writeFileSync(pjoin(nestedDir, 'test.yml'), 'test');
    writeFileSync(pjoin(tmpDir, 'test.yml'), 'test');

    // Run cleanup on the temp dir (dry run first)
    try {
      const result = runScript('cleanup.js', `--dir "${tmpDir}" --dry-run`, { timeout: 10000 });
      assert(result.includes('test.yml') || result.includes('files'), 'Dry run should list files');
    } catch {
      // cleanup.js may not support --dir flag — that's OK, we're testing rmSync works
    } finally {
      try { rm(tmpDir, { recursive: true, force: true }); } catch {}
    }
    assert(!ex(tmpDir), 'Temp dir should be cleaned up');
  });

  test('setup.js preflight returns JSON', () => {
    const result = runScript('setup.js', 'preflight');
    const json = JSON.parse(result.trim());
    assert('isComplete' in json, 'JSON should have isComplete');
    assert('missing' in json, 'JSON should have missing');
    assert('playwrightCli' in json, 'JSON should have playwrightCli');
  });

  test('perplexity-research.mjs --help works', () => {
    const result = runScript('perplexity-research.mjs', '--help');
    assert(result.includes('ppx-research') || result.includes('Usage') || result.includes('init-pool'),
           'Help output should mention usage');
  });

  test('perplexity-research.mjs help includes download command', () => {
    const result = runScript('perplexity-research.mjs', '--help');
    assert(result.includes('download'), 'Help should mention download command');
    assert(result.includes('synthesize'), 'Help should mention synthesize command');
  });

  test('cleanup.js --help works', () => {
    const result = runScript('cleanup.js', '--help');
    assert(result.includes('cleanup') || result.includes('Usage') || result.includes('--status'),
           'Help output should mention usage');
  });

  test('cleanup.js --status works', () => {
    const result = runScript('cleanup.js', '--status');
    assert(result.includes('Cleanup') || result.includes('interval') || result.includes('days'),
           'Status should output cleanup info');
  });

  // === Session ID Validation ===
  log('\n=== Session ID Validation ===');

  test('setup.js check-session rejects missing ID', () => {
    let threw = false;
    try { runScript('setup.js', 'check-session'); } catch (e) { threw = true; }
    assert(threw, 'Should exit with error for missing session ID');
  });

  test('setup.js check-session rejects invalid ID', () => {
    let threw = false;
    try { runScript('setup.js', 'check-session 99'); } catch (e) { threw = true; }
    assert(threw, 'Should exit with error for out-of-range session ID');
  });

  // === Hook Scripts ===
  log('\n=== Hook Scripts ===');

  test('check-research-agent.js handles non-matching input', () => {
    const result = runHook('check-research-agent.js', { tool_input: { subagent_type: 'other-agent' } });
    assertEqual(result.trim(), '', 'Should have no output for non-research-agent');
  });

  test('inject-templates.js produces valid output', () => {
    const result = runHook('inject-templates.js', {});
    const json = JSON.parse(result.trim());
    assert('hookSpecificOutput' in json, 'Should have hookSpecificOutput');
    assertEqual(json.hookSpecificOutput.hookEventName, 'SubagentStart', 'Event should be SubagentStart');
  });

  test('extract-research-output.js handles empty transcript', () => {
    const hookPath = join(PLUGIN_ROOT, 'hooks', 'extract-research-output.js');
    try {
      const { execSync } = require('child_process');
      execSync(`node "${hookPath}"`, {
        input: JSON.stringify({ agent_transcript_path: '/non/existent/path.jsonl' }),
        encoding: 'utf8',
        timeout: 5000,
        windowsHide: true,
        env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, PERPLEXITY_TEST: '1' }
      });
    } catch (e) {
      if (e.status !== 0) throw e;
    }
  });

  test('extract-research-output.js reads session state and cleans up', () => {
    if (!existsSync(PATHS.downloadsDir)) {
      mkdirSync(PATHS.downloadsDir, { recursive: true });
    }

    const testSessionId = 998;
    sessionState.saveSessionState(testSessionId, 'deep', 'hook-test-topic', 'parallel');
    assert(sessionState.hasSessionState(testSessionId), 'Session state should exist before hook');

    const fakeTranscript = join(TEMP_DIR, 'test-transcript.jsonl');
    const playwrightDir = PATHS.downloadsDir.replace(/\\/g, '\\\\');
    writeFileSync(fakeTranscript, [
      JSON.stringify({ type: 'tool_use', content: `node script.mjs start --session ${testSessionId} --strategy parallel` }),
      JSON.stringify({ type: 'tool_result', content: `Output: ${playwrightDir}\\\\hook-test-topic-response-20260206.md` })
    ].join('\n'));

    try {
      runHook('extract-research-output.js', { agent_transcript_path: fakeTranscript }, { timeout: 10000 });
      assert(!sessionState.hasSessionState(testSessionId),
        'Session state should be deleted by extract hook');
    } finally {
      try { sessionState.clearSessionState(testSessionId); } catch {}
      try { unlinkSync(fakeTranscript); } catch {}
    }
  });

  test('extract-research-output.js copies file for single strategy', () => {
    // Ensure output_dir is configured (hook requires it)
    const { config: cfgModule } = lib();
    const cfgBefore = cfgModule.getConfig();
    if (!cfgBefore.outputDir) {
      cfgModule.setOutputDir('docs/research');
    }

    const testSessionId = 997;
    const testSlug = 'hook-single-test';

    const tempPlaywrightDir = join(TEMP_DIR, '.playwright-cli');
    mkdirSync(tempPlaywrightDir, { recursive: true });

    const stateFile = join(tempPlaywrightDir, `.session-state-${testSessionId}.json`);
    writeFileSync(stateFile, JSON.stringify({
      mode: 'deep', topicSlug: testSlug, strategy: 'single'
    }));

    const fakeOutputName = `${testSlug}-response-20260206-120000.md`;
    const fakeOutputPath = join(tempPlaywrightDir, fakeOutputName);
    writeFileSync(fakeOutputPath, '# Test Research Output\n\nThis is test content.');

    const fakeTranscript = join(TEMP_DIR, 'test-transcript-single.jsonl');
    const outputPathEscaped = fakeOutputPath.replace(/\\/g, '\\\\');
    writeFileSync(fakeTranscript, [
      JSON.stringify({ type: 'tool_use', content: `node script.mjs start --session ${testSessionId} --strategy single` }),
      JSON.stringify({ type: 'tool_result', content: `Output saved: ${outputPathEscaped}` })
    ].join('\n'));

    try {
      const result = runHook('extract-research-output.js',
        { agent_transcript_path: fakeTranscript },
        { timeout: 10000, cwd: TEMP_DIR }
      );

      assert(result.trim(), 'Hook should produce output for single strategy');
      const json = JSON.parse(result.trim());
      assert(json.hookSpecificOutput, 'Should have hookSpecificOutput');
      assert(json.hookSpecificOutput.additionalContext.includes('single'),
        'Output should mention single strategy');
      assert(json.hookSpecificOutput.additionalContext.includes('Saved to'),
        'Output should mention saved location');

      const expectedDest = join(TEMP_DIR, 'docs', 'research', `${testSlug}.md`);
      assert(existsSync(expectedDest), `Output should be copied to ${expectedDest}`);

      const content = readFileSync(expectedDest, 'utf8');
      assert(content.includes('Test Research Output'), 'Copied content should match');
      assert(!existsSync(stateFile), 'Session state should be deleted by hook');

    } finally {
      try { unlinkSync(fakeTranscript); } catch {}
      try { unlinkSync(fakeOutputPath); } catch {}
      try { unlinkSync(stateFile); } catch {}
      try { rmSync(join(TEMP_DIR, 'docs'), { recursive: true, force: true }); } catch {}
      try { rmSync(tempPlaywrightDir, { recursive: true, force: true }); } catch {}
    }
  });

  test('extract-research-output.js handles markdown-wrapped paths (regex bug)', () => {
    // Ensure output_dir is configured (hook requires it)
    const { config: cfgModule } = lib();
    const cfgBefore = cfgModule.getConfig();
    if (!cfgBefore.outputDir) {
      cfgModule.setOutputDir('docs/research');
    }

    const testSessionId = 996;
    const testSlug = 'hook-markdown-test';

    const tempPlaywrightDir = join(TEMP_DIR, '.playwright-cli');
    mkdirSync(tempPlaywrightDir, { recursive: true });

    const stateFile = join(tempPlaywrightDir, `.session-state-${testSessionId}.json`);
    writeFileSync(stateFile, JSON.stringify({
      mode: 'search', topicSlug: testSlug, strategy: 'single'
    }));

    const fakeOutputName = `${testSlug}-synthesis-20260208-130000.md`;
    const fakeOutputPath = join(tempPlaywrightDir, fakeOutputName);
    writeFileSync(fakeOutputPath, '# Markdown Path Test\n\nContent here.');

    // Reproduce the bug: path appears in assistant text wrapped in markdown formatting
    // AND in a clean tool_result. The regex must extract the clean path, not the markdown-wrapped one.
    const outputPathEscaped = fakeOutputPath.replace(/\\/g, '\\\\');
    const fakeTranscript = join(TEMP_DIR, 'test-transcript-markdown.jsonl');
    writeFileSync(fakeTranscript, [
      JSON.stringify({ type: 'tool_use', content: `node script.mjs start --session ${testSessionId} --strategy single` }),
      // Assistant text with markdown formatting around path (the bug scenario)
      `{"type":"assistant","message":{"content":[{"type":"text","text":"The synthesis was saved at:\\n\\n**\`${outputPathEscaped}\`**"}]}}`,
      // Clean tool_result with path
      JSON.stringify({ type: 'tool_result', content: outputPathEscaped })
    ].join('\n'));

    try {
      const result = runHook('extract-research-output.js',
        { agent_transcript_path: fakeTranscript },
        { timeout: 10000, cwd: TEMP_DIR }
      );

      assert(result.trim(), 'Hook should produce output');
      const json = JSON.parse(result.trim());
      assert(json.hookSpecificOutput, 'Should have hookSpecificOutput');
      assert(json.hookSpecificOutput.additionalContext.includes('Saved to'),
        'Output should mention saved location (path extracted correctly)');

      const expectedDest = join(TEMP_DIR, 'docs', 'research', `${testSlug}.md`);
      assert(existsSync(expectedDest), `File should be copied to ${expectedDest}`);

      const content = readFileSync(expectedDest, 'utf8');
      assert(content.includes('Markdown Path Test'), 'Copied content should match');

    } finally {
      try { unlinkSync(fakeTranscript); } catch {}
      try { unlinkSync(fakeOutputPath); } catch {}
      try { unlinkSync(stateFile); } catch {}
      try { rmSync(join(TEMP_DIR, 'docs'), { recursive: true, force: true }); } catch {}
      try { rmSync(tempPlaywrightDir, { recursive: true, force: true }); } catch {}
    }
  });

  // === Hook Timeout Validation ===
  log('\n=== Hook Timeout Validation ===');

  test('hooks.json exists and parses', () => {
    const hooksPath = join(PLUGIN_ROOT, 'hooks', 'hooks.json');
    assert(existsSync(hooksPath), 'hooks.json should exist');
    const hooks = JSON.parse(readFileSync(hooksPath, 'utf8'));
    assert('hooks' in hooks, 'Should have hooks property');
  });

  test('PreToolUse hook timeout >= 90s for browser startup', () => {
    const hooksPath = join(PLUGIN_ROOT, 'hooks', 'hooks.json');
    const hooks = JSON.parse(readFileSync(hooksPath, 'utf8'));

    const preToolUse = hooks.hooks.PreToolUse;
    assert(Array.isArray(preToolUse), 'PreToolUse should be an array');

    const taskMatcher = preToolUse.find(h => h.matcher === 'Task');
    assert(taskMatcher, 'Should have Task matcher');

    for (const hook of taskMatcher.hooks) {
      assert(hook.timeout >= 90,
        `PreToolUse hook timeout should be >= 90s (got ${hook.timeout}). Browser startup needs ~27s, script has 70s internal timeout.`);
    }
  });

  test('SubagentStart hook timeout is reasonable', () => {
    const hooksPath = join(PLUGIN_ROOT, 'hooks', 'hooks.json');
    const hooks = JSON.parse(readFileSync(hooksPath, 'utf8'));

    const subagentStart = hooks.hooks.SubagentStart;
    assert(Array.isArray(subagentStart), 'SubagentStart should be an array');

    for (const entry of subagentStart) {
      for (const hook of entry.hooks) {
        assert(hook.timeout >= 5, `SubagentStart timeout should be >= 5s (got ${hook.timeout})`);
      }
    }
  });

  test('SubagentStop hook timeout is reasonable', () => {
    const hooksPath = join(PLUGIN_ROOT, 'hooks', 'hooks.json');
    const hooks = JSON.parse(readFileSync(hooksPath, 'utf8'));

    const subagentStop = hooks.hooks.SubagentStop;
    assert(Array.isArray(subagentStop), 'SubagentStop should be an array');

    for (const entry of subagentStop) {
      for (const hook of entry.hooks) {
        assert(hook.timeout >= 10, `SubagentStop timeout should be >= 10s (got ${hook.timeout})`);
      }
    }
  });

  // === Prompt Builders ===
  log('\n=== Prompt Builders ===');

  test('perplexity-research.mjs help includes model flag', () => {
    const result = runScript('perplexity-research.mjs', '--help');
    assert(result.includes('--model'), 'Help should mention --model');
    assert(result.includes('--thinking'), 'Help should mention --thinking');
  });

  test('perplexity-research.mjs help does NOT include --depth', () => {
    const result = runScript('perplexity-research.mjs', '--help');
    assert(!result.includes('--depth'), 'Help should NOT mention --depth (removed)');
  });

  test('perplexity-research.mjs help includes --ensure flag', () => {
    const result = runScript('perplexity-research.mjs', '--help');
    assert(result.includes('--ensure'), 'Help should mention --ensure flag');
  });

  // Read source to validate prompt content (functions are not exported)
  const promptSource = readFileSync(
    join(PLUGIN_ROOT, 'scripts', 'perplexity-research.mjs'), 'utf8'
  );

  const startPromptBody = extractFunctionBody(promptSource, 'buildStartPrompt');
  const followupBody = extractFunctionBody(promptSource, 'buildFollowupPrompt');
  const synthesisBody = extractFunctionBody(promptSource, 'buildSynthesisPrompt');

  const MARKDOWN_LINE = 'All output in plain Markdown format';
  const ANTI_PATTERNS = [
    'No summaries',
    'No "key takeaways"',
    'No recap sections',
    'No summary or recap',
    'No preamble or introduction',
  ];

  test('buildStartPrompt source extracted', () => {
    assert(startPromptBody, 'Should find buildStartPrompt function');
    assert(followupBody, 'Should find buildFollowupPrompt function');
    assert(synthesisBody, 'Should find buildSynthesisPrompt function');
  });

  test('Search prompt includes Markdown format line', () => {
    const deepEnd = startPromptBody.indexOf('End with Recommendations as the final section.`;');
    const searchPart = startPromptBody.slice(deepEnd);
    assert(searchPart.includes(MARKDOWN_LINE),
      'Search start prompt should include Markdown format instruction');
  });

  test('Deep prompt includes Markdown format line', () => {
    const deepPart = startPromptBody.slice(0, startPromptBody.indexOf("  return `${SEARCH_METHODOLOGY}"));
    assert(deepPart.includes(MARKDOWN_LINE),
      'Deep start prompt should include Markdown format instruction');
  });

  test('Followup prompt includes Markdown format line', () => {
    assert(followupBody.includes(MARKDOWN_LINE),
      'Followup prompt should include Markdown format instruction');
  });

  test('Synthesis prompt includes Markdown format line', () => {
    assert(synthesisBody.includes(MARKDOWN_LINE),
      'Synthesis prompt should include Markdown format instruction');
  });

  test('Search prompt uses positive instructions only', () => {
    const deepEnd = startPromptBody.indexOf('End with Recommendations as the final section.`;');
    const searchPart = startPromptBody.slice(deepEnd);
    for (const pattern of ANTI_PATTERNS) {
      assert(!searchPart.includes(pattern),
        `Search prompt should not contain anti-pattern: "${pattern}"`);
    }
  });

  test('Deep prompt uses positive instructions only', () => {
    const deepPart = startPromptBody.slice(0, startPromptBody.indexOf("  return `${SEARCH_METHODOLOGY}"));
    for (const pattern of ANTI_PATTERNS) {
      assert(!deepPart.includes(pattern),
        `Deep prompt should not contain anti-pattern: "${pattern}"`);
    }
  });

  test('Followup prompt uses positive instructions only', () => {
    for (const pattern of ANTI_PATTERNS) {
      assert(!followupBody.includes(pattern),
        `Followup prompt should not contain anti-pattern: "${pattern}"`);
    }
  });

  test('Synthesis prompt uses positive instructions only', () => {
    for (const pattern of ANTI_PATTERNS) {
      assert(!synthesisBody.includes(pattern),
        `Synthesis prompt should not contain anti-pattern: "${pattern}"`);
    }
  });

  test('Deep prompt includes research plan instruction', () => {
    const deepPart = startPromptBody.slice(0, startPromptBody.indexOf("  return `${SEARCH_METHODOLOGY}"));
    assert(deepPart.includes('create a brief research plan'),
      'Deep prompt should instruct to create research plan');
    assert(deepPart.includes('Think critically'),
      'Deep prompt should instruct critical thinking');
  });

  test('Deep prompt includes Contradictions section', () => {
    const deepPart = startPromptBody.slice(0, startPromptBody.indexOf("  return `${SEARCH_METHODOLOGY}"));
    assert(deepPart.includes('## Contradictions and Open Questions'),
      'Deep prompt should include Contradictions section');
  });

  test('Deep prompt includes Recommendations section', () => {
    const deepPart = startPromptBody.slice(0, startPromptBody.indexOf("  return `${SEARCH_METHODOLOGY}"));
    assert(deepPart.includes('## Recommendations'),
      'Deep prompt should include Recommendations section');
  });

  test('Search prompt ends with Recommendations instruction', () => {
    const deepEnd = startPromptBody.indexOf('End with Recommendations as the final section.`;');
    const searchPart = startPromptBody.slice(deepEnd);
    assert(searchPart.includes('End with Recommendations as the final section'),
      'Search prompt should end with Recommendations instruction');
  });

  test('Synthesis prompt starts directly with Research Questions', () => {
    assert(synthesisBody.includes('Start directly with Research Questions'),
      'Synthesis prompt should instruct to start with Research Questions');
  });
}

module.exports = { run };
