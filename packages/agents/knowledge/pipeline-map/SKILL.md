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
| 3 | `ux_lofi` | ux-designer | **human** | `requirements-spec`, `acceptance-criteria`, `project-context` | `ux-lofi` |
| 4 | `ux_midfi` | ux-designer | **human** | `ux-lofi`, `requirements-spec` | `ux-midfi` |
| 5 | `ux_hifi` | ux-designer | **human** | `ux-midfi`, `requirements-spec` | `ux-hifi`, `design-tokens` |
| 6 | `architecture` | architect | **human** | `requirements-spec`, `acceptance-criteria`, `codebase-map`, `ux-hifi` | `architecture-spec`, `adr`, `impact-analysis` |
| 7 | `planning` | planner | auto | `architecture-spec`, `acceptance-criteria`, `impact-analysis` | `work-plan` |
| 8 | `implementation` | implementer¹ | auto | `work-plan`, `architecture-spec`, `acceptance-criteria`, `ux-hifi` | `change-set` |
| 9 | `review` | reviewer | **human** | `change-set`, `architecture-spec`, `acceptance-criteria`, `work-plan` | `review-report` |
| 10 | `qa` | qa | auto | `change-set`, `acceptance-criteria`, `review-report` | `test-plan`, `test-report` |
| 11 | `documentation` | documenter | auto | `change-set`, `requirements-spec`, `architecture-spec`, `adr`, `test-report`, `project-context` | `docs-update` |
| 12 | `delivery` | orchestrator | **human** | `change-set`, `review-report`, `test-report`, `requirements-spec`, `docs-update` | `release-notes` |
| 13 | `pull_request` | orchestrator | auto | `release-notes`, `change-set`, `review-report`, `test-report`, `docs-update` | `pull-request` |

¹ **A specialist may take stage 8.** When the projects in scope are Python, Go or JVM server-side code, `backend-developer` implements instead of `implementer` — same stage, same inputs and outputs, same gate. The pipeline picks from the stacks recorded when the run started; nothing to configure, and no match leaves `implementer` in place. `hermit status` names whoever actually ran it.

Stages 3–5 are skipped entirely when the run carries the `no-ui` flag.

**Stage 13 runs only after stage 12's human gate approves.** A pull request notifies the team, so it is an outward-facing act that deliberately follows sign-off rather than preceding it.

## The traceability chain

This is what makes the pipeline auditable. Every link is checkable:

```
tracker issue
   └─ requirements-spec  FR-n
        └─ acceptance-criteria  AC-n  ──────────────┐
             └─ architecture-spec  component        │
                  └─ work-plan  WP-n                │
                       └─ change-set  files         │
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
