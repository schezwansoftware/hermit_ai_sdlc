---
name: acceptance-criteria-authoring
description: Writing criteria that QA can execute and a reviewer can trace without asking questions.
metadata:
  hermit: true
  title: Acceptance criteria authoring
---

An acceptance criterion is executable by a stranger. If verifying it requires knowing what you meant, it is not a criterion — it is a note.

## Form

```
## AC-<n> — FR-<n> — <short name>
**Given** <precise starting state>
**When** <single action>
**Then** <observable, checkable outcome>

**Verified by**: unit | integration | e2e | manual
```

## The tests of a good criterion

- **Observable** — outcome visible from outside: a response, a rendered state, a stored row, an emitted event. Never "the token is validated correctly".
- **Precise state** — "an authenticated user" is not a state. "A user with role `editor` and a session older than 24h" is.
- **Single action** — one `When`. Two actions means two criteria.
- **Falsifiable** — you can describe the input that makes it fail. If you can't, it isn't testable.
- **Implementation-free** — no class names, no endpoints, no storage choices. Those are the architect's, and pinning them here forecloses design.

## Coverage

Each functional requirement needs at least one happy-path criterion and at least one failure criterion. Then sweep: boundaries (0, 1, max, max+1), authorisation (wrong user, no user, expired), concurrency (two writers), and degradation (dependency unavailable).

## Non-functional criteria

These need a measurement method, or they are not criteria:

```
**Given** 50 concurrent users on the search endpoint
**When** sustained for 5 minutes
**Then** p95 latency stays under 300 ms, measured by the load-test suite
```

## Anti-patterns

| Bad | Why | Better |
|---|---|---|
| "Then it works correctly" | Unfalsifiable | Name the observable outcome |
| "Then the data is saved" | Where? Checkable how? | "a row exists in `orders` with status `pending`" |
| "Then the UI looks right" | Not verifiable | Cite the design spec and the specific state |
| "Then performance is acceptable" | No number | State the budget and how it's measured |
