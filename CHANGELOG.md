# Changelog

Hermit's version is set in `packages/core/src/version.js` and shown by
`hermit doctor` and `hermit --version`. Bump it in the change that ships the
work: patch for fixes and maintenance, minor for a backward-compatible feature,
major for a breaking change to the CLI, the MCP tools, or the gate/artifact/
pipeline contracts.

## 1.1.0

- Plain-language approval gates (HERMIT-18): every gated stage carries a `plain`
  explanation of what approving it means, and the gate message leads with it.
- Provisional gate approvals (HERMIT-7): an approver may attach a confidence
  level (60/80/95) and a list of assumptions; downstream briefs carry the caveat.
- `hermit doctor` now reports the running Hermit version; added `hermit version`
  / `hermit --version`.

## 1.0.0

Baseline — everything shipped through PR #26: the SDLC pipeline and HITL gates,
context scoping, onboarding and security baselines, the workflow/Jira/Confluence/
SCM MCP servers, specialist routing, mid-run scope narrowing, and the agent
thinking trace.
