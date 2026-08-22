# Hermit Roadmap

## Planned Enhancements

### 1. Hermit UI Developer Agent — **shipped**

An agent expert in **Angular** and **React** development.

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
- `packages/agents/agents/ui-developer.md`, with `frontend-react` and `frontend-angular` skill packs
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
- `packages/agents/agents/backend-developer.md`, with three skill packs: `backend-python`, `backend-go`, `backend-java-spring`
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

---

### 4. Claude Code harness — **shipped**

`hermit init --harness claude` compiles the same canonical packs into what Claude Code reads, alongside or instead of the Copilot output.

**As built:**
- Harness registry in `packages/cli/src/compile/harnesses.js`; `compileAll` dispatches, `AGENTS.md` stays shared
- `--harness copilot,claude` enables both; the choice persists in `.hermit/config.json` so `sync` never needs the flag
- Dropping a harness reports the files Hermit stops maintaining rather than deleting them
- Claude output: `CLAUDE.md`, `.claude/agents/`, `.claude/skills/` (packs as real loadable skills, not inlined), `.mcp.json`, `.claude/settings.json`
- The main session is the orchestrator — Claude Code has no `mode: primary` equivalent, and a subagent dispatching subagents fights the model
- **Enforcement Copilot cannot express:** write-scope denials, and a `PreToolUse` hook refusing `hermit gate approve|reject|changes` from Bash. That closes the last route by which an agent could decide its own gate
- Verified by `npm run check:harness` — eight properties, including that a harness changes format but never scope

---

## What remains

Only item 3, and it is narrower than written above — language detection already
ships, because routing needed it.

**Done:** the language and kind of every project in scope (`python`, `go`, `jvm`,
`node`; `frontend`, `backend`, `batch`, `infra`, …), recorded on the run and driving
which agent takes each implementation stage.

**Remaining:** detecting the *framework within* a language — Django vs FastAPI vs
Flask, Gin vs Echo, React vs Angular — and loading only the packs that apply. Today
`ui-developer` carries both React and Angular guidance regardless of which the project
uses, and `backend-developer` carries all three languages. That is wasted context and
diluted focus, which is the failure the one-pack-per-technology split was meant to avoid.
