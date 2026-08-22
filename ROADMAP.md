# Hermit Roadmap

## Planned Enhancements

### 1. Hermit UI Developer Agent

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

- [ ] UI Developer Agent
- [x] Backend Developer Agent
- [ ] Framework Detection & Auto-Enrollment

## Notes for the UI Developer agent

The routing mechanism is in place and is what the UI agent should reuse: declare a
`specializes` block for the `implementation` stage matching `kind: [frontend, mobile]`.

One thing to resolve first — a run holding both a React app and a Go service currently
matches two specialists and the first by agent id wins. Splitting one stage between two
agents needs work-package-level dispatch, which the ledger does not model yet. Until then
the mixed case is a known limitation, called out in `resolveStageAgent`.
