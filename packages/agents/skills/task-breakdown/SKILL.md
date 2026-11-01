---
name: task-breakdown
description: Splitting a Jira Story into Tasks, or a Task into Subtasks, without inventing scope or creating issue types the team did not approve.
metadata:
  hermit: true
  title: Task breakdown
---

## Express the plan; do not re-plan it

The work breakdown was approved by a person. Your job is translation into Jira terms. Work the plan missed is recorded as a gap for a human to decide on, never created.

## Two levels, and only two

- **Story into Tasks.** One Task per unit that a person could pick up and finish without waiting on a sibling. Tasks are linked to the Story, not parented under it.
- **Task into Subtasks.** One Subtask per step of a single piece of work. Subtasks have a parent.
- **A Subtask is not split further.** If it feels too big, the Task was cut wrong; say so under Gaps.
- **No Epics, Stories or Bugs.** Those are made by people.

Depth costs something: every item is a thing to update, move and report on. Split only where the split follows a boundary somebody could take independently (frontend and backend, migration and cutover). Steps one person does in one sitting are a checklist in the description, not separate items.

## Sizing

A good Task ships a behaviour and can be tested against a criterion on its own. "Add the cart table" delivers nothing alone; "Persist cart contents across session expiry" does.

Too big: touches more than one component, needs "and" in the title, has more than four conditions in its definition of done.
Too small: cannot be tested alone, has no reviewable meaning, exists because you were enumerating.

## Acceptance criteria and definition of done

- Acceptance criteria are copied verbatim from the ratified artifact, in Given/When/Then. QA runs the originals; a paraphrase is a second version that drifts.
- Every criterion goes to exactly one item. A criterion split across two items means the split is in the wrong place.
- Definition of done is a short checklist of verifiable conditions: named tests passing, review done, docs updated when behaviour changes. Not "implemented".

## Titles name outcomes

Not "Update CartService". Use "Persist cart contents across session expiry", in the glossary's words.

## Search before you create

Before creating anything, list the ticket's existing links and subtasks and search for near-duplicate titles. A duplicate set of items is the most common damage this work does.

## Leave the fields you cannot know

No estimates, no sprint, no assignee. Dependencies are the exception: record them as real Jira links between real keys, not as prose.
