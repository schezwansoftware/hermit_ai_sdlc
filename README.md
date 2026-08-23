<h1>Hermit</h1>

**An agentic SDLC pipeline for GitHub Copilot and Claude Code.** Twelve role agents carry work from a ticket to a merged pull request. Each sees only the context its role declares. A human signs off at the seven points where being wrong is expensive — and no agent can forge that signature.

```bash
npm i @hermit/cli                          # GitHub Copilot
npx hermit init --harness claude           # Claude Code
npx hermit init --harness copilot,claude   # both
```

That is the whole setup. → [Install guide](INSTALL.md) · [Concepts](docs/01-concepts.md)

---

## The pipeline

```
 ·  onboard                 onboarding    ·  once per repo, outside the pipeline — opt in

 1  requirements            analyst       ⏸  spec + acceptance criteria
 2  architecture            architect     ⏸  user flow, services, contracts, ADRs
 3  ux_lofi                 ux-designer   ⏸  structure and flow          ┐
 4  ux_midfi                ux-designer   ⏸  every screen × every state  ├ skipped when
 5  ux_hifi                 ux-designer   ⏸  visual contract, tokens     ┘ nothing has a UI
 6  planning                planner       ·  work packages
 7  implementation_ui       implementer*  ·  the interface and its tests    (skipped: no UI)
 8  implementation_backend  implementer*  ·  the services and their tests   (skipped: UI only)
 9  review                  reviewer      ⏸  review against the ratified design
10  qa                      qa            ·  test plan, execution, result
11  documentation           documenter    ·  update what the change invalidated
12  delivery                orchestrator  ⏸  release notes, sign-off
13  pull_request            orchestrator  ·  opens only after 12 is approved

                                          ⏸ = a human decides
                                          * a specialist may take this stage — see below
```

**Onboarding is not a stage.** It maps the codebase into three documents every run then reads, so paying for it per run was a tax with no return. `hermit onboard` does it once, into `.hermit/onboarding/`. It costs real tokens, so `hermit init` asks rather than assuming — decline it and runs proceed, naming the inputs they are missing.

**Architecture precedes UX.** The architect settles the user flow, the services and the contracts between them; the designer then draws screens against a ratified system, rather than the architect reverse-engineering a system from approved screens. The architect never sees the designs — they do not exist yet, which is why `## User Flow` and `## Interfaces` have to be complete enough to design from.

**The interface is built before the services.** Stage 8 works against the published contract, not against running code, and records anything the contract failed to promise under `## Contract Gaps`. Stage 9 reads that section first. A mock on one side and nothing on the other is the failure this ordering is designed to surface early.

The pull request comes **after** the human gate, never before. Opening one notifies your team, so it follows sign-off rather than preceding it.

---

## The distinction that matters

**The orchestrator is an agent.** It lives in `.hermit/agents/orchestrator.md` and holds the judgement: it routes work, scopes what each agent receives, and stops the line for humans.

**The workflow server is a ledger.** It stores run state, artifacts and gate records, and runs mechanical checks. It decides nothing.

Markdown cannot remember. A run spans days, three Copilot surfaces and several people; something has to hold *"stage 6, architecture gate open, eleven artifacts"* identically for all of them. Delete the server and the orchestrator is still the orchestrator — it just has amnesia between messages.

---

## Human gates are structural

A gate a model can talk its way past is decoration. A decision reaches the run through exactly two doors, both keyed to a human:

- **A terminal.** `hermit gate approve <id>` — always available, unaffected by anything an agent does.
- **Chat.** The orchestrator, and only the orchestrator, can call `hermit_decide_gate` — and only once a human has explicitly said what to decide. The host asks them to confirm before it runs; that confirmation is the decision Hermit records, not the model's own read of the work.

```bash
hermit gate list
hermit gate approve gate_architecture_7f3c
hermit gate changes gate_architecture_7f3c -m "name the rollback path explicitly"
```

