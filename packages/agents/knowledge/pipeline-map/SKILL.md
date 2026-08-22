---
name: pipeline-map
description: 'The Hermit stage graph: who owns what, which artifacts flow where, and where humans decide.'
metadata:
  hermit: true
  title: Pipeline map
---

Shared reference for every agent. You own one box; this shows you the rest so you know what your output becomes.

## Stages

| # | Stage | Agent | Gate | Consumes | Produces |
|---|---|---|---|---|---|
| 1 | `onboard` | onboarding | auto | — | `project-context`, `codebase-map`, `glossary` |
| 2 | `requirements` | analyst | **human** | `project-context`, `glossary` | `requirements-spec`, `acceptance-criteria` |
| 3 | `architecture` | architect | **human** | `requirements-spec`, `acceptance-criteria`, `codebase-map`, `project-context` | `architecture-spec`, `adr`, `impact-analysis` |
| 4 | `ux_lofi` | ux-designer | **human** | `requirements-spec`, `acceptance-criteria`, `architecture-spec`, `project-context` | `ux-lofi` |
| 5 | `ux_midfi` | ux-designer | **human** | `ux-lofi`, `requirements-spec`, `architecture-spec` | `ux-midfi` |
| 6 | `ux_hifi` | ux-designer | **human** | `ux-midfi`, `requirements-spec`, `architecture-spec` | `ux-hifi`, `design-tokens` |
| 7 | `planning` | planner | auto | `architecture-spec`, `acceptance-criteria`, `impact-analysis`, `ux-hifi` | `work-plan` |
| 8 | `implementation_ui` | implementer¹ | auto | `work-plan`, `architecture-spec`, `acceptance-criteria`, `ux-hifi`, `design-tokens` | `change-set-ui` |
| 9 | `implementation_backend` | implementer¹ | auto | `work-plan`, `architecture-spec`, `acceptance-criteria`, `change-set-ui` | `change-set` |
| 10 | `review` | reviewer | **human** | `change-set`, `change-set-ui`, `architecture-spec`, `acceptance-criteria`, `work-plan` | `review-report` |
| 11 | `qa` | qa | auto | `change-set`, `change-set-ui`, `acceptance-criteria`, `review-report` | `test-plan`, `test-report` |
| 12 | `documentation` | documenter | auto | `change-set`, `change-set-ui`, `requirements-spec`, `architecture-spec`, `adr`, `test-report`, `project-context` | `docs-update` |
| 13 | `delivery` | orchestrator | **human** | `change-set`, `change-set-ui`, `review-report`, `test-report`, `requirements-spec`, `docs-update` | `release-notes` |
| 14 | `pull_request` | orchestrator | auto | `release-notes`, `change-set`, `change-set-ui`, `review-report`, `test-report`, `docs-update` | `pull-request` |

**Architecture precedes UX.** The architect settles the user flow, the services and the contracts; the designer draws screens against a ratified system. So `architecture-spec` must carry `## User Flow` whenever the work has an interface, and the architect never sees the designs — they do not exist yet.

**The interface is implemented before the services.** Stage 8 builds against the contract in `## Interfaces`, not against running code, and records anything the contract failed to promise under `## Contract Gaps`. Stage 9 reads that section first.

¹ **A specialist may take either implementation stage.** `ui-developer` takes stage 8 for frontend and mobile projects; `backend-developer` takes stage 9 for Python, Go and JVM projects. Same stage, same inputs and outputs, same gate. The pipeline picks from the stacks recorded when the run started; nothing to configure, and no match leaves `implementer` in place. `hermit status` names whoever actually ran it.

Stages 4–6 and 8 are skipped when nothing in scope has a user interface, or the run carries the `no-ui` flag. Stage 9 is skipped only when the run is *nothing but* interface work — it is also the catch-all for infrastructure, libraries and anything unclassified.

**Stage 14 runs only after stage 13's human gate approves.** A pull request notifies the team, so it is an outward-facing act that deliberately follows sign-off rather than preceding it.

## The traceability chain

This is what makes the pipeline auditable. Every link is checkable:

```
tracker issue
   └─ requirements-spec  FR-n
        └─ acceptance-criteria  AC-n  ──────────────┐
             └─ architecture-spec  component        │
                  └─ work-plan  WP-n                │
                       └─ change-set(-ui)  files    │
                            └─ review-report  AC coverage table
                                 └─ test-report  AC verification ←┘
                                      └─ docs-update  documents corrected
                                           └─ release-notes
                                                └─ pull-request  URL
```

If you cannot trace your output back to an AC, you are building something nobody asked for. Say so rather than proceeding.

## Where humans decide

Seven gates: requirements, all three UX fidelities, architecture, review, delivery. They cluster before expensive commitment — design before build, and build before release.

A gate has three outcomes: **approve** (stage closes), **changes_requested** (the same agent runs again with the reviewer's comment attached), **reject** (run blocks; a human decides what happens).

No agent can approve a gate. There is no tool for it.

## Re-entry

When a gate returns `changes_requested`, your next `hermit_next_task` includes `reviewerFeedback` with the comment. Address it explicitly. Resubmitting unchanged content wastes a full cycle and will be rejected again.
