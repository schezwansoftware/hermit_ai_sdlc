<h1>Hermit</h1>

**An agentic SDLC pipeline for GitHub Copilot.** Eleven role agents carry work from a ticket to a merged pull request. Each sees only the context its role declares. A human signs off at the seven points where being wrong is expensive — and no agent can forge that signature.

```bash
npm i @hermit/cli
```

That is the whole setup. → [Install guide](INSTALL.md) · [Concepts](docs/01-concepts.md)

---

## The pipeline

```
 1  onboard          onboarding    ·  project context, codebase map, glossary
 2  requirements     analyst       ⏸  spec + acceptance criteria
 3  ux_lofi          ux-designer   ⏸  structure and flow          ┐
 4  ux_midfi         ux-designer   ⏸  every screen × every state  ├ skipped when
 5  ux_hifi          ux-designer   ⏸  visual contract, tokens     ┘ nothing has a UI
 6  architecture     architect     ⏸  design, ADRs, impact analysis
 7  planning         planner       ·  work packages
 8  implementation   implementer*  ·  the code and its tests
 9  review           reviewer      ⏸  review against the ratified design
10  qa               qa            ·  test plan, execution, result
11  documentation    documenter    ·  update what the change invalidated
12  delivery         orchestrator  ⏸  release notes, sign-off
13  pull_request     orchestrator  ·  opens only after 12 is approved

                                   ⏸ = a human decides
                                   * a specialist may take this stage — see below
```

The pull request comes **after** the human gate, never before. Opening one notifies your team, so it follows sign-off rather than preceding it.

---

## The distinction that matters

**The orchestrator is an agent.** It lives in `.hermit/agents/orchestrator.md` and holds the judgement: it routes work, scopes what each agent receives, and stops the line for humans.

**The workflow server is a ledger.** It stores run state, artifacts and gate records, and runs mechanical checks. It decides nothing.

Markdown cannot remember. A run spans days, three Copilot surfaces and several people; something has to hold *"stage 6, architecture gate open, eleven artifacts"* identically for all of them. Delete the server and the orchestrator is still the orchestrator — it just has amnesia between messages.

---

## Human gates are structural

A gate a model can talk its way past is decoration. Approval is unreachable from the agent side:

- No approval tool is exposed over MCP. There is nothing to call.
- `decideGate` refuses any source but `cli`.
- While a gate is open, `hermit_next_task` refuses to dispatch the next agent.
- Every decision records who made it, in an append-only journal alongside a sha256 of each artifact.

```bash
hermit gate list
hermit gate approve gate_architecture_7f3c
hermit gate changes gate_architecture_7f3c -m "name the rollback path explicitly"
```

`changes` returns the stage to its agent with your comment attached to its next brief.

`scripts/gate-check.mjs` proves this from the far side of a real MCP connection: it enumerates the tool list for anything resembling approval, tries dispatching past an open gate, and calls `decideGate` with a non-CLI source. All three are refused; then the CLI approves and the run advances.

---

## Context scoping is enforced twice

An artifact reaches an agent only if the **pipeline stage** lists it as an input **and** the **agent's role** declares it readable. Neither edit alone widens a role's reach, and the brief names what it withheld so the agent knows the boundary exists.

The same declarations compile into per-agent MCP allowlists in `.github/agents/*.agent.md` — so VS Code enforces them too. The analyst physically cannot call `jira_create_issue`.

---

## Specialists take the stage they know

The pipeline names one agent per stage. A **specialist** claims the same stage conditionally, declaring in its own frontmatter which stacks and project kinds it is for:

```yaml
# .hermit/agents/backend-developer.md
specializes:
  stage: implementation
  when:
    stack: [python, go, jvm]
    kind:  [backend, batch, lib, unknown]
```

When a run's scope contains Python, Go or JVM server-side code, `backend-developer` implements it — same stage, same inputs and outputs, same gate — carrying language packs the generic implementer does not. Node and React work stays with `implementer`. Nothing to configure: the stacks are read from the project scan already done at `hermit start`, and a flat single-service repository is classified from its root.

Routing **narrows, never strands**. No match leaves the pipeline's own agent in place, so adding a specialist cannot leave a stage unstaffed. `hermit status` names whoever will actually run it, from the moment the run is created:

```
  ·  7. planning        planner
  ·  8. implementation  backend-developer
  ·  9. review          reviewer           [human gate]
```

Because the two sides are built by different agents, the architect's design splits to match: `architecture-spec` must carry `## Backend Design` when the work has a server side and `## Frontend Design` when it has an interface. Both are checked mechanically, and neither is demanded of a run it does not apply to.

---

## Monorepos

```bash
$ hermit projects

Monorepo   9 project(s) · detected · npm-workspaces

  ID                        PATH                      KIND       UI   STACK
  apps-web                  apps/web/                 frontend   yes  node
  apps-mobile               apps/mobile/              mobile     yes  node
  services-api              services/api/             backend     —   node
  services-billing          services/billing/         backend     —   go
  services-nightly-batch    services/nightly-batch/   batch       —   node
  infra                     infra/                    infra       —   unknown
  docs                      docs/                     docs        —   node
```

Detection covers npm/yarn workspaces, pnpm, Lerna, Nx, Turborepo, Go workspaces, Cargo, Gradle and Maven — **unioned** with conventional directories, so `infra/` and `docs/` are found even though they sit outside the package-manager globs. A conventional directory still has to carry evidence that something is built there — a manifest, a build file, a Dockerfile, a `.tf` — so a folder of loose markdown is not mistaken for a project. Correct anything it got wrong in `.hermit/config.json`.

