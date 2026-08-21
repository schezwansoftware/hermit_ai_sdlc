# Hermit

An agentic SDLC pipeline for GitHub Copilot workspaces. Ten agents, thirteen stages, seven human gates, six MCP servers — installed into a team's repository with one command.

```bash
npm i @hermit/cli
```

That is the whole setup. The postinstall writes agents, instructions and MCP configuration into the workspace and never overwrites a file someone has edited by hand.

## What it is

Each agent owns one role, receives only the context its role declares, and hands off through a workflow ledger rather than by calling the next agent directly. A master **orchestrator agent** decides who works next. Humans approve at the seven points where being wrong is expensive.

```
onboard → requirements → ux(lo/mid/hi) → architecture → planning
  → implementation → review → qa → documentation → delivery → pull request
         ▲                              ▲                ▲
         └────── human gates ───────────┴────────────────┘
```

## The one distinction that matters

**The orchestrator is an agent.** It lives in `agents/orchestrator.md` and it has judgement: it routes work, scopes context, and stops the line for humans.

**The workflow server is a ledger.** It stores run state, artifacts and gate records. It decides nothing. It exists because markdown cannot remember across three IDEs, several days, and multiple people.

Delete the server and the orchestrator is still the orchestrator — it just has amnesia. See [docs/01-concepts.md](docs/01-concepts.md).

## Agents

| Agent | Owns | Produces |
|---|---|---|
| `orchestrator` | routing, `delivery`, `pull_request` | release notes, the PR |
| `onboarding` | `onboard` | project context, codebase map, glossary |
| `analyst` | `requirements` | spec, acceptance criteria |
| `ux-designer` | `ux_lofi`, `ux_midfi`, `ux_hifi` | wireframes, design spec, tokens |
| `architect` | `architecture` | architecture spec, ADRs, impact analysis |
| `planner` | `planning` | work plan |
| `implementer` | `implementation` | the code, change set |
| `reviewer` | `review` | review report |
| `qa` | `qa` | test plan, test report |
| `documenter` | `documentation` | updated docs, staleness audit |

Definitions live in `.hermit/agents/*.md`. Edit them; run `npx hermit sync`.

## Human gates are real

Seven stages require a person. This is enforced structurally, not by asking a model nicely:

- No MCP tool can approve a gate. There is no such tool to call.
- `decideGate` refuses any source other than `cli`.
- While a gate is open, `hermit_next_task` refuses to dispatch the next agent.
- Every decision records who made it and when, in an append-only journal.

```bash
npx hermit gate list
npx hermit gate approve <gate-id>
npx hermit gate changes <gate-id> -m "name the rollback path explicitly"
```

`changes` returns the stage to its agent with your comment attached to the next brief.

## Context scoping is enforced twice

An agent sees an artifact only if **both** the pipeline stage lists it as an input **and** the agent's role declares it readable. Neither a pipeline edit nor an agent edit alone widens a role's reach.

The same declarations compile into per-agent MCP allowlists in `.github/agents/*.agent.md`, so VS Code enforces them too — the analyst physically cannot call `jira_create_issue`.

## The three Copilot surfaces

They do not read the same files, so Hermit compiles for each:

| | VS Code | Copilot CLI | IntelliJ |
|---|---|---|---|
| `.github/copilot-instructions.md` | ✓ | ✓ | ✓ |
| `AGENTS.md` | ✓ | ✓ | partial |
| `.github/agents/*.agent.md` | ✓ | ✓ | ✗ |
| MCP config | `.vscode/mcp.json` | `.copilot/mcp-config.json` | IDE settings |

Because IntelliJ loads no agent files, every playbook is also served over MCP via `hermit_get_agent`. Same text, same scoping, same gates — you address agents by asking rather than selecting. See [docs/hermit-intellij-setup.md](docs/hermit-intellij-setup.md) once generated.

## MCP servers

| Server | Tools | Notes |
|---|---|---|
| `hermit` | 10 | The workflow ledger. No credentials. |
| `jira` | 9 | Issues, JQL, comments, links, subtasks, transitions |
| `confluence` | 6 | Search, pages, children, attachments; writes opt-in |
| `sharepoint` | 5 | Graph API, client credentials; uploads opt-in |
| `figma` | 11 | Reads over REST; **authoring via the plugin bridge** |
| `scm` | 9 | GitHub, GitLab, Bitbucket, CodeCommit behind one surface |

### Two things worth knowing

**Figma cannot create layers over REST.** Only the Plugin API can. `figma_create_design` sends a scene-graph spec to the companion plugin in `packages/mcp-figma/plugin`; without it the tool returns the spec and reports the bridge disconnected rather than failing. Agents are instructed to degrade to a written spec, not to retry.

**One SCM server, four providers.** `scm_create_pull_request` works the same on all four; the adapter absorbs the differences (GitLab calls it a merge request, CodeCommit needs SigV4 rather than a token). Agent playbooks never name a vendor. Provider comes from `.hermit/config.json` or is inferred from the git remote.

## Commands

```bash
npx hermit init                       # install into this workspace
npx hermit doctor                     # config, credentials, pipeline integrity
npx hermit start "<intent>" --jira K  # begin a run ( --no-ui skips UX stages )
npx hermit status                     # where things stand
npx hermit next                       # print the current stage brief
npx hermit gate approve <id>          # humans only
npx hermit artifacts [name]           # list or print artifacts
npx hermit journal                    # the audit trail
npx hermit sync                       # recompile after editing .hermit/
```

## Verifying it

```bash
npm test                              # full pipeline through the state machine
npm run check:mcp -- <workspace>      # all six servers handshake over stdio
npm run check:gates -- <workspace>    # gate enforcement across the MCP boundary
```

`check:gates` proves the claim that matters: an agent connected over real MCP cannot approve a gate, cannot find a tool that would, and cannot dispatch the next stage while one is open — and a human with a terminal can.

## Customising

`.hermit/` is yours. It survives `hermit sync` and reinstalls.

- **`knowledge/engineering-standards/SKILL.md`** — replace with your team's real standards. It is injected into every agent's context and is the cheapest way to make all ten agents behave like your team.
- **`agents/*.md`** — edit playbooks and scopes freely.
- **`config.json`** — enabled servers, SCM provider, per-server write permissions.

Writes to Confluence and SharePoint are **off by default**, because those edits are visible company-wide.

## Layout

```
packages/
  core/            state machine, gates, context scoping, registry
  agents/          10 agents, 19 skills, 2 knowledge packs (markdown)
  cli/             hermit CLI + the host compiler
  mcp-shared/      server bootstrap, HTTP client, config
  mcp-workflow/    the ledger
  mcp-jira/  mcp-confluence/  mcp-sharepoint/  mcp-figma/  mcp-scm/
```

Plain ESM, no build step: what you read is what runs, and `npm i` needs no compile.
