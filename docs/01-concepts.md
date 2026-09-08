# Hermit concepts

## The one distinction that matters

Hermit has exactly one orchestrator, and it is an **agent**.

| | Orchestrator agent | Workflow server (`@hermit/mcp-workflow`) |
|---|---|---|
| What it is | `agents/orchestrator.md` — a markdown agent | A Node MCP server |
| What it does | Decides who works next, dispatches, refuses to skip gates | Stores run state, artifacts, gate records; runs mechanical checks |
| Has judgment | Yes. This is the whole point. | No. It cannot choose anything. |
| Can be replaced by | A better prompt | A database |

The workflow server exists for one reason: **markdown cannot remember.** A run spans days, three Copilot surfaces (VS Code, CLI, IntelliJ), and multiple people. Something has to hold "we are at stage 6, the architecture gate is open, here are the seven artifacts produced so far" in a way all of them see identically. That something is a file on disk (`.hermit/runs/<id>/run.json`), and the MCP server is just the doorway to it.

If you deleted the MCP server, the orchestrator agent would still be the orchestrator — it would simply have amnesia between messages.

## Why state lives in a server rather than in the agent's context

Three practical reasons, in order of how much they hurt:

1. **Copilot's surfaces don't share memory.** A run started in VS Code must be resumable from the CLI. Context windows are per-session; a file is not.
2. **Gates need to be unfakeable.** If "approved" is a sentence in a transcript, a model can produce that sentence for itself. A signed record has to come from somewhere the model does not fully control — a person typing into the CLI, or the orchestrator calling `hermit_decide_gate` only after that same person, in that same conversation, told it what to decide and confirmed the call.
3. **Context scoping needs a chokepoint.** "Each agent fetches only its own context" is enforceable only if something outside the agent decides what it receives. An agent asked to ignore an artifact it can already see is being asked to forget, which is not a thing models do reliably.

## The cast

| Agent | Owns stage(s) | Produces |
|---|---|---|
| `orchestrator` | `delivery`, `pull_request` + supervises all | `release-notes`, `pull-request` |
| `onboarding` | *outside the pipeline* | `project-context`, `codebase-map`, `glossary` |
| `analyst` | `requirements` | `requirements-spec`, `acceptance-criteria` |
| `architect` | `architecture` | `architecture-spec`, `adr`, `impact-analysis` |
| `ux-designer` | `ux_lofi`, `ux_midfi`, `ux_hifi` | `ux-lofi`, `ux-midfi`, `ux-hifi`, `design-tokens` |
| `planner` | `planning` | `work-plan` |
| `story-writer` | `tracker` ○ | `story-map` |
| `implementer` | `implementation_ui`, `implementation_backend` | `change-set-ui`, `change-set` |
| `ui-developer` | `implementation_ui` *(react · angular)* | `change-set-ui` |
| `backend-developer` | `implementation_backend` *(python · go · jvm · node)* | `change-set` |
| `security` | `security` ○ + the repository baseline | `cve-report`, `dependency-map`, `security-baseline` |
| `reviewer` | `review` | `review-report` |
| `qa` | `qa` | `test-plan`, `test-report` |
| `documenter` | `documentation` | `docs-update` |

○ Off unless the run asks for it.

Stages are the unit of state. Agents are the unit of capability. One agent can own several stages — `ux-designer` owns three, one per fidelity — and one stage can be re-run when a gate sends it back.

## Which stages a run includes

Decided once, when the run is created, from the intent as written:

```bash
hermit start "add cart persistence, skip the UX designs and don't open a PR"
```

Matching is mechanical — cue words against a fixed table of stage aliases, no model in the loop — so the same sentence always produces the same run shape, and `hermit start` prints the phrase behind every decision. `--skip` and `--with` say the same thing explicitly.

Two properties make this safe to expose to prose:

1. **The intent is never re-read.** No agent rephrases its way into or out of a stage. The one exception is mechanical, not linguistic: once requirements or architecture is done, the orchestrator may call `hermit_skip_stages` to stand *optional, not-yet-started* stages down when the run has settled that they produce nothing (no interface → no UX stages). It narrows only, never widens; it needs a reason; and it is an intimation to the user, not a gate.
2. **Four stages are locked.** Requirements, architecture, review and delivery are refused with a reason, at every layer — the parser, `createRun`, and `hermit_skip_stages` too. Those four hold the gates the design rests on, and a gate a sentence can dissolve is not a gate.

Two stages invert the default: `tracker` and `security` are off until asked for, because both act outward — one writes to a real tracker, the other changes dependency manifests.

## Handoff, concretely

An agent never calls another agent. It calls three tools:

```
hermit_next_task        -> receives its playbook + only the context it is entitled to
hermit_submit_artifact  -> writes one declared output
hermit_request_handoff  -> asks to advance; exit criteria are checked first
```

`hermit_request_handoff` has three possible answers:

- **blocked** — an exit criterion failed. The response names which one and why. The agent stays on its stage.
- **awaiting_gate** — criteria passed, but this stage is human-gated. The run halts until a person runs `hermit gate approve <id>`.
- **advanced** — criteria passed, no gate. `run.currentStage` moves on, and the next `hermit_next_task` returns a different agent's brief.

The orchestrator agent reads that answer and routes accordingly. The server never routes; it only reports.