`changes` returns the stage to its agent with your comment attached to its next brief. Whichever door a decision comes through, `decideGate` still refuses anything that isn't `cli` or `chat`, role agents never see `hermit_decide_gate` at all, and while a gate is open `hermit_next_task` refuses to dispatch the next agent regardless. Every decision records who made it and which door they used, in an append-only journal alongside a sha256 of each artifact.

**The chat door is real, not theatrical, but it is not as strong as the terminal.** It depends on the host actually asking for confirmation on that specific call — which is why `hermit_decide_gate` is the only tool in this server marked destructive. A workspace that has set the `hermit` MCP server to auto-approve everything has switched that confirmation off along with it. If that risk isn't one you want, keep gates in the terminal and never grant the tool broad approval.

`scripts/gate-check.mjs` proves the shape of this from the far side of a real MCP connection: `hermit_decide_gate` is enumerable, but calling it as anything other than the orchestrator is refused, calling it without a reason for a rejection is refused, and `decideGate` itself still throws for any source outside `cli`/`chat`. Then a call as the orchestrator, with a human's decision to relay, actually advances the run — the same way the CLI does.

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
  stage: implementation_backend
  when:
    stack: [python, go, jvm, node]
    kind:  [backend, batch, lib, unknown]
```

| Stage | Default | Specialist |
|---|---|---|
| `implementation_ui` | `implementer` | `ui-developer` — React, Angular |
| `implementation_backend` | `implementer` | `backend-developer` — Python, Go, JVM, Node |

Nothing to configure: the stacks come from the project scan already done at `hermit start`, and a flat single-service repository is classified from its root. Because implementation is two stages, a full-stack run engages **both** specialists — one per stage — rather than one of them doing the other's job.

Routing **narrows, never strands**. No match leaves the pipeline's own agent in place, so adding a specialist cannot leave a stage unstaffed. `hermit status` names whoever will actually run each stage, from the moment the run is created:

```
  ·  6. planning               planner
  ·  7. implementation_ui      ui-developer
  ·  8. implementation_backend backend-developer
  ·  9. review                 reviewer           [human gate]
```

The services stage is also the **catch-all** — infrastructure, libraries and anything unclassified arrive there — so it stands down only when the run is nothing but interface work.

Because the two sides are built by different agents, the architect's design splits to match: `architecture-spec` must carry `## Backend Design` when the work has a server side, and `## User Flow` plus `## Frontend Design` when it has an interface. All are checked mechanically, and none is demanded of a run it does not apply to.

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
| `onboarding` | *outside the pipeline* | project context, codebase map, glossary |
| `analyst` | requirements | requirements spec, acceptance criteria |
| `ux-designer` | ux_lofi · ux_midfi · ux_hifi | wireframes, design spec, design tokens |
| `architect` | architecture | user flow, architecture spec, ADRs, impact analysis |
| `planner` | planning | work plan, tracker subtasks |
| `implementer` | implementation_ui · implementation_backend | the code, tests, change set |
| `ui-developer` | implementation_ui *(react · angular)* | the interface, tests, change set |
| `backend-developer` | implementation_backend *(python · go · jvm · node)* | the services, tests, change set |
| `reviewer` | review | review report |
| `qa` | qa | test plan, test report |
| `documenter` | documentation | updated docs, staleness audit |

Backed by 25 skill packs and 2 knowledge packs. All markdown, all in `.hermit/`, all yours to edit — then `hermit sync`.

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

The six servers install with the CLI, and `hermit init` writes the path it resolved them at into your host's MCP config. `hermit doctor` verifies each one is reachable — a server whose entry point is missing never starts, and your host reports nothing when that happens, so this is the check worth running before you blame an agent.

---

## Running from a clone

You do not have to install a package. Clone the repository, link it, and the result is identical — `hermit init` resolves the servers inside your checkout and writes those paths instead.

```bash
git clone git@github.com:schezwansoftware/hermit_ai_sdlc.git ~/src/hermit
cd ~/src/hermit && npm install          # symlinks all ten workspace packages
cd packages/cli && npm link             # puts `hermit` on your PATH

cd ~/my-project
npm link @hermit/cli
npx hermit init --harness claude        # npm link runs no postinstall
npx hermit doctor                       # every server: ready, or needs <VAR>
```

