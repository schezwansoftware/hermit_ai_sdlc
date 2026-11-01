---
name: story-mapping
description: Refining an existing Jira story so a team can pick it up without asking a question.
metadata:
  hermit: true
  title: Story refinement
---

## Refine; do not rebuild

The story exists and a person wrote it. Keep what is still right. Change what is unclear, missing or wrong, and say what changed and why in one comment, so nobody has to diff it.

You may update a story. You may not create one, or create anything under it. Tasks and Subtasks come from the Jira tracker agent, working from an approved plan.

## A story is independently deliverable

The test: could it ship alone and be worth something? A story that only makes sense once a sibling lands is half a story. Say so in the comment and suggest where the boundary should move; do not make the split yourself.

Vertical, not horizontal. "Persist cart on session expiry" cuts through UI, service and storage and delivers a behaviour. "Add the cart table" delivers nothing alone and cannot be tested against a criterion.

## Titles name outcomes

> Not: "Update CartService"
> But: "Persist cart contents across session expiry"

Use the glossary's terms. A title in implementation vocabulary makes the backlog unreadable to everyone who is not already in the code.

## Copy acceptance criteria verbatim

When a ratified `acceptance-criteria` artifact exists, the Given/When/Then in it is what QA will execute. Paraphrasing creates a second version, and the two drift the first time either is edited. Copy it exactly. A criterion that appears in two stories means the split is in the wrong place; raise it, do not fix it.

## Leave the fields you cannot know

No estimates, no sprint, no assignee. Filling these in makes the output look authoritative in a way it has not earned.
