# Hermit Roadmap

## Planned Enhancements

### 1. Hermit UI Developer Agent — **shipped**

An agent expert in **Angular**, **React** and **Flutter** development.

**Scope:**
- Component architecture and best practices for both frameworks
- State management (React Context, Redux, NgRx, etc.)
- Performance optimization (lazy loading, memoization, change detection)
- Testing strategies (unit, integration, E2E)
- Accessibility compliance
- Styling approaches (CSS-in-JS, Tailwind, Material Design, etc.)

**Integration:**
- Works alongside the existing UX Designer agent
- Takes UX designs and implements pixel-perfect, accessible components
- Handles framework-specific concerns that UX Designer doesn't address
- Routes to appropriate skill packs based on detected framework

**As built:**
- `packages/agents/agents/ui-developer.md`, with `frontend-react`, `frontend-angular` and `frontend-flutter` skill packs — the last added once a real mobile framework needed covering, since `kind: mobile` already routed there but with no ecosystem guidance to draw on
- **The pipeline was reordered.** Architecture now runs *before* the UX stages: the architect settles the user flow, services and contracts, and the designer draws screens against a ratified system. `architecture-spec` gained a required `## User Flow` section; the architect no longer reads `ux-hifi`, and the UX designer now reads `architecture-spec`
- **Implementation split into two stages** — `implementation_ui` then `implementation_backend` — which is what resolved the mixed-stack problem below: a full-stack run engages both specialists, one per stage, instead of one agent doing the other's job
- The interface is built first, against the published contract rather than running code, and reports `## Contract Gaps` in `change-set-ui` for the services stage to close
- `implementation_backend` doubles as the catch-all, so infra, libraries and unclassified work still get built
- Verified by `npm run check:specialists`

---

### 2. Hermit Backend Developer Agent — **shipped**

An agent expert in **Python**, **Go**, and **Java Spring Boot** development.

**Scope:**
- API design and REST/GraphQL patterns
- Database schema and ORM patterns (SQLAlchemy, GORM, JPA/Hibernate)
- Authentication and authorization
- Performance optimization and profiling
- Testing strategies (unit, integration, load)
- Infrastructure concerns (logging, metrics, distributed tracing)
- Framework-specific idioms and best practices

**Integration:**
- Works alongside Architect for design decisions
- Implements backend services with framework-appropriate patterns
- Routes to language/framework-specific skill packs
- Coordinates with documentation agent for API specs

**As built:**
- `packages/agents/agents/backend-developer.md`, with four skill packs: `backend-python`, `backend-go`, `backend-java-spring`, `backend-node`
- Claims the implementation stage through a `specializes` block in its frontmatter, matched against the stacks and kinds a run touches. No config; no match leaves `implementer` in place
- A flat single-service repo is classified from its root, so routing works without a monorepo layout
- `architecture-spec` now requires `## Backend Design` (server-side work) and `## Frontend Design` (interface work), each conditional on the run
- Verified by `npm run check:specialists`

---

### 3. Framework Detection and Auto-Enrollment

Enhance `hermit init` to intelligently detect the tech stack and enroll required skills.

**Detection Logic:**
- Scan `package.json` for React, Angular, Vue dependencies
- Scan `requirements.txt`, `go.mod`, `pom.xml`, `build.gradle` for backend frameworks
- Inspect `dockerfile`, `.github/workflows`, and build configs for additional context
- Store detected stack in `.hermit/config.json`

**Auto-Enrollment:**
- React → UI Developer + React-specific skill packs
- Angular → UI Developer + Angular-specific skill packs
- Python → Backend Developer + Python skill packs (Django, FastAPI, Flask, etc.)
- Go → Backend Developer + Go skill packs
- Java → Backend Developer + Spring Boot skill packs
- Combinations → Multiple agents and coordinated skills