Link the **CLI package**, not the repository root — the root is a private workspace container and carries no binary. Linking `@hermit/cli` is enough on its own: the six servers are resolved through it, not linked one by one.

Because those paths point into your clone, they are specific to your machine — git-ignore the MCP config, or have the rest of the team install normally. If the servers later appear in the workspace's own `node_modules`, the next `hermit sync` goes back to relative paths by itself. Editing an agent in the clone needs `npx hermit sync` in your project and a host restart; there is no build step.

→ [Full instructions](INSTALL.md#installing-from-a-clone)

---

## Two harnesses, one pipeline definition

Everything in `.hermit/` is host-agnostic. A **harness** compiles it into whatever files a given host actually reads:

| | GitHub Copilot | Claude Code |
|---|---|---|
| Always-on instructions | `.github/copilot-instructions.md` | `CLAUDE.md` |
| Portable baseline | `AGENTS.md` | `AGENTS.md` |
| Agent definitions | `.github/agents/*.agent.md` | `.claude/agents/*.md` |
| Skills & knowledge | inlined into each agent | `.claude/skills/*/SKILL.md` |
| MCP config | `.vscode/mcp.json` · `.copilot/mcp-config.json` | `.mcp.json` |
| Write scope | described | **enforced** — `.claude/settings.json` |
| Gate approval from a shell | described | **blocked** — PreToolUse hook |

Enable both and a team split across editors shares one pipeline; the outputs do not overlap. The choice is remembered in `.hermit/config.json`, so `hermit sync` never needs the flag again, and dropping a harness reports the files Hermit has stopped maintaining rather than deleting them behind you.

**A harness changes the format, never the scope.** An agent entitled to three MCP tools under Copilot is entitled to exactly those three under Claude Code, and a read-only role gets no `Edit`, `Write` or `Bash` on either. `npm run check:harness` asserts that in both directions.

### What Claude Code adds

Two things Copilot's format cannot express:

**Skills are loaded, not inlined.** Copilot has no skills mechanism, so every pack body is concatenated into every agent file that references it. Claude Code loads them on demand — smaller agent files, and one pack edited once with nothing to drift.

**A Bash-typed CLI command is closed off.** However a gate gets decided (see [Human gates are structural](#human-gates-are-structural) above), typing `hermit gate approve <id>` into Bash is not a legitimate route on either harness — it bypasses the confirmation that makes a chat decision real. Claude Code enforces this with a generated `PreToolUse` hook, since Bash is a real tool there in a way it is not on Copilot:

```
$ hermit gate approve gate_architecture_7f3c     # attempted by an agent, through Bash
Blocked by Hermit: only a human may decide a gate.
```

A person running the same command in their own terminal is unaffected; the hook only sees tool calls Claude itself makes.

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
hermit init [--harness a,b]        # install into this workspace (copilot · claude)
hermit onboard [--status]          # map the codebase — once per repo, opt-in
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
npm run check:harness               # both harnesses compile; scope survives translation
npm run check:mcp   -- <workspace>  # all six servers handshake over stdio
npm run check:gates -- <workspace>  # gate enforcement across the MCP boundary
```

---

## Layout

```
packages/
  core/            state machine, gates, context scoping, project detection
  agents/          12 agents · 25 skills · 2 knowledge packs (markdown)
  cli/             hermit CLI and the host compiler
  mcp-shared/      server bootstrap, HTTP client, config
  mcp-workflow/    the ledger
  mcp-jira/  mcp-confluence/  mcp-sharepoint/  mcp-figma/  mcp-scm/
```

Plain ESM, no build step: what you read is what runs, and `npm i` needs no compile.

---

## Status

The workflow server is exercised end to end by the checks above. The five integration servers are written against their documented APIs but **have not been run against live credentials** — expect to shake out auth and field-shape details on first contact. `hermit doctor` tells you exactly what each one needs.
