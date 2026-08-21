---
name: exploratory-testing
description: Finding the defects a written test plan will not, by attacking assumptions deliberately.
metadata:
  hermit: true
  title: Exploratory testing
---

The test plan covers what someone thought of. Exploratory testing covers what they did not — which is where the interesting defects are.

## Where to aim

Spend your time where risk concentrates, not uniformly:

- The `## Deviations` and `## Known Gaps` sections of the change set.
- Whatever the reviewer listed as not verified.
- New boundaries between components — integration seams fail more than internals.
- Anything touching money, time, identity, or permissions.
- The code the implementer wrote last, under the most schedule pressure.

## Heuristics that find things

**Break the sequence.** Do steps out of order. Go back. Refresh mid-flow. Open two tabs and act in both. Submit twice quickly.

**Break the input.** Empty, whitespace only, maximum length, maximum + 1, zero, negative, `0.1 + 0.2`, emoji, right-to-left text, `'; DROP`, `../../etc/passwd`, a 10MB paste.

**Break the assumption of a happy dependency.** Kill the network mid-request. Return a 500 from the API. Make it slow rather than failed — timeouts are handled far less often than errors.

**Break the identity.** Log out in another tab. Let the session expire mid-form. Act as a user without permission. Use another tenant's identifier in a URL and see whether you get a 200.

**Break the time.** Cross midnight, cross a DST boundary, set a timezone twelve hours away, submit a date in the past and one in 2099.

## Recording

For anything surprising, capture: the exact steps, the input, what you expected, what happened, and whether it reproduces. A defect that cannot be reproduced still gets recorded — with that fact stated, since intermittent defects are usually the serious ones.

Raise a tracker item for anything not being fixed in this run, and link it to the parent issue. An unreported observation is an unfixed defect with extra steps.

## Timebox

Exploration is unbounded by nature. Fix a budget, spend it on the highest-risk areas first, and report what you did not get to. "I explored auth and payments; I did not explore the export flow" is honest and actionable. Silence implies coverage you did not provide.