**Implementation Details:**
- Detection runs during `hermit init` and can be re-run with `hermit detect`
- Results are editable in `.hermit/config.json` under `detectedFrameworks`
- Skill enrollment is automatic but can be manually overridden
- Print detected stack summary (similar to monorepo detection message)

---

## Implementation Notes

- **No changes to existing pipeline** — new agents slot into stages 8-9 (implementation)
- **Skills-first design** — framework expertise lives in skill packs (reusable, maintainable)
- **Graceful degradation** — if no framework detected, implementer agent handles work
- **Team customization** — tech stacks vary; detection provides smart defaults but users can override
- **Scope enforcement** — UI Developer only writes to UI paths, Backend Developer to backend paths

---

## Priority

- [x] UI Developer Agent
- [x] Backend Developer Agent
- [ ] Framework Detection & Auto-Enrollment
- [x] Claude Code harness
- [x] Chat-based gate decisions
- [x] Run scope from the intent sentence
- [x] Security agent
- [x] Epic / story writer agent

---

### 4. Claude Code harness — **shipped**

`hermit init --harness claude` compiles the same canonical packs into what Claude Code reads, alongside or instead of the Copilot output.

**As built:**
- Harness registry in `packages/cli/src/compile/harnesses.js`; `compileAll` dispatches, `AGENTS.md` stays shared
- `--harness copilot,claude` enables both; the choice persists in `.hermit/config.json` so `sync` never needs the flag
- Dropping a harness reports the files Hermit stops maintaining rather than deleting them
- Claude output: `CLAUDE.md`, `.claude/agents/`, `.claude/skills/` (packs as real loadable skills, not inlined), `.mcp.json`, `.claude/settings.json`
- The main session is the orchestrator — Claude Code has no `mode: primary` equivalent, and a subagent dispatching subagents fights the model
- **Enforcement Copilot cannot express:** write-scope denials, and a `PreToolUse` hook refusing `hermit gate approve|reject|changes` from Bash — the route by which an agent could type the CLI command itself
- Verified by `npm run check:harness` — eight properties, including that a harness changes format but never scope

---

### 5. Chat-based gate decisions — **shipped**

Approvals, changes-requested and rejects were CLI-only. `hermit_decide_gate` reaches all three from chat too, on both harnesses.

**As built:**
- New MCP tool on the `hermit` server, marked `destructive: true` — the only tool in the server carrying that annotation, so a host has a real signal to pause and ask before it runs
- `decideGate` now accepts `source: 'chat'` alongside `'cli'`; any other value is still refused outright
- Orchestrator-only, enforced twice: compiled into only the orchestrator's MCP allowlist on Copilot (role agents never see the tool in their frontmatter), and checked again server-side against the caller's declared `agent` id
- The non-approve decisions (`changes_requested`, `reject`) now require a comment at the `decideGate` level itself, not just in the CLI — the same rule enforced wherever a decision comes from
- `resolveDecider` centralises "who is deciding" (git identity, then OS user) so a chat decision is attributed the same way a CLI one is
- **The trade-off is real, not decorative, and is documented as such:** the host's confirmation prompt *is* the human decision this records. A workspace that auto-approves the `hermit` server has switched that confirmation off — README, INSTALL.md and the compiled orchestrator instructions all say so plainly rather than implying the guarantee is unchanged
- Verified by `scripts/gate-check.mjs` over a real MCP connection: the tool is enumerable and destructive-flagged, a non-orchestrator caller is refused, a comment-less `changes_requested` is refused, and a correct orchestrator call actually advances the run

---

### 6. Run scope from the intent sentence — **shipped**

`hermit start "add cart persistence, skip the UX designs and don't open a PR"` should not need three more flags to say what the sentence already said.

