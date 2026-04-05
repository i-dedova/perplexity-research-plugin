---
name: perplexity-setup
description: One-time Perplexity research plugin setup. Detects existing configuration and only runs missing steps. Use when sessions are expired, browser needs changing, or first-time setup.
user-invocable: true
version: 1.0.0
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

**If `platform` is `macos` AND steps 7 or 8 will run** (i.e., `master-session` or `expired-pool` in `missing` array, or `sessions.healthy` is false):

Tell the user: "Heads up — macOS will prompt you for a few permissions during setup. When the browser opens, your terminal app may need **Accessibility** access. During session cloning, the plugin minimizes browser windows using AppleScript, which requires **System Events** access. Allow both when prompted — they're one-time approvals that macOS requires for any app automating browsers."

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

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/install-alias.sh"
export PATH="$HOME/.claude/bin:$PATH"
```

Run both commands — the first creates the wrapper, the second makes it available immediately. Verify with `ppx-research --help`.

---

## Step 4: Browser Selection

**Skip if:** `config.browser` exists

Use AskUserQuestion:
- **Question:** "Which browser for Perplexity automation?"
- **Options (Windows):** MS Edge (Recommended), Chrome
- **Options (macOS/Linux):** Chrome (Recommended), MS Edge (if installed)

Check the preflight `platform` field to determine which options to show.

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

## Step 7: Output Directory

**Skip if:** `config.outputDir` exists in preflight JSON (not null)

Use AskUserQuestion:
- **Question:** "Where should research outputs be saved? Enter a folder name — it will be created inside each project directory. Nested paths like docs/research/perplexity are supported. Default: docs/research"

Save the user's answer (or `docs/research` if they accept the default):
```bash
ppx-research setup set-output-dir {value}
```

---

## Step 8: Create Master Session

**Before opening any browser**, tell the user: "A browser window will open for you to log into Perplexity. The plugin uses headed (visible) browser sessions because Perplexity's Cloudflare protection blocks headless automation."

**If `sessions.healthy` is true** (script-verified: master exists, cookies valid, pool complete):

Use AskUserQuestion:
- **Question:** "Your Perplexity sessions are already set up and authenticated. Do you want to re-login?"
- **Options:** Keep existing sessions (skip to Step 10), Re-login (new account or refresh)

**If "Keep":** Jump to Step 10.
**If "Re-login":** Continue below.

**If `sessions.healthy` is false:** Check `missing` array:
- `master-session` in missing → Run this step (login required)
- `expired-pool` in missing but NOT `master-session` → Master is valid, jump to Step 9

1. Get browser from preflight (`config.browser`)

2. Open browser:
```bash
playwright-cli -s=perplexity-pro open https://perplexity.ai --persistent --headed --browser {browser}
```

3. Tell user: "Log into Perplexity. Complete 2FA if required."

4. AskUserQuestion: "Have you finished logging in?"

5. Close session:
```bash
playwright-cli -s=perplexity-pro close
```

---

## Step 9: Clone Session Pool

**Run if:** Step 8 was executed, OR `expired-pool` in missing array (pool expired but master valid)

Before running the clone command, tell the user:

"Now I'll clone your login to 10 browser sessions and validate each one. This persists your authenticated Perplexity session so future research runs instantly without re-login, and enables up to 10 parallel research agents. You'll see browser windows opening and closing — that's normal. Each session opens the browser, navigates to Perplexity, checks the login cookie, and closes. This takes 2-3 minutes. Don't interact with the browser windows while this is running."

```bash
ppx-research setup clone-pool
```

Validates master first, clones to 0-9, then validates each session individually.

---

## Step 10: CLAUDE.md Discoverability

**Skip if:** `~/.claude/CLAUDE.md` does not exist, OR `perplexity-research` is already mentioned in it.

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
1. Show config file location
2. Only re-run Steps 8-9 if `master-session` or `expired-pool` is in missing array
3. Do NOT force re-login if sessions are healthy — the preflight determines this

When `expired-pool` in missing (pool sessions expired, master still valid):
1. Skip Step 8 (no re-login needed)
2. Run Step 9 directly — clone-pool will overwrite expired sessions from valid master

When `master-session` in missing (master expired or missing):
1. clone-pool will first try to promote a valid pool session to master
2. If no valid pool sessions → Run Step 8 (re-login required) then Step 9
