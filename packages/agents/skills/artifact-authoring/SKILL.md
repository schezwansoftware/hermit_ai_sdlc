---
name: artifact-authoring
description: How to write Hermit artifacts so downstream agents and human reviewers can both use them.
metadata:
  hermit: true
  title: Artifact authoring
---

Artifacts are read by two audiences with opposite needs: a human skimming at a gate, and an agent parsing for specifics. Serve both.

## Structure

- Use the **exact headings** your output contract names. Exit criteria match them literally — `## Component Map` is not `## Components`.
- Lead each section with the conclusion, then the detail. A reviewer at a gate reads the first line of each section and nothing else if it seems fine.
- Tables for anything enumerable. Prose for anything requiring judgement.
- Stable ids for everything cross-referenced: `FR-1`, `AC-3`, `WP-2`, `ADR-4`. Downstream agents cite these; renumbering breaks traceability.

## Evidence

Every factual claim carries a source: a file path, a `file:line`, a Confluence page id, a tracker key, or a command and its output. A claim you cannot source belongs under assumptions or gaps, clearly marked.

Distinguish these three, always:

- **Observed** — you read it, ran it, or saw it.
- **Inferred** — a reasonable deduction. Say what it rests on.
- **Assumed** — you decided because nobody had. Human gates exist mainly to catch these.

## `## In Plain Terms` — required on every gated artifact

If your stage stops for a human approval (requirements, architecture, the UX stages, a tracker-linked plan, security with a major upgrade, review, delivery), the primary artifact must contain a `## In Plain Terms` section, and the pipeline rejects the handoff without it.

Write it for a reader who is **not an engineer** — a product owner, a manager, the person whose name is on the release:

- Explain what this document actually proposes or concludes, and what it means in practice — not a one-line label. For an architecture spec: which parts of the system change, what the notable trade-offs were and why you chose them, what could go wrong, what stays the same. Several short paragraphs or a bulleted walkthrough, not a sentence.
- No jargon without a plain gloss. "We'll add a database migration (a one-time change to the data's structure, reversible by …)".
- Say plainly what approving commits them to and what is hard to undo afterwards.
- It is a summary of the rest of the document — never the only place a fact appears.

## What not to do

- No `TBD`, `???`, or `[fill in]`. The pipeline rejects some of these outright, and the rest become somebody's incorrect guess two stages later.
- Do not restate an upstream artifact. Cite it. Duplication drifts.
- Do not pad. A short complete artifact beats a long hedged one, and reviewers skim long artifacts, which is where real problems hide.
- Do not bury bad news. Failures, gaps and risks go where a skimming reviewer will see them, not in a closing paragraph.

## Length

Aim for the shortest document that is complete. Context budgets are finite and shared: everything you write is read by every downstream agent that has your artifact in scope.