**As built:**
- `packages/core/src/directives.js` — a fixed table of stage targets and aliases, matched against negation cues at word boundaries. **No model reads the intent**: the same sentence always produces the same run shape, and a reviewer can check any decision by reading the table
- Clause-aware. A turn phrase (`but`, `and run`, `however`, …) ends a cue's reach, so "…don't open a PR, but run a security scan" is read as two instructions rather than one long refusal
- Every decision records the phrase that caused it. `hermit start` prints it back and `hermit status` shows it beside the skipped stage, so a sentence the user did not mean to write is visible rather than mysterious
- `--skip ux,pr` and `--with security,tracker` resolve through the same table, by target id, stage id or alias. An unknown name throws rather than silently doing nothing
- **Four stages are locked**: requirements, architecture, review and delivery. Refused at two layers — the parser, and `createRun` itself, so a hand-built `skip` array or a direct `hermit_start_run` call is refused too. A gate a sentence can dissolve is not a gate
- Scope is frozen at run creation. Nothing re-reads the intent, so an agent cannot rephrase its way into or out of a stage
- Verified by `npm run check:scope`

### 7. Security agent — **shipped**

Two jobs on two different clocks, which is why it exists in two places.

**As built:**
- `packages/agents/agents/security.md`, with `dependency-hygiene` and `vulnerability-triage` skill packs
- **Once per repository** — `hermit security` produces `dependency-map` and `security-baseline` into `.hermit/security/`, outside any run, the same shape as onboarding. `securityStatus` reports the baseline stale when a manifest is newer than the recorded map
- **Once per run** — the opt-in `security` stage produces `cve-report`. Placed *before* review on purpose: a dependency bump is a code change, so the reviewer sees it in the same pass
- Patch and minor upgrades are applied and verified against the suite. A fix that exists only in a **major** version never is — it is counted in `**Major upgrades**`, and a non-zero count opens a human gate
- **New mechanism: `gateWhen`.** An `auto` stage that becomes `hitl` when a condition holds. The alternative — gating every security run — would interrupt the majority that have nothing to decide
- The count is read from the report rather than inferred from an empty section, and a report that omits it fails its exit criteria rather than being assumed safe
- **Write scope is manifests and lockfiles only.** A security pass structurally cannot become a refactor the reviewer was not expecting

### 8. Epic / story writer agent — **shipped**

**As built:**
- `packages/agents/agents/story-writer.md`, with the `story-mapping` skill pack
- Opt-in `tracker` stage after planning; produces `story-map` recording the hierarchy it opened, with real tracker keys
- **Turning it on makes `planning` a human gate** (`gateWhen: 'tracker'`). Creating an epic notifies a team, so it follows a human decision — the same shape as the pull request following delivery sign-off. The stage then *executes* an approved plan rather than proposing and asking forgiveness
- Searches before it creates. A duplicate epic is cleanup someone does by hand, and it is the most common damage this stage could do
- Acceptance criteria are copied verbatim, never paraphrased — QA executes the ratified originals
- Work the approved plan does not contain goes under `## Gaps`, not into the tracker
- Writes no files: no `writes.paths`, so it gets no edit or execute tools in either harness


---

## What remains

Only item 3, and it is narrower than written above — language detection already
ships, because routing needed it.

**Done:** the language and kind of every project in scope (`python`, `go`, `jvm`,
`node`, `flutter`; `frontend`, `backend`, `batch`, `infra`, `mobile`, …), recorded on
the run and driving which agent takes each implementation stage.

**Remaining:** detecting the *framework within* a language — Django vs FastAPI vs
Flask, Gin vs Echo, React vs Angular — and loading only the packs that apply. Today
`ui-developer` carries React, Angular and Flutter guidance regardless of which the
project uses, and `backend-developer` carries all four languages. That is wasted
context and diluted focus, which is the failure the one-pack-per-technology split
was meant to avoid.

Flutter is the one case this is already partly solvable for: unlike React and
Angular, which both sit under the generic `node` stack and are indistinguishable
without dependency inspection, Flutter has its own detectable stack (`pubspec.yaml`).
A future pass could route a `stack: [flutter]` project to a Flutter-only skill set
immediately, without waiting for the harder React/Angular/backend-framework split.
