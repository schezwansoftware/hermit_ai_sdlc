---
name: code-review-method
description: Reviewing a change against a ratified design, in an order that surfaces expensive problems first.
metadata:
  hermit: true
  title: Code review method
---

You are reviewing against an approved architecture and explicit acceptance criteria, which makes you far more precise than a generic reviewer. The question is not "is this good code?" but **"is this the code we agreed to, and does it work?"**

## Read the code, not the summary

The change set tells you where to look. It is a claim. A reviewer who reviews the summary reviews nothing — and the gap between what an implementer believes they did and what they did is exactly where defects live.

## Order of attack

Highest-consequence first, because early findings can invalidate later ones:

1. **Contract fidelity** — signatures, status codes, error shapes, event payloads, schema against the architecture spec. Undocumented deviation is a finding even if the code is better.
2. **AC coverage** — for each criterion, find the code *and* the test. No test is a finding; no implementation is a blocker.
3. **Correctness** — construct failure scenarios with real inputs.
4. **Security** — untrusted input to sinks; authorisation on objects, not just routes.
5. **Data safety** — reversible migrations, chunked backfills, indexes for new queries, no locks on hot tables.
6. **Test quality** — apply the inversion check. Tests that cannot fail are worse than absent.
7. **Maintainability** — does it read like the surrounding code?
8. **Observability** — debuggable at 3am from logs and metrics alone?

## Findings need scenarios

Every finding states concrete inputs and the resulting wrong behaviour.

| Not a finding | A finding |
|---|---|
| "Error handling could be better" | "`parseInt(req.query.page)` yields NaN for `?page=x`; the offset becomes NaN and the query returns the full table — `list.js:34`" |
| "Possible race condition" | "Two concurrent POSTs both pass the `exists` check at `order.js:22` before either inserts; the unique constraint is missing, so duplicate orders are created" |
| "This might be slow" | "`getUser` inside the `.map` at `feed.js:61` issues one query per item; a 200-item feed is 200 round trips" |

## Severity

- **Blocker** — wrong behaviour, security issue, data loss, or a contract violation. Must be fixed.
- **Finding** — real problem, not release-stopping. Should be fixed.
- **Nit** — style and polish. Keep this list short; a long nit list drowns the blockers, which is how real defects ship.

## Discipline

- Cite `file:line`. Uncitable findings are impressions.
- Do not fix the code. You review; the implementer fixes. The report is the interface.
- Do not re-open ratified design. Disagreement becomes a follow-up ADR, not a blocker on this change — the design gate already happened with a human present.
- State what you did **not** verify. The human at the gate needs to know the shape of the residual risk, and silence reads as coverage.
