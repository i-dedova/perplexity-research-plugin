---
name: perplexity-research
description: Research via Perplexity automation. REQUIRED before spawning research agents — confirms scope, mode, and strategy with user. Deep mode is single-prompt only.
argument-hint: [research-topic] or infer from conversation
allowed-tools: Read, Write, Edit, Bash, Task, TaskCreate, TaskUpdate, TaskList, AskUserQuestion
---

Arguments: $ARGUMENTS

---

Execute Perplexity research using the **`perplexity-research:perplexity-research`** skill.

**Mandatory requirements:**
1. Use TaskCreate/TaskUpdate to track all workflow steps (4 tasks)
2. Always close Perplexity sessions when done
3. Save final output to `{project}/docs/research/{topic-slug}.md`

If $ARGUMENTS is empty, infer research topic from conversation context.

Follow the complete workflow in the perplexity-research skill:
1. Propose scope and strategy → AskUserQuestion to confirm
2. Spawn research-agent(s) with confirmed parameters
3. Wait for completion, save final document (single: copy as-is, parallel: synthesize)
