# Changelog

Hermit's version is set in `packages/core/src/version.js` and shown by
`hermit doctor` and `hermit --version`. Bump it in the change that ships the
work: patch for fixes and maintenance, minor for a backward-compatible feature,
major for a breaking change to the CLI, the MCP tools, or the gate/artifact/
pipeline contracts.

## 1.5.0

- Jira tracker agent (HERMIT-23).
  - New `jira-tracker` agent owns the `tracker` stage and is the only agent
    that creates or moves Jira items. It creates Tasks and Subtasks only. The
    Jira server refuses any other issue type, requires a parent on a Subtask and
    forbids one on a Task. New `jira_link_issues` tool; `jira_create_issue` and
    `jira_create_subtasks` take acceptance criteria and a definition of done.
  - `story-writer` now only refines an existing story and owns no stage.
    `planner`, `qa`, the implementers and the orchestrator no longer hold Jira
    create or transition tools. QA lists unfixed defects under
    `## Unfixed Defects`; the tracker raises them as Tasks.
  - The tracker stage turns on for a run with a Jira key, or when the intent
    names the Jira tracker (`update jira`, `keep jira updated`). A skip wins.
  - Status sync: after each step the engine computes the ticket's target status
    and `hermit_next_task` returns `tracker_sync` until the new
    `hermit_ack_tracker_sync` clears it. The workflow is treated as a graph, so a
    target is a path. UAT leaves for Done only when QA passed and the delivery
    sign-off was approved. Configure with `jira.statusMap`, `jira.workflow`,
    `jira.fields`, `jira.linkType`.
  - New `not_matches` exit criterion. The `story-map` exit criteria now fail if
    it lists an Epic, Story, Bug or Feature as created.
  - New checks: `npm run check:jira`, `npm run check:tracker`.
  - Needs doing in Jira: publish the new workflow and add `Code Review` to `UAT`.

## 1.4.0

- Onboarding context scoped per role (HERMIT-22), the other half of the
  oversized-brief problem from 1.3.0.
  - `project-context` is sliced to the sections a consuming role uses
    (`artifact-sections.js`): the analyst gets Purpose / External Dependencies /
    Ownership / Known Constraints / Confidence & Gaps, the architect gets the
    build-side sections, and so on. Purpose and Confidence & Gaps go to
    everyone; an unmapped agent gets the whole document. The slice names what
    it dropped and points at `hermit_get_artifact project-context`.
  - The glossary is no longer inlined. The brief carries a `## Glossary` index
    of term names only; the new read-only `hermit_glossary_lookup { term }`
    returns a definition and its code identifier (omit `term` to list all).
  - Onboarding playbook: glossary entries must be one term per line.
  - Net, with 1.3.0: the forms-app requirements brief drops from ~51 KB to
    ~16–18 KB.

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
