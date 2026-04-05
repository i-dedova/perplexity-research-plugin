/**
 * research-prompts.js - Prompt templates for Perplexity research queries
 *
 * Handles:
 * - Search mode prompt construction
 * - Deep research prompt construction
 * - Follow-up and synthesis prompts
 *
 * Pure functions with zero dependencies.
 */

//region Constants

const SEARCH_METHODOLOGY = `Before responding, create a brief research plan:
1. Identify the key aspects to investigate
2. For each aspect, consult multiple independent sources
3. Cross-validate findings — a claim supported by 3+ sources is a pattern; a single-source claim is anecdotal, flag it as such

Focus on depth and reliability over speed. Prioritize:
- Authoritative, primary sources over secondary summaries
- Patterns confirmed across multiple sources over one-off claims
- Contradictions between sources — flag these explicitly
- Practical, actionable findings over theoretical overviews`;

//endregion

//region Builders

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

module.exports = {
  SEARCH_METHODOLOGY,
  buildStartPrompt,
  buildFollowupPrompt,
  buildSynthesisPrompt
};
