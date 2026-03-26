---
name: perplexity-research
description: Research via Perplexity automation. Triggers on research, investigate, find out, look up, deep dive, fact-check, or any web research need. Confirms scope, mode (search vs deep), and strategy with the user when unclear. Deep mode is single-prompt only — plan carefully.
user-invocable: true
version: 1.0.0
---

# Perplexity Research - Scope Discussion

This skill helps you discuss and define research scope with the user before delegating to `perplexity-research:research-agent` for execution.

**Your role:** Interactive scope discussion, orchestrate handoff, wait for completion, and save the final research document.

## Workflow

1. Discuss topic with user
2. Propose research scope + get confirmation (ONE AskUserQuestion with BOTH scope and strategy)
3. **Create task list** (prevents stopping midway)
4. Hand off to research-agent(s)
5. Wait for agents, collect outputs
6. Create final research document

## Step 1: Understand the Topic

Ask clarifying questions if needed:
- What specific aspect to focus on?
- What's the end goal of this research?
- Any constraints or preferences?

**If config `default_model` is `dynamic`:** Read `references/model-selection.md` to choose the optimal model and thinking mode for this research topic.

## Step 2: Propose Research Scope + Get Confirmation

First, present the proposed scope to the user:

**Scope elements to present:**
- **Topic:** {derived topic}
- **TopicSlug:** {lowercase-hyphens}
- **Research Questions:** 1. {Q1}, 2. {Q2}
- **Context for Perplexity:** {Background, current state, problem, success criteria}
- **Mode:** search or deep
- **Model:** {model slug} + **Thinking:** {on/off}
- **Sources:** web | academic | social
- **Recommended strategy:** Single or Parallel ({N} agents)

Use AskUserQuestion to confirm scope and strategy with the user.

### Reference: Mode Guide

| Mode | Description | When to Use |
|------|-------------|-------------|
| **search** | Iterative research with follow-ups and synthesis | Most queries — focused questions, comparisons, follow-up chains |
| **deep** | Autonomous multi-step pipeline, single prompt | Complex topics needing comprehensive analysis — plan prompt carefully |

**Deep mode guidance:** Deep accepts a single prompt only — no follow-ups or synthesize. Craft the question to cover all aspects upfront. The agent does start → download → close. For iterative exploration, use search mode.

### Reference: Context Template

| Section | Required | Description |
|---------|----------|-------------|
| **Background** | Yes | What's being built/done, what problem it solves |
| **Current State** | Yes | What exists, what's working, setup/architecture in place |
| **The Problem** | Yes | The specific issue to improve or solve |
| **Success Criteria** | Yes | What a good solution looks like |
| Stack / Setup | Optional | Tech stack, tools, platforms |
| What We've Tried | Optional | Approaches attempted that didn't work |

### Reference: Question Examples

**Quick (search):** `What are the main approaches for cross-platform Node.js process management?`

**Focused (search):** `Best practices for improving sql.js write performance? Focus on WAL mode, batch operations, async patterns.`

**Comprehensive (deep):** `Comprehensive comparison of auth approaches (Auth0, Clerk, NextAuth) for multi-tenant SaaS with SSO. Include cost, migration complexity, vendor lock-in.`

### Reference: Source Types

| Source | When to Use |
|--------|-------------|
| **web** | Default, most queries |
| **academic** | Scientific claims, research validation |
| **social** | Practical advice, real-world experiences |

### Reference: Strategy Options

| Approach | When to Use |
|----------|-------------|
| **Single** | One coherent topic, questions build on each other |
| **Parallel** | Multiple independent topics, breadth needed quickly |

**Parallel Limit:** Maximum 10 concurrent agents (sessions 0-9).

### Reference: Browser by Platform

| Platform | Default Browser | Notes |
|----------|----------------|-------|
| Windows | msedge | Pre-installed |
| macOS | chrome | Install Chrome or use `--browser chromium` |
| Linux | chrome | Install Chrome or use `--browser chromium` |

## Step 3: Create Task List

Create ONE task to track the overall research workflow (agents manage their own sub-tasks internally):

```
TaskCreate: "Complete Perplexity research: {topic}" — covers spawn, wait, save, present
```

## Step 4: Hand Off to Research Agent

Spawn `perplexity-research:research-agent` via Task tool with `run_in_background: true`.

