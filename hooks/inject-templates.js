#!/usr/bin/env node
/**
 * SubagentStart hook - injects prompt templates and plugin path into research-agent context
 */

const { join } = require('path');

const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT || join(__dirname, '..');
const { config } = require(join(PLUGIN_ROOT, 'scripts', 'lib'));

// Inlined prompt templates (no file read needed)
const PROMPT_TEMPLATES = `## Context Template

| Section | Required | Description |
|---------|----------|-------------|
| **Background** | Yes | What's being built/done, what problem it solves |
| **Current State** | Yes | What exists, what's working, setup/architecture in place |
| **The Problem** | Yes | The specific issue to improve or solve |
| **Success Criteria** | Yes | What a good solution looks like |
| Stack / Setup | Optional | Tech stack, tools, platforms |
| What We've Tried | Optional | Approaches attempted that didn't work |

## Question Examples

**Quick (search):** What are the main approaches for {topic}?
**Focused (search):** Best practices for {specific area}? Focus on {aspects}.
**Comprehensive (deep):** Comprehensive comparison of {options} for {use case}. Include cost, complexity, trade-offs.

## Source Types

| Source | When to Use |
|--------|-------------|
| **web** | Default, most queries |
| **academic** | Scientific claims, research validation |
| **social** | Practical advice, real-world experiences |`;

function main() {
  const browserConfig = config.getBrowser();

  // Build context to inject - includes resolved plugin path for scripts
  const additionalContext = `
## Plugin Paths (auto-injected)

Scripts path: ${PLUGIN_ROOT}/scripts
Use: node "${PLUGIN_ROOT}/scripts/perplexity-research.mjs" <command>
Alias (if available): ppx-research <command>

## Prompt Templates (auto-injected)

${PROMPT_TEMPLATES}

## Configuration

Browser: ${browserConfig}
Default Model: ${config.getDefaultModel()}
Default Thinking: ${config.getDefaultThinking()}
Subscription Tier: ${config.getSubscriptionTier()}
`.trim();

  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SubagentStart",
      additionalContext: additionalContext
    }
  }));
}

main();
