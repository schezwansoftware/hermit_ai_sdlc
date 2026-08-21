---
name: work-breakdown
description: Decomposing a design into independently completable, independently reviewable packages.
metadata:
  hermit: true
  title: Work breakdown
---

A work package is a unit that one engineer finishes, tests and gets reviewed without waiting on anyone.

## Sizing

Right-sized: a focused change touching one component, with its tests, reviewable in a sitting.

Signals it is too large: touches more than one component in the Component Map; the title needs "and"; the `Done when` has more than four conditions; you cannot name the files.

Signals it is too small: it cannot be tested alone; it has no reviewable meaning; it exists only because you were enumerating.

## Ordering

1. **Dependencies first** — a package cannot precede what it needs.
2. **Risk second** — front-load anything that could invalidate the design. Discovering the approach is wrong at package 2 costs two packages; at package 9 it costs nine.
3. **Reviewability third** — sequence so each package is a coherent story on its own.

## Every package needs

- **Satisfies** — the AC ids. A package satisfying none is scope you invented.
- **Done when** — verifiable conditions. Not "implemented"; "the endpoint returns 409 on duplicate submission, covered by a test".
- **Tests** — named, and part of *this* package. A trailing "add tests" package is how untested code ships under schedule pressure.
- **Files** — the expected paths. Being wrong is fine; being unable to guess means the package is underspecified.

## Traceability check

Before you finish: every AC maps to at least one package. Walk the list explicitly. An unmapped AC is a hole that surfaces at QA, four stages later, when it is most expensive.

## Migrations and rollback

These are packages, not footnotes. A schema change is at minimum: the migration, the backfill, the code change, and the rollback path. Leaving them implicit means they get done under pressure at the end, which is exactly when they should not be.
