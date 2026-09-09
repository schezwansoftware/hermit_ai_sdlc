# Changelog

Hermit's version is set in `packages/core/src/version.js` and shown by
`hermit doctor` and `hermit --version`. Bump it in the change that ships the
work: patch for fixes and maintenance, minor for a backward-compatible feature,
major for a breaking change to the CLI, the MCP tools, or the gate/artifact/
pipeline contracts.

## 1.3.0

- Stage brief size (HERMIT-21): `hermit_next_task` briefs were exceeding the
  host tool-result limit (~50 KB), forcing a spill-to-file every stage. The
  knowledge/skill packs were ~half of that, byte-identical every time.
  - Packs are now inlined only while small (≤ 2 KB) and under a combined 8 KB
    budget; anything larger is delivered as a one-line pointer under
    `## Reference guides` and fetched on demand.
  - New read-only `hermit_get_pack { name }` returns one pack's full text, for
    hosts without file access to `.hermit/skills` / `.hermit/knowledge`.
  - `renderBundle` reordered: tool scope, the exit-criteria checklist and the
    required-output contract now render before the bulky context and reference
    material, so a truncating host drops re-fetchable prose, not the contract.
  - HERMIT-9's context-audit note de-duplicated across `pipeline-map` and
    `handoff-protocol`.
  - Net: the forms-app requirements brief drops from ~51 KB to ~27 KB.

## 1.2.0

- Pre-stage context audit (HERMIT-9): architecture, planning, both
  implementation stages and low-fidelity UX open their brief with a short
  `did you read X, did you check Y` checklist. The agent answers it through the
  new `hermit_context_audit` tool; `hermit_request_handoff` is refused until
  every applicable item has an answer. An item answered `confirmed: false` with
  a note is a recorded, surfaced gap — not a blocker. Answers and flagged gaps
  are journalled (`context.audited`) and grouped per attempt by `hermit_trace`;
  `auditFindingsSummary()` aggregates gap rates across runs for the feedback
  loop on which checks earn their place.

## 1.1.0

- Plain-language approval gates (HERMIT-18): every gated stage carries a `plain`
  explanation of what approving it means, and the gate message leads with it.
- Provisional gate approvals (HERMIT-7): an approver may attach a confidence
  level (60/80/95) and a list of assumptions; downstream briefs carry the caveat.
- `hermit doctor` now reports the running Hermit version; added `hermit version`
  / `hermit --version`.

## 1.0.0

Baseline — everything shipped through PR #26: the SDLC pipeline and HITL gates,
context scoping, onboarding and security baselines, the workflow/Jira/Confluence/
SCM MCP servers, specialist routing, mid-run scope narrowing, and the agent
thinking trace.
