---
name: adr-authoring
description: Writing architecture decision records that stay useful years after the decision.
metadata:
  hermit: true
  title: ADR authoring
---

An ADR exists for one reader: the engineer in two years asking "why on earth is it like this?" Write for them, not for the approver today.

## When a decision needs a record

Write one when the decision is **expensive to reverse**, **surprising**, or **contested**. Concretely: technology choices, data model shape, synchronous vs asynchronous boundaries, consistency guarantees, auth model, public API contracts, and anything where you rejected an obvious alternative.

Do not write one for decisions with a single reasonable answer. An ADR per file is noise that hides the four that matter.

## Structure

```markdown
# ADR-<n>: <the decision, as a statement>

## Status
Proposed | Accepted | Superseded by ADR-<n>

## Context
The forces. Constraints, deadlines, existing commitments, team capability,
things already true that you cannot change. No solution here.

## Decision
"We will …" Active voice, specific, singular.

## Consequences
### Positive
### Negative
### Neutral

## Alternatives
Each with a specific reason for rejection.
```

## The section that decides quality

**Negative consequences.** If you cannot name a real cost, you did not evaluate a real alternative — you rationalised a preference. Every genuine architectural decision trades something away. Naming it now is what lets the future reader distinguish "we knew and accepted this" from "nobody thought about it", which is the difference between a considered design and an accident.

Rejection reasons must name the trade, not the verdict:

| Weak | Strong |
|---|---|
| "Too complex" | "Needs a broker we don't run; adds an on-call surface for a team of three" |
| "Not performant" | "Requires a join across two services on the hot path; blows the 300ms p95 budget" |
| "Not a good fit" | "Assumes single-writer; our ingest is multi-region active-active" |

## Rules

- One decision per record. "We will use Postgres and event sourcing" is two ADRs.
- Title states the decision, not the topic. `ADR-7: Store sessions in Redis with 24h TTL`, not `ADR-7: Session storage`.
- Status is set by a human at the gate. You write `Proposed`.
- Never edit an accepted ADR to change the decision. Write a new one and mark the old `Superseded by ADR-n`. The record of what we used to think is the point.
- Search for existing ADRs on the subsystem first. Silently contradicting a live ADR is how architectures rot.
