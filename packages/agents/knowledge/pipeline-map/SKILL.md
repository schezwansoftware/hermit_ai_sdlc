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
| 1 | `requirements` | analyst | **human** | `project-context`, `glossary` | `requirements-spec`, `acceptance-criteria` |
| 2 | `architecture` | architect | **human** | `requirements-spec`, `acceptance-criteria`, `codebase-map`, `project-context` | `architecture-spec`, `adr`, `impact-analysis` |
| 3 | `ux_lofi` | ux-designer | **human** | `requirements-spec`, `acceptance-criteria`, `architecture-spec`, `project-context` | `ux-lofi` |
| 4 | `ux_midfi` | ux-designer | **human** | `ux-lofi`, `requirements-spec`, `architecture-spec` | `ux-midfi` |
| 5 | `ux_hifi` | ux-designer | **human** | `ux-midfi`, `requirements-spec`, `architecture-spec` | `ux-hifi`, `design-tokens` |
| 6 | `planning` | planner | auto² | `architecture-spec`, `acceptance-criteria`, `impact-analysis`, `ux-hifi` | `work-plan` |
| 7 | `tracker` ᴼ | story-writer | auto | `work-plan`, `acceptance-criteria`, `requirements-spec`, `architecture-spec`, `impact-analysis` | `story-map` |
| 8 | `implementation_ui` | implementer¹ | auto | `work-plan`, `architecture-spec`, `acceptance-criteria`, `ux-hifi`, `design-tokens` | `change-set-ui` |
| 9 | `implementation_backend` | implementer¹ | auto | `work-plan`, `architecture-spec`, `acceptance-criteria`, `change-set-ui` | `change-set` |
| 10 | `security` ᴼ | security | auto³ | `change-set`, `change-set-ui`, `architecture-spec`, `dependency-map`, `security-baseline` | `cve-report` |
| 11 | `review` | reviewer | **human** | `change-set`, `change-set-ui`, `architecture-spec`, `acceptance-criteria`, `work-plan` | `review-report` |
| 12 | `qa` | qa | auto | `change-set`, `change-set-ui`, `acceptance-criteria`, `review-report` | `test-plan`, `test-report` |
| 13 | `documentation` | documenter | auto | `change-set`, `change-set-ui`, `requirements-spec`, `architecture-spec`, `adr`, `test-report`, `project-context` | `docs-update` |
| 14 | `delivery` | orchestrator | **human** | `change-set`, `change-set-ui`, `review-report`, `test-report`, `requirements-spec`, `docs-update` | `release-notes` |
| 15 | `pull_request` | orchestrator | auto | `release-notes`, `change-set`, `change-set-ui`, `review-report`, `test-report`, `docs-update` | `pull-request` |

ᴼ **Off unless the run asks for it.** Stages 7 and 10 are skipped by default. They
turn on when the intent says so — "and create the stories", "and run a security
scan" — or via `--with tracker,security`. Both do something outward-facing, so
running them unasked would be a surprise.

**Onboarding is not a stage.** `project-context`, `codebase-map` and `glossary` are mapped once for the repository by `hermit onboard`, stored in `.hermit/onboarding/`, and read by every run. Mapping a codebase is expensive and the answer barely changes between runs, so paying for it per run was a tax with no return. It is also opt-in — `hermit init` asks — so a run may legitimately have none of them: say which inputs are missing and work from the repository directly.

**Architecture precedes UX.** The architect settles the user flow, the services and the contracts; the designer draws screens against a ratified system. So `architecture-spec` must carry `## User Flow` whenever the work has an interface, and the architect never sees the designs — they do not exist yet.

**The security baseline is not a stage either.** `dependency-map` and `security-baseline` are produced once for the repository by `hermit security`, stored in `.hermit/security/`, and read by stage 10. They describe the repository rather than a change. The per-run question — is anything we depend on vulnerable *today* — is the stage, because that answer moves as advisories land.

**The interface is implemented before the services.** Stage 8 builds against the contract in `## Interfaces`, not against running code, and records anything the contract failed to promise under `## Contract Gaps`. Stage 9 reads that section first.

¹ **A specialist may take either implementation stage.** `ui-developer` takes stage 8 for frontend and mobile projects; `backend-developer` takes stage 9 for Python, Go, JVM and Node projects. Same stage, same inputs and outputs, same gate. The pipeline picks from the stacks recorded when the run started; no match leaves `implementer` in place. `hermit status` names whoever actually ran it.

² **Planning gates when stage 7 is on.** Creating an epic notifies a team, so the plan the epic comes from is approved first — the same reason the pull request follows delivery sign-off. With `tracker` off, planning is unattended.

³ **Security gates on `**Major upgrades**`.** The count in `cve-report` decides: zero and the stage advances unattended, non-zero and a human accepts the break risk before the run continues. Patch and minor fixes are applied without asking; a fix that only exists in a major version never is.

## What a run may stand down

Stages 3–5 and 8 are skipped when nothing in scope has a user interface, or the run carries the `no-ui` flag. Stage 9 is skipped only when the run is *nothing but* interface work — it is also the catch-all for infrastructure, libraries and anything unclassified.

Beyond that, the intent sentence can stand a stage down: `hermit start "add cart persistence, skip the UX designs and don't open a PR"`. The skippable stages are 3–10, 12 and 13.

**Stages 1, 2, 11 and 14 cannot be skipped by anything.** Requirements, architecture, review and delivery are refused with a reason if a prompt asks. A gate a sentence can dissolve is not a gate. If a user asks you to skip one, say plainly that it is not possible and why — do not look for another route, and do not treat the ledger's refusal as a bug to work around.

**Stage 15 runs only after stage 14's human gate approves.** A pull request notifies the team, so it is an outward-facing act that deliberately follows sign-off rather than preceding it.

## The traceability chain

This is what makes the pipeline auditable. Every link is checkable:

```
tracker issue
   └─ requirements-spec  FR-n
        └─ acceptance-criteria  AC-n  ──────────────┐
             └─ architecture-spec  component        │
                  └─ work-plan  WP-n                │
                       └─ story-map  tracker key    │   (when stage 7 runs)
                       └─ change-set(-ui)  files    │
                            └─ review-report  AC coverage table
                                 └─ test-report  AC verification ←┘
                                      └─ docs-update  documents corrected
                                           └─ release-notes
                                                └─ pull-request  URL
```

If you cannot trace your output back to an AC, you are building something nobody asked for. Say so rather than proceeding.

## Where humans decide

Seven always: requirements, architecture, all three UX fidelities, review, delivery. They cluster before expensive commitment — design before build, and build before release.

Two more open conditionally, and only when the condition holds: **planning**, when the run will create tracker items from the plan; **security**, when a vulnerability fix requires a major version bump. Both exist so the interruption lands only on the runs that need it.

A gate has three outcomes: **approve** (stage closes), **changes_requested** (the same agent runs again with the reviewer's comment attached), **reject** (run blocks; a human decides what happens).

No agent decides a gate on its own judgement. A decision is either a person running the CLI, or the orchestrator relaying one a human just gave it explicitly, in chat, through `hermit_decide_gate` — a tool no role agent has. If you are not the orchestrator and a gate is open, report it and stop; do not try to resolve it yourself.

## Re-entry

When a gate returns `changes_requested`, your next `hermit_next_task` includes `reviewerFeedback` with the comment. Address it explicitly. Resubmitting unchanged content wastes a full cycle and will be rejected again.