```bash
hermit start "Add idempotency keys to the billing webhook" --project services-api,services-billing
```

Three things follow from that scope:

| | |
|---|---|
| **Paths narrow** | The implementer can only write inside those projects. Others are readable for context; the brief names them as out of scope. |
| **UX stages skip** | Nothing in scope has a UI, so all three fidelity stages skip — a fact about the work, not a flag to remember. |
| **Sections become mandatory** | `codebase-map` needs `## Projects`, `impact-analysis` needs `## Cross-Project Impact`, `work-plan` needs `## Project Sequencing`, `change-set` needs `## Projects Touched`. Checked mechanically, monorepo-only. |

Hermit also emits `.github/instructions/project-<id>.instructions.md` scoped with `applyTo`, so VS Code loads a project's context when you open a file in it.

---

## Agents

| Agent | Owns | Produces |
|---|---|---|
| `orchestrator` | routing · delivery · pull_request | release notes, the pull request |
| `onboarding` | onboard | project context, codebase map, glossary |
| `analyst` | requirements | requirements spec, acceptance criteria |
| `ux-designer` | ux_lofi · ux_midfi · ux_hifi | wireframes, design spec, design tokens |
| `architect` | architecture | architecture spec, ADRs, impact analysis |
| `planner` | planning | work plan, tracker subtasks |
| `implementer` | implementation | the code, tests, change set |
| `backend-developer` | implementation *(python · go · jvm)* | the code, tests, change set |
| `reviewer` | review | review report |
| `qa` | qa | test plan, test report |
| `documenter` | documentation | updated docs, staleness audit |

Backed by 22 skill packs and 2 knowledge packs. All markdown, all in `.hermit/`, all yours to edit — then `hermit sync`.

**Start by replacing `knowledge/engineering-standards`** with your team's real standards. It is injected into every agent's context and is the cheapest way to make all ten behave like your team rather than a generic one.

---

## MCP servers

| Server | Tools | |
|---|---:|---|
| `hermit` | 10 | The workflow ledger. No credentials. |
| `jira` | 9 | Issues, JQL, comments, links, subtasks, transitions |
| `confluence` | 6 | Search, pages, children, attachments · writes opt-in |
| `sharepoint` | 5 | Microsoft Graph, client credentials · uploads opt-in |
| `figma` | 11 | Reads over REST · authoring via plugin bridge |
| `scm` | 9 | GitHub · GitLab · Bitbucket · CodeCommit, one surface |

**Figma cannot create layers over REST.** Only the Plugin API can, and it runs inside Figma. `figma_create_design` sends a scene-graph spec to a companion plugin over loopback. Without it, the tool returns the spec and reports the bridge disconnected — agents record it and continue rather than retrying.

**One SCM server, four providers.** `scm_create_pull_request` behaves the same on all four; the adapter absorbs the differences (GitLab calls it a merge request; CodeCommit needs SigV4 rather than a token). Agent playbooks never name a vendor.

---

## The three Copilot surfaces

| Loads | VS Code | Copilot CLI | IntelliJ |
|---|---|---|---|
| `.github/copilot-instructions.md` | yes | yes | yes |
| `AGENTS.md` | yes | yes | partial |
| `.github/agents/*.agent.md` | yes | yes | **no** |
| MCP config | `.vscode/mcp.json` | `.copilot/mcp-config.json` | IDE settings |

Because IntelliJ loads no agent files, every playbook is **also** served over MCP through `hermit_get_agent` — the one channel all three support identically. Same text, same scoping, same gates.

---

## Commands

```bash
hermit init                        # install into this workspace
hermit doctor                      # config, credentials, pipeline integrity
hermit projects                    # what this repo contains and how it was classified

hermit start "<intent>" --jira K   # begin a run   ( --project a,b   --no-ui )
hermit status                      # where things stand
hermit next                        # print the current stage brief
hermit resume [<run-id>]           # reopen a blocked run

hermit gate list | approve | changes | reject
hermit artifacts [name]            # list or print artifacts
hermit journal                     # the audit trail
hermit sync                        # recompile after editing .hermit/
```

---

## Verifying

```bash
npm test                            # full pipeline through the state machine
npm run check:monorepo              # scoping, stage skipping, conditional criteria
npm run check:specialists           # stack-based routing and the split design
npm run check:mcp   -- <workspace>  # all six servers handshake over stdio
npm run check:gates -- <workspace>  # gate enforcement across the MCP boundary
```

---

## Layout

```
packages/
  core/            state machine, gates, context scoping, project detection
  agents/          11 agents · 22 skills · 2 knowledge packs (markdown)
  cli/             hermit CLI and the host compiler
  mcp-shared/      server bootstrap, HTTP client, config
  mcp-workflow/    the ledger
  mcp-jira/  mcp-confluence/  mcp-sharepoint/  mcp-figma/  mcp-scm/
```

Plain ESM, no build step: what you read is what runs, and `npm i` needs no compile.

---

## Status

The workflow server is exercised end to end by the checks above. The five integration servers are written against their documented APIs but **have not been run against live credentials** — expect to shake out auth and field-shape details on first contact. `hermit doctor` tells you exactly what each one needs.
