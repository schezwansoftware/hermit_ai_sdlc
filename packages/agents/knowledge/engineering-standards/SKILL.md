---
name: engineering-standards
description: Baseline engineering standards applied across the pipeline. Teams are expected to override this file.
metadata:
  hermit: true
  title: Engineering standards
---

> **This file is meant to be edited.** It ships with defensible defaults so the
> pipeline works on day one. Replace it with your team's actual standards — it is
> injected into every agent's context, so it is the cheapest way to make all nine
> agents behave like your team rather than like a generic one.

## Code

- Match the surrounding code before matching any external style guide. Consistency inside a file beats correctness against a document nobody reads.
- Names describe intent, not type or implementation. `retryBudget`, not `numRetries2`.
- Functions do one thing at one level of abstraction.
- Comments explain *why*. The code already says what. A comment restating the line below it is a maintenance liability.
- No dead code, no commented-out code. Version control remembers.

## Errors

- Fail fast and loudly at boundaries; degrade gracefully inside them.
- Never swallow an error. Handle it, wrap it with context, or propagate it.
- Error messages state what failed, what was expected, and what to do — for the person reading a log at 3am with none of your context.
- Never leak internals to callers: no stack traces, no queries, no account-existence disclosure.

## Testing

- Tests ship with the code, in the same package of work.
- Test behaviour, not implementation. Apply the inversion check.
- Deterministic: no real clock, no real network, no unseeded randomness, no order dependence.
- A flaky test is a failing test.

## Security

- No secrets in source, tests, fixtures, logs, or comments.
- Validate at the trust boundary; parameterise every query; allowlist rather than blocklist.
- Authorisation on the object, not just the route. Ask whether user A can pass user B's id and get a 200.
- New dependencies need a reason. Every one is a supply-chain surface and a permanent upgrade obligation.

## Data

- Migrations are reversible, or their irreversibility is stated in bold at the architecture gate.
- Backfills are chunked, resumable, and observable.
- New query patterns get indexes in the same change.
- Classify personal data explicitly; it determines retention, logging and encryption.

## Observability

- Structured logs with correlation ids. Never log secrets or full request bodies.
- Every new failure path is either alerted or explicitly accepted as silent.
- If you cannot debug it from logs and metrics alone, it is not finished.

## Documentation

- The ADR captures why. The code captures what. The README captures how to run it.
- Update the docs in the same change as the behaviour. Documentation updated later is documentation not updated.

## Accessibility

- WCAG 2.2 AA is the floor for anything user-facing.
- Specified at design time, not retrofitted at review.
