---
name: requirements-elicitation
description: Extracting a real specification from a thin ticket and scattered documentation.
metadata:
  hermit: true
  title: Requirements elicitation
---

The requirement is rarely in the ticket description. It is distributed across comments, linked issues, a Confluence page nobody linked, and one Slack decision that was never written down.

## Where it actually lives

1. **Ticket comments** — the description is what someone thought at the start; comments are where it changed.
2. **Linked issues** — blocks, relates-to, duplicates. Duplicates are gold: they show what people keep asking for.
3. **Prior art** — search the tracker for the same feature area. Previous attempts explain constraints nobody will restate.
4. **Documentation** — search by feature name *and* by product area, since the page will be named neither.

## Turning vagueness into decisions

For each ambiguity, do not simply flag it. Produce: the options, the trade-off between them, your recommendation, and the reason. A human at a gate can ratify or overturn a recommendation in seconds; they cannot resolve an open question without doing your job for you.

Ambiguity that must always be resolved explicitly:

- **Quantities** — "fast", "large", "many", "recent". Attach numbers.
- **Actors** — "the user" is which role, with which permissions?
- **Scope of change** — new behaviour, or a change to existing behaviour? The second needs a migration story.
- **Failure behaviour** — what happens when the dependency is down? This is almost never specified and almost always matters.
- **Persistence** — what is stored, for how long, and is any of it personal data?

## Unhappy paths

Sweep these deliberately; they are where specifications are thin:

empty state · first run · maximum size · concurrent edit · unauthorised access · expired session · network failure mid-operation · partial success · duplicate submission · out-of-order events · timezone and locale boundaries.

## Scope discipline

Write `Out of Scope` before `In Scope`. Naming the exclusions first makes the inclusions obvious, and it pre-empts the most expensive category of late argument.
