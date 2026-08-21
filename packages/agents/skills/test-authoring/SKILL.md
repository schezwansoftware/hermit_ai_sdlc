---
name: test-authoring
description: Writing tests that verify behaviour against acceptance criteria rather than restating the implementation.
metadata:
  hermit: true
  title: Test authoring
---

A test earns its place by failing when the behaviour is wrong. A test that passes no matter what the code does is worse than no test — it manufactures confidence.

## The inversion check

For every test, ask: **if I inverted the logic under test, would this fail?** If not, the test asserts the implementation back at itself. The usual culprits:

- Mocking the thing you are testing.
- Asserting a call happened rather than that the outcome occurred.
- Copying the implementation's arithmetic into the expectation.
- Snapshots regenerated without being read.

## Derive from criteria, not from code

Write cases from the acceptance criteria **before** reading the implementation. Reading first biases you toward the paths the implementer already considered — which are exactly the paths that already work.

Each AC maps to at least one test, named so the mapping is obvious:

```
test('AC-3: expired session preserves the cart and redirects to sign-in')
```

## Choosing a level

| Level | Use for | Keep it |
|---|---|---|
| Unit | Logic, branches, edge cases, error paths | Fast, no I/O, many |
| Integration | Component boundaries, real DB, real serialisation | Fewer, realistic |
| E2E | Critical user journeys only | Very few, stable |

Test at the lowest level that can actually catch the defect. An e2e test for a validation rule is slow, flaky, and tells you less than a unit test.

## Coverage that matters

Beyond the happy path, deliberately cover: empty and null, zero, one, many, maximum, maximum + 1, unauthorised, expired, concurrent, malformed, duplicate submission, dependency unavailable, and timeout.

For anything involving money, time, or text from users: floating-point rounding, timezone and DST boundaries, and non-ASCII input. These three account for a startling share of production defects.

## Hygiene

- **Deterministic.** No real clock, no real network, no random without a fixed seed, no dependence on test order.
- **Flaky is failing.** A test that passes on retry is a defect — in the test or the code. Record it either way.
- **One reason to fail.** When it goes red, the name should tell you what broke.
- **Arrange–act–assert**, visibly separated. A reader should locate the action in one second.
- **Fixtures over factories over literals**, but never a shared mutable fixture across tests.
