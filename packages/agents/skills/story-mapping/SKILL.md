---
name: story-mapping
description: Turning an approved work breakdown into tracker items a team can pick up without asking a question.
metadata:
  hermit: true
  title: Story mapping
---

## Express the plan; do not re-plan it

The work breakdown was approved by a person. Your job is translation into tracker terms — not improving the split, not adding the work you would have included. Work the plan missed is recorded as a gap for a human to decide on. Anything else means someone approved one thing and the team received another.

## Choose the smallest honest hierarchy

- **One story** for a single change with a handful of criteria. An epic containing one story is ceremony.
- **An epic with stories** when several units ship independently toward one goal. The usual case.
- **Tasks under a story** only where the split follows a boundary a *different person* could take — frontend/backend, migration/cutover. Same person, same sitting: that is a checklist in the description, not sub-issues.

Depth costs something. Every level is a thing to update, close, and report on.

## A story is independently deliverable

The test: could this ship alone and be worth something? A story that only makes sense once its sibling lands is half a story — either merge them or move the boundary.

Vertical, not horizontal. "Persist cart on session expiry" cuts through UI, service and storage and delivers a behaviour. "Add the cart table" delivers nothing on its own and cannot be demonstrated or tested against a criterion.

## Copy acceptance criteria verbatim

The Given/When/Then in the ratified artifact is what QA will execute. Paraphrasing it introduces a second version, and the two diverge the first time either is edited. Copy it exactly, and give every criterion to exactly one story — a criterion split across two stories means the split is in the wrong place.

## Titles name outcomes

> Not: "Update CartService"
> But: "Persist cart contents across session expiry"

Use the glossary's terms. A title in implementation vocabulary makes the backlog unreadable to everyone who is not already in the code, which is most of the people who read it.

## Search before you create

Pipelines get re-run. Before creating anything, search for the run's tracker key, the epic title, and near-duplicate story titles. A duplicate epic is cleanup someone does by hand, and it is the most common damage this work causes.

When the run already carries a ticket, that issue is the parent unless its type makes that impossible. Link to it rather than creating a rival beside it.

## Leave the fields you cannot know

No estimates, no sprint, no assignee. You do not know the team's velocity or who is free. Filling these in makes the output look authoritative in a way it has not earned, and someone has to undo it.

Dependencies are the exception: record them as real tracker links between real keys, not as prose in a description. Prose dependencies are invisible to every board and report the team actually uses.
