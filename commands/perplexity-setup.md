---
name: perplexity-setup
description: One-time plugin setup
allowed-tools: Read, Edit, Bash, AskUserQuestion
---

# Perplexity Research Plugin Setup

Interactive setup wizard with smart detection of existing configuration.

---

## Step 1: Preflight Check

```bash
ppx-research setup preflight
```

Parse JSON output:
- `isComplete: true` → Jump to Completion message
- `missing` array → Run only those steps below

---

## Step 2: Install playwright-cli

**Skip if:** `playwrightCli.installed` is true

Use this exact command (the package is `@playwright/cli`, not `playwright-cli`):

```bash
npm install -g @playwright/cli@latest
```

After install, verify with `playwright-cli --version`.

---

## Step 3: Register CLI alias

**Always run** (even on re-setup — ensures alias exists after upgrades).

Use `${CLAUDE_PLUGIN_ROOT}` to find the plugin regardless of install method:

```bash
npm link --prefix "${CLAUDE_PLUGIN_ROOT}"
```

If `CLAUDE_PLUGIN_ROOT` is not set (manual install), use the direct path:
```bash
npm link --prefix ~/.claude/plugins/perplexity-research
```

Verify with `ppx-research --help`.

---

## Step 4: Browser Selection

**Skip if:** `config.browser` exists

Use AskUserQuestion:
- **Question:** "Which browser for Perplexity automation?"
- **Options:** MS Edge (Recommended), Chrome

Save:
```bash
ppx-research setup set-browser {msedge|chrome}
```

---

## Step 5: Model Selection Strategy

**Skip if:** `config.defaultModel` is already set in preflight JSON (user previously configured it)

Use AskUserQuestion:
- **Question:** "How should the AI model be chosen for research?"
- **Options:**
  - Claude decides dynamically (Recommended) — Selects optimal model per research topic using a decision matrix
  - Let Perplexity pick automatically — Uses Perplexity's "Best" auto-routing for all queries
  - I want to pick a default model — Always use one specific model

**If "Claude decides dynamically":** Save `dynamic` and move on.
**If "Let Perplexity pick":** Save `best`.
**If "Pick a specific model":**

Use AskUserQuestion:
- **Question:** "Which model should be the default?"
- **Options:** Sonar (broad surveys), GPT-5.4 (code/logic), Claude Sonnet 4.6 (nuanced analysis), Nemotron 3 Super (agentic/long-context)

**If chosen model has toggleable thinking** (GPT-5.4, Claude Sonnet 4.6):

Use AskUserQuestion:
- **Question:** "Enable thinking/reasoning by default?"
- **Options:** Off (Recommended), On

Save:
```bash
ppx-research setup set-model {value}
ppx-research setup set-thinking {value}
```

---

## Step 6: Cleanup Interval

**Skip if:** `config.cleanupDays` exists

Explain: "Temp files (logs, snapshots) are created during research. Your final output is saved separately."

Use AskUserQuestion:
- **Question:** "How often should temp files be cleaned?"
- **Options:** Every 7 days (Recommended), Every 3 days, Every 14 days, Custom

Save:
```bash
ppx-research setup set-cleanup {days}
```

---

## Step 7: Create Master Session

**Run if:** `master-session` in missing array OR user re-running setup
**Skip if:** `expired-pool` in missing but NOT `master-session` — master is still valid, jump to Step 8

1. Get browser from preflight (`config.browser`)

2. Open browser:
```bash
PLAYWRIGHT_CLI_SESSION=perplexity-pro playwright-cli open https://perplexity.ai --persistent --headed --browser {browser}
```

3. Tell user: "Log into Perplexity. Complete 2FA if required."

4. AskUserQuestion: "Have you finished logging in?"

5. Close session:
```bash
PLAYWRIGHT_CLI_SESSION=perplexity-pro playwright-cli close
```

---

## Step 8: Clone Session Pool

**Run if:** Step 7 was executed, OR `expired-pool` in missing array (pool expired but master valid)

```bash
ppx-research setup clone-pool
```

Validates master first, clones to 0-9, then validates each session individually (reads cookies, populates session-status.json).

---

## Step 9: CLAUDE.md Discoverability

**Always run** (even on re-setup). Read `~/.claude/CLAUDE.md` first.

Check if `perplexity-research` is already mentioned. If yes, skip this step.

If not mentioned, use AskUserQuestion:
- **Question:** "Add Perplexity Research instructions to your CLAUDE.md? This helps Claude recognize more research opportunities and reach for the plugin more readily."
- **Options:** Yes, add it (Recommended); No, skip

**If yes:**
1. Read `~/.claude/CLAUDE.md` to understand the existing structure
2. Find the best location (near tools, research, or core principles sections)
3. Use Edit to inject this snippet, adjusting phrasing to fit the surrounding structure while preserving the core content:

```
For research, investigation, comparisons, fact-checking, or when current information matters — use the `perplexity-research` skill to discuss scope with the user, or spawn `research-agent` directly when scope is clear. Perplexity defaults to the most recent sources. Parallel agents for independent topics.
```

---

## Completion

```bash
ppx-research setup check
```

Tell user:
```
Setup complete!

Use: /perplexity-research [topic]

Config: ~/.claude/perplexity/config.local.md
Edit that file to change browser, cleanup interval, or model settings.
```

---

## Re-running Setup

When `isComplete: true` but user runs setup anyway:
1. Ask if they want to refresh login (sessions expired)
2. If yes → Run Steps 7-8 only
3. If no → Show config file location

When `expired-pool` in missing (pool sessions expired, master still valid):
1. Skip Step 7 (no re-login needed)
2. Run Step 8 directly — clone-pool will overwrite expired sessions from valid master

When `master-session` in missing (master expired or missing):
1. clone-pool will first try to promote a valid pool session to master
2. If no valid pool sessions → Run Step 7 (re-login required) then Step 8