### Task Tool Parameters (MANDATORY FORMAT)

Every agent MUST be spawned with these exact Task tool parameters:

```
Task tool parameters:
- subagent_type: "perplexity-research:research-agent"
- run_in_background: true
- description: "Research {short topic}"
- prompt: |
    Question: {research question}

    Context: {background, current state, problem, success criteria}

    Mode: {search|deep}
    Model: {best|sonar|gpt-5.4|...}
    Thinking: {true|false}
    TopicSlug: {lowercase-hyphens}
    Session: {N}
    Strategy: {single|parallel}
    Sources: {web|academic|social}
```

**Session assignment:** Agent 1 → Session: 0, Agent 2 → Session: 1, Agent 3 → Session: 2, etc. Each agent MUST have a unique session number. Never reuse session numbers across parallel agents.

### Single Agent

Use Session: 0, Strategy: single. For deep mode, the agent does: start → download → close (no follow-ups).

### Parallel Agents

**CRITICAL: Spawn ALL agents in a SINGLE message with multiple parallel Task tool calls.** Do NOT launch sequentially — send all Task calls at once. Each agent gets a unique Session number (0-9, max 10).

## Step 5: Wait for Agents and Collect Outputs

**All agents run in background.** Use TaskOutput to wait for each agent:

```json
{
  "name": "TaskOutput",
  "input": {
    "task_id": "{agent_task_id}",
    "block": true,
    "timeout": 600000
  }
}
```

**Timeout:** 600000ms = 10 minutes. Deep research takes 3-5 minutes for the Perplexity query alone, plus download and close. If agent is still running after timeout, call TaskOutput again to continue waiting — do NOT abandon it.

**Agent output format:** Each agent returns one file path:
- No follow-ups: `.playwright-cli/{topicslug}-response-{timestamp}.md`
- Follow-ups done: `.playwright-cli/{topicslug}-synthesis-{timestamp}.md`

## Step 6: Save Final Research Document

Read the configured output directory from preflight: `ppx-research setup preflight` → `config.outputDir`. Ensure the directory exists in the project.

### Single Agent Output

The SubagentStop hook automatically copies single-agent output to `{outputDir}/{topic-slug}.md` (configured directory) and injects the saved file path into your context as `additionalContext`.

**If you see the `additionalContext` with the saved path:** The file is already saved — verify it exists and present results.

**If no `additionalContext` appears (fallback):**
1. Read the file path from agent output
2. Read the file content
3. Write to `{project}/{outputDir}/{topic-slug}.md`

### Parallel Agent Output

Multiple agents produced separate outputs. Synthesize into one document.

1. Read ALL returned file paths
2. Read each file's content
3. Create `{project}/{outputDir}/{topic-slug}.md` using this template:

```markdown
# Research: {Topic Title}

**Created:** {YYYY-MM-DD}
**Approach:** Parallel ({N} agents)

---

## Problem Statement

{The question or problem that prompted this research}

---

## Solutions Researched

### {Solution/Approach 1}

{Findings from Perplexity}

**Why this works:** {Brief rationale}

### {Solution/Approach 2}

{Findings}

**Why this works:** {Brief rationale}

---

## For Discussion

| Approach | Pros | Cons | Best When |
|----------|------|------|-----------|
| {Solution 1} | {pros} | {cons} | {use case} |

**Open questions:**
- {Question that needs team input}

---

## Perplexity Output Files

- `.playwright-cli/{filename}.md`
```

Synthesize findings from ALL agents into coherent sections. Group related findings, identify patterns across sources, note contradictions.

## Step 7: Present Results to User

Present final output:

```
**Research Complete: {topic}**

**Saved:** `{project}/{outputDir}/{topic-slug}.md`

**Approach:** {Single | Parallel ({N} agents)}

**TL;DR:**
- {Key finding 1}
- {Key finding 2}
- {Key finding 3}

**For Discussion:**
- {Key trade-off or decision point}

Ready to discuss findings or dive deeper into any area.
```

**TaskUpdate:** Mark the research task `completed`. Workflow complete.

## Prerequisites

- Playwright CLI installed (`npm install -g @playwright/cli@latest`)
- Pre-logged-in Perplexity sessions
- Run `/perplexity-setup` if not configured
