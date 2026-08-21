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

## What not to do

- No `TBD`, `???`, or `[fill in]`. The pipeline rejects some of these outright, and the rest become somebody's incorrect guess two stages later.
- Do not restate an upstream artifact. Cite it. Duplication drifts.
- Do not pad. A short complete artifact beats a long hedged one, and reviewers skim long artifacts, which is where real problems hide.
- Do not bury bad news. Failures, gaps and risks go where a skimming reviewer will see them, not in a closing paragraph.

## Length

Aim for the shortest document that is complete. Context budgets are finite and shared: everything you write is read by every downstream agent that has your artifact in scope.
