# Installing Hermit

Hermit installs into an existing repository. It adds agent definitions, Copilot configuration and MCP server wiring; it does not restructure your project.

- [Requirements](#requirements)
- [Install](#install)
- [Configure credentials](#configure-credentials)
- [Wire up each Copilot surface](#wire-up-each-copilot-surface)
- [Monorepos](#monorepos)
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
| Copilot | An active GitHub Copilot subscription |
| Host | VS Code, Copilot CLI, or a JetBrains IDE |

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

### What lands in your repository

```
.hermit/                          ← yours to edit; survives sync and upgrades
  agents/          10 agent definitions
  skills/          19 skill packs
  knowledge/       2 knowledge packs (edit engineering-standards first)
  config.json      servers, SCM provider, write permissions, projects
  runs/            run state and artifacts (git-ignored by default)

.github/
  copilot-instructions.md         always-on, all three surfaces
  agents/*.agent.md               compiled — do not edit by hand
  instructions/*.instructions.md  path-scoped rules

AGENTS.md                         portable baseline for Copilot CLI
.vscode/mcp.json                  MCP config for VS Code
.copilot/mcp-config.json          MCP config for Copilot CLI
docs/hermit-intellij-setup.md     generated IntelliJ instructions
```

Everything under `.github/`, `AGENTS.md` and the MCP configs is **generated from `.hermit/`**. Edit the canonical files and run `npx hermit sync`.

Hermit records a hash of every file it writes. If you edit a generated file by hand, the next sync **skips it and tells you** rather than discarding your work. `npx hermit sync --force` overwrites deliberately.

### What to commit

Commit `.hermit/agents`, `.hermit/skills`, `.hermit/knowledge`, `.hermit/config.json`, and everything generated under `.github/`, `AGENTS.md`, `.vscode/mcp.json`, `.copilot/mcp-config.json` — your team should share one pipeline definition.

`.hermit/runs/` is git-ignored by default. Commit it only if you want run artifacts in version control; they contain whatever your agents wrote, so check for anything sensitive first.

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

The three surfaces do not read the same files. Hermit generates for all three from one source, but each needs a different activation step.

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

**`No active Hermit run`.** Start one with `hermit start`, or `hermit runs` to see existing ones — the active run is per-workspace.

**A server says a variable is missing.** Set it and restart the MCP server; hosts read the environment at spawn time, so exporting into an already-running session is not enough.

**Handoff refused.** Working as designed. The response names the exact criterion that failed. Fix that specific thing.

**Doctor reports generated files were edited.** You changed a compiled file by hand. Move the change into `.hermit/` where it survives, or `hermit sync --force` to discard it.

**A project was classified wrong.** Declare it explicitly under `projects` in `.hermit/config.json`, then `hermit sync`.

**Figma bridge stays disconnected.** The plugin must be running in an open Figma file. Check the port matches `figma.bridgePort`. This is not an error condition — the pipeline continues with a written spec.

**CodeCommit calls fail.** Check `AWS_REGION` matches the repository's region and the credentials carry `codecommit:CreatePullRequest`. SigV4 failures report the AWS error type verbatim.

---

## Uninstalling

```bash
npm rm @hermit/cli
rm -rf .hermit .github/agents .github/instructions .copilot AGENTS.md
```

Also remove the `servers` block from `.vscode/mcp.json` (Hermit merges into that file rather than owning it, so other servers you configured are preserved).

Your source code is untouched — Hermit only ever writes to the paths listed above, plus whatever the implementer and documenter agents changed during a run, which live in your normal git history.
