# Installing Hermit

Hermit installs into an existing repository. It adds agent definitions, host configuration and MCP server wiring; it does not restructure your project.

It targets **GitHub Copilot** by default and **Claude Code** with `--harness claude`. Both can be enabled at once.

- [Requirements](#requirements)
- [Install](#install)
- [Choosing a harness](#choosing-a-harness)
- [Configure credentials](#configure-credentials)
- [Wire up each Copilot surface](#wire-up-each-copilot-surface)
- [Monorepos](#monorepos)
- [Specialist agents](#specialist-agents)
- [Figma authoring](#figma-authoring-optional)
- [First run](#first-run)
- [Troubleshooting](#troubleshooting)
- [Uninstalling](#uninstalling)

---

## Requirements

| | |
|---|---|
| Node | 20.10 or later (`node -v`) |
| Git | Repository initialised; a remote if you want pull requests opened |
| Host | VS Code, Copilot CLI, a JetBrains IDE, or Claude Code |
| Copilot | An active subscription — only if you use the Copilot harness |

Hermit is plain ESM with no build step. Nothing is compiled at install time.

---

## Install

```bash
npm i @hermit/cli
```

The postinstall writes agents and host configuration into the workspace. It is deliberately timid — it no-ops and tells you what to run instead when:

- the environment sets `CI`
- npm ran with `--ignore-scripts`
- Hermit is a transitive dependency rather than a direct one
- `HERMIT_NO_POSTINSTALL` is set

It never fails your install. If it skipped, or you prefer explicit setup:

```bash
npx hermit init
```

Both do the same work and are safe to re-run.

For Claude Code instead of, or alongside, Copilot:

```bash
npx hermit init --harness claude
npx hermit init --harness copilot,claude
```

The choice is written to `.hermit/config.json`, so `npx hermit sync` never needs the flag again.

### What lands in your repository

```
.hermit/                          ← yours to edit; survives sync and upgrades
  agents/          12 agent definitions
  skills/          24 skill packs
  knowledge/       2 knowledge packs (edit engineering-standards first)
  config.json      harness, servers, SCM provider, write permissions, projects
  hooks/           generated guards (Claude Code harness)
  runs/            run state and artifacts (git-ignored by default)

AGENTS.md                         portable baseline — read by both harnesses

# harness: copilot
.github/
  copilot-instructions.md         always-on, all three surfaces
  agents/*.agent.md               compiled — do not edit by hand
  instructions/*.instructions.md  path-scoped rules
.vscode/mcp.json                  MCP config for VS Code
.copilot/mcp-config.json          MCP config for Copilot CLI
docs/hermit-intellij-setup.md     generated IntelliJ instructions

# harness: claude
CLAUDE.md                         always-on, and the orchestrator's playbook
.claude/agents/*.md               compiled subagents — do not edit by hand
.claude/skills/*/SKILL.md         packs, loaded on demand
.claude/settings.json             write-scope denials and the gate guard
.mcp.json                         MCP config for Claude Code
```

Everything under `.github/`, `AGENTS.md` and the MCP configs is **generated from `.hermit/`**. Edit the canonical files and run `npx hermit sync`.

Hermit records a hash of every file it writes. If you edit a generated file by hand, the next sync **skips it and tells you** rather than discarding your work. `npx hermit sync --force` overwrites deliberately.

### What to commit

Commit `.hermit/agents`, `.hermit/skills`, `.hermit/knowledge`, `.hermit/config.json`, `.hermit/hooks`, and everything your harness generates — your team should share one pipeline definition. For Copilot that is `.github/`, `.vscode/mcp.json` and `.copilot/mcp-config.json`; for Claude Code, `CLAUDE.md`, `.claude/` and `.mcp.json`. `AGENTS.md` either way.

`.hermit/runs/` is git-ignored by default. Commit it only if you want run artifacts in version control; they contain whatever your agents wrote, so check for anything sensitive first.

---

## Choosing a harness

A **harness** is a host that reads agent definitions. Everything in `.hermit/` is host-agnostic; the harness decides what gets compiled out of it.

| | `copilot` (default) | `claude` |
|---|---|---|
| Always-on instructions | `.github/copilot-instructions.md` | `CLAUDE.md` |
| Portable baseline | `AGENTS.md` | `AGENTS.md` |
| Agent definitions | `.github/agents/*.agent.md` | `.claude/agents/*.md` |
| Skills & knowledge | inlined into each agent file | `.claude/skills/*/SKILL.md` |
| MCP config | `.vscode/mcp.json`, `.copilot/mcp-config.json` | `.mcp.json` |
| Repo layout (monorepo) | `.github/instructions/project-*.md` | `.claude/skills/hermit-repository-layout/` |
| Write scope | described in the brief | **enforced** by `.claude/settings.json` |
| Gate approval from a shell | described | **blocked** by a `PreToolUse` hook |

Enabling both is supported and costs nothing — the output paths do not overlap, so a team split across editors shares one pipeline definition.

**A harness changes the format, not the scope.** An agent entitled to three MCP tools under one is entitled to exactly those three under the other, and a read-only role gets no editing tools on either.

### Switching harness

```bash
npx hermit init --harness claude    # switch
npx hermit doctor                   # confirms which is active
```

Files the previous harness wrote are **reported, not deleted** — Hermit stops maintaining them and tells you which they are. Delete them once you are sure nothing else reads them:

```bash
rm -rf .github/agents .github/instructions .copilot .vscode/mcp.json
```

### Claude Code specifics

**The main session is the orchestrator.** Copilot gives the orchestrator its own `mode: primary` agent file; Claude Code has no equivalent, and a subagent dispatching subagents fights the model. So the orchestrator's playbook lives in `CLAUDE.md`, where the main session reads it, and the twelve role agents are subagents it dispatches through the Task tool.

**Skills are loaded, not inlined.** Each pack becomes a real skill under `.claude/skills/hermit-<id>/`, read on demand rather than copied into every agent that references it.

**Enforcement.** `.claude/settings.json` denies writes to `.hermit/runs/` (the audit trail) and to the generated agent files, and registers a hook that refuses `hermit gate approve|reject|changes` from Bash. That last one closes the only remaining route by which an agent could decide its own gate. Running it yourself in a terminal is unaffected — the hook only sees tool calls.

Hermit owns `.claude/settings.json` outright rather than merging into it, because a partial merge would keep whichever hooks block was already on disk and silently drop the gate guard. If you edit it by hand, the next sync skips it and says so.

**Restart Claude Code after install** so it picks up `.mcp.json`, and approve the servers when prompted.

---

## Configure credentials

Every credential is read from the environment. Nothing is stored in Hermit's config.

```bash
npx hermit doctor
```

This lists exactly which variables each enabled server needs.

### Jira and Confluence

Create an API token at [id.atlassian.com](https://id.atlassian.com/manage-profile/security/api-tokens).

```bash
export JIRA_BASE_URL="https://your-org.atlassian.net"
export JIRA_EMAIL="you@your-org.com"
export JIRA_API_TOKEN="..."

export CONFLUENCE_BASE_URL="https://your-org.atlassian.net/wiki"
export CONFLUENCE_EMAIL="you@your-org.com"
export CONFLUENCE_API_TOKEN="..."
```

### SharePoint

Needs an Entra app registration with `Sites.Read.All` granted by admin consent — and `Sites.ReadWrite.All` only if you enable uploads.

```bash
export SHAREPOINT_TENANT_ID="..."
export SHAREPOINT_CLIENT_ID="..."
export SHAREPOINT_CLIENT_SECRET="..."
export SHAREPOINT_SITE_ID="..."          # optional default site
```

### Figma

A personal access token from Figma → Settings → Security.

```bash
export FIGMA_TOKEN="figd_..."
```

### Source control

Pick one provider. Hermit infers it from your git remote if you leave it unset.

```bash
export SCM_PROVIDER="github"      # github | bitbucket | gitlab | codecommit
export SCM_TOKEN="..."            # PAT, not needed for codecommit
export SCM_BASE_URL="..."         # self-hosted GitLab / Bitbucket / GHES only
```

**CodeCommit** uses SigV4 rather than a token, so it reads standard AWS credentials:

```bash
export SCM_PROVIDER="codecommit"
export AWS_REGION="eu-west-1"
export AWS_ACCESS_KEY_ID="..."
export AWS_SECRET_ACCESS_KEY="..."
export AWS_SESSION_TOKEN="..."    # if using temporary credentials
```

### Disabling servers you don't use

Edit `.hermit/config.json` and run `npx hermit sync`:

```json
{ "servers": ["hermit", "jira", "scm"] }
```

Fewer servers means a smaller tool surface, which makes agents more reliable, not less.

### Write permissions

Writes to systems the whole company can see are **off by default**:

```json
{
  "jira":       { "writes": true },
  "confluence": { "writes": false },
  "sharepoint": { "writes": false },
  "scm":        { "writes": true },
  "documentation": { "external": false }
}
```

`documentation.external` controls whether the documentation agent updates Confluence and SharePoint pages. When it is off, the agent lists what needs updating instead of doing it.

---

## Wire up each Copilot surface

The hosts do not read the same files. Hermit generates for whichever harnesses you enabled from one source, but each needs a different activation step.

### Claude Code

Restart it so it picks up `.mcp.json`, approve the servers when prompted, then just describe the work — the main session is the orchestrator and dispatches the role agents itself. `CLAUDE.md` is loaded automatically.

### VS Code

Reload the window so it picks up `.vscode/mcp.json`. Confirm the servers connect, then start a chat with `@hermit-orchestrator`.

Agent files, path-scoped instructions and per-agent MCP allowlists all work here — this is the fullest experience.

### Copilot CLI

Reads `AGENTS.md` and `.github/agents/`, with MCP from `.copilot/mcp-config.json`. No extra step; run `copilot` from the repository root.

### JetBrains (IntelliJ IDEA)

IntelliJ **does not load `.github/agents/` files**. Add the MCP servers through the IDE:

**Settings → Tools → GitHub Copilot → Model Context Protocol**

`npx hermit init` generates `docs/hermit-intellij-setup.md` with the exact command, arguments and environment for each server. Set `HERMIT_WORKSPACE` to the project root on every one.

Because agent files are not loaded, address a role explicitly:

```
Call hermit_status. Then call hermit_get_agent with agent "orchestrator",
follow that playbook, and route the current stage.
```

Same playbook text, same scoping, same gates — you ask for an agent rather than selecting it.

---

## Monorepos

Hermit detects the layout at install and prints what it found:

```
✓ monorepo detected (npm-workspaces): 9 projects — 2 frontend, 1 mobile,
  1 docs, 1 infra, 1 lib, 2 backend, 1 batch
```

Detection reads npm/yarn workspaces, pnpm, Lerna, Nx, Turborepo, Go workspaces, Cargo, Gradle and Maven — **unioned** with conventional directories, so `infra/` and `docs/` are picked up even when they sit outside the package-manager globs.

A conventionally-named directory counts only if it carries evidence that something is built there — a manifest, a build file, a Dockerfile or a Terraform file. A `docs/` folder holding nothing but markdown is documentation, not a project.

```bash
npx hermit projects
```

```
ID                        PATH                      KIND       UI   STACK
apps-web                  apps/web/                 frontend   yes  node
services-api              services/api/             backend     —   node
services-billing          services/billing/         backend     —   go
services-nightly-batch    services/nightly-batch/   batch       —   node
infra                     infra/                    infra       —   unknown
```

Fix any misclassification in `.hermit/config.json` — it is read in preference to detection:

```json
{
  "projects": [
    { "id": "web",     "path": "apps/web",              "kind": "frontend", "ui": true },
    { "id": "api",     "path": "services/api",          "kind": "backend"  },
    { "id": "batch",   "path": "services/nightly-batch","kind": "batch"    },
    { "id": "infra",   "path": "infra",                 "kind": "infra"    }
  ]
}
```

`kind` is one of `frontend`, `backend`, `batch`, `infra`, `mobile`, `lib`, `docs`, `unknown`.

### Targeting a subset

```bash
npx hermit start "Add idempotency keys to the billing webhook" --project api,batch
```

Three things follow from that scope:

1. **Paths narrow.** The implementer's write scope is confined to those projects. Everything else is readable for context but not writable, and the brief says so explicitly.
2. **UX stages skip themselves.** No project in scope has a UI, so all three fidelity stages are skipped — a fact about the work, not a flag to remember.
3. **Extra sections become mandatory.** `codebase-map` needs `## Projects`, `impact-analysis` needs `## Cross-Project Impact`, `work-plan` needs `## Project Sequencing`, and `change-set` needs `## Projects Touched`. These are checked mechanically and only apply in monorepo mode.

Omit `--project` to scope the run to every project.

### Per-project instructions

Hermit generates `.github/instructions/project-<id>.instructions.md` with `applyTo: '<path>/**'`, so VS Code loads a project's context automatically when you open a file in it — without inflating the always-on instructions every surface pays for.

---

## Specialist agents

Implementation is **two stages** — the interface first, then the services behind it — and each picks its agent from what the repository is written in:

| Stage | Runs when | Default | Specialist |
|---|---|---|---|
| `implementation_ui` | anything in scope has an interface | `implementer` | `ui-developer` — React, Angular |
| `implementation_backend` | the run is not *purely* interface work | `implementer` | `backend-developer` — Python, Go, Java/Spring Boot |

There is nothing to configure. The stacks come from the same project scan `hermit projects` prints, and a flat single-service repository is classified from its root. If no specialist matches, the pipeline's own agent runs — a specialist can narrow a stage, never leave it unstaffed.

A full-stack change engages both specialists, one per stage. The services stage is also the **catch-all**: infrastructure, libraries and anything unclassified arrive there, which is why it stands down only for a run that is nothing but interface work.

The interface is built **before** the services, against the contract in `## Interfaces` rather than against running code. Whatever the contract failed to promise is recorded in `change-set-ui` under `## Contract Gaps`, and the services stage reads that section first.

```bash
npx hermit status     # names the agent that will run each stage
npx hermit doctor     # lists the specialists and checks their scopes
```

To see which agent handled a stage after the fact, `npx hermit journal` records a `stage.specialised` entry naming the specialist, the agent it replaced, and the stacks that decided it.

### What this asks of the architect

**Architecture now runs before the UX stages.** The architect settles the user flow, the services and the contracts; the designer draws screens against a ratified system. The architect never sees the designs — they do not exist yet — so the flow and the interfaces have to be complete enough to design from.

Because of that, and because the two sides are built by different agents, `architecture-spec` must carry:

- `## User Flow` — when the work has an interface. The end-to-end path through the system, which the UX stages elaborate into screens.
- `## Frontend Design` — when the work has an interface.
- `## Backend Design` — when the work has a server side.

All are checked mechanically at the architecture gate, and none is demanded of a run it does not apply to: a backend-only run is never asked for a user flow.

---

## Figma authoring (optional)

Reading Figma needs only `FIGMA_TOKEN`. **Creating frames needs the plugin**, because Figma's REST API cannot create layers — only its Plugin API can, and that runs inside Figma.

1. In Figma: **Menu → Plugins → Development → Import plugin from manifest**
2. Choose `node_modules/@hermit/mcp-figma/plugin/manifest.json`
3. Open your design file and run **Hermit Design Bridge**
4. It connects to `ws://127.0.0.1:8473` — loopback only, never exposed

Change the port with `figma.bridgePort` in `.hermit/config.json` if 8473 is taken.

Without the plugin the pipeline still works: `figma_create_design` returns the scene-graph spec and reports the bridge disconnected, and the UX agent records the spec in its design artifact rather than retrying.

---

## First run

```bash
npx hermit doctor
npx hermit start "Preserve the cart when a session expires" --jira PROJ-412
npx hermit status
```

Then in VS Code, invoke `@hermit-orchestrator`. It reads `hermit_status`, dispatches the onboarding agent, and works down the pipeline.

At each of the seven human gates it stops and tells you the command:

```bash
npx hermit gate list
npx hermit gate approve gate_architecture_7f3c
npx hermit gate changes gate_architecture_7f3c -m "name the rollback path explicitly"
```

`changes` returns the stage to its agent with your comment attached to the next brief. Decisions are recorded against your `git config user.name`.

Nothing an agent can do approves a gate — there is no such tool on the MCP surface.

---

## Troubleshooting

**MCP servers do not appear in VS Code.** Reload the window. Check `.vscode/mcp.json` exists and that `node_modules/@hermit/mcp-workflow/src/index.js` is present.

**MCP servers do not appear in Claude Code.** Restart it — `.mcp.json` is read at startup — and approve the servers when prompted. Check `.mcp.json` exists and that you ran `init` with `--harness claude`; `hermit doctor` names the active harness.

**Claude Code blocked a gate command.** Working as designed: agents cannot decide gates. Run it yourself in a terminal.

**`No active Hermit run`.** Start one with `hermit start`, or `hermit runs` to see existing ones — the active run is per-workspace.

**A server says a variable is missing.** Set it and restart the MCP server; hosts read the environment at spawn time, so exporting into an already-running session is not enough.

**Handoff refused.** Working as designed. The response names the exact criterion that failed. Fix that specific thing.

**Doctor reports generated files were edited.** You changed a compiled file by hand. Move the change into `.hermit/` where it survives, or `hermit sync --force` to discard it.

**A project was classified wrong.** Declare it explicitly under `projects` in `.hermit/config.json`, then `hermit sync`.

**The wrong agent took the implementation stage.** Routing follows the `kind` and `stack` of the projects in scope — check `hermit projects` first, since a misclassified project is the usual cause. Declaring the project correctly in `.hermit/config.json` fixes both. Scope is frozen when the run starts, so correct it and start a new run.

**Figma bridge stays disconnected.** The plugin must be running in an open Figma file. Check the port matches `figma.bridgePort`. This is not an error condition — the pipeline continues with a written spec.

**CodeCommit calls fail.** Check `AWS_REGION` matches the repository's region and the credentials carry `codecommit:CreatePullRequest`. SigV4 failures report the AWS error type verbatim.

---

## Uninstalling

```bash
npm rm @hermit/cli
rm -rf .hermit AGENTS.md

# Copilot harness
rm -rf .github/agents .github/instructions .copilot

# Claude Code harness
rm -rf .claude/agents .claude/skills .claude/settings.json CLAUDE.md .mcp.json
```

For `.vscode/mcp.json`, remove the `servers` block rather than the file — Hermit merges into it rather than owning it, so other servers you configured are preserved. The same applies to `mcpServers` in `.mcp.json` if you added your own.

Your source code is untouched — Hermit only ever writes to the paths listed above, plus whatever the implementer and documenter agents changed during a run, which live in your normal git history.
