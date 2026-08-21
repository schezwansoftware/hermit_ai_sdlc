---
name: pr-authoring
description: Writing a pull request that a reviewer can act on, across GitHub, Bitbucket, GitLab and CodeCommit.
metadata:
  hermit: true
  title: Pull request authoring
---

A pull request is a request for someone's attention. Respect it: say what changed, why, and what you need from them.

## Title

`<type>: <what changed>`, imperative, under 70 characters, with the tracker key where the team's convention expects it.

```
feat(checkout): preserve cart across expired sessions  [PROJ-412]
fix(auth): reject refresh tokens issued before a password change  [PROJ-455]
```

Not `Updates`, not `PROJ-412`, not `Changes as discussed`.

## Body

```markdown
## What
Two or three sentences. What behaviour is different now.

## Why
The problem, linked to the tracker item. A reviewer who never read the ticket
should understand the motivation from this paragraph alone.

## How
The approach, and the one or two decisions a reviewer might question. Link the ADR.

## Verification
The commands run and their results. Not "tested locally".

## Risk & rollback
What could break, and how to undo this.

## Review focus
Where you want attention. This is the highest-value section and the most
commonly omitted one: it converts a 900-line scroll into three specific questions.

## Not in this PR
Explicitly deferred work, with follow-up links. Pre-empts "why didn't you also…".
```

## Provider differences

The `scm` tools present one surface, but be aware of what varies underneath:

| | GitHub | GitLab | Bitbucket | CodeCommit |
|---|---|---|---|---|
| Object | Pull request | Merge request | Pull request | Pull request |
| Draft state | Yes | Yes (`Draft:` prefix) | No | No |
| Reviewer assignment | Users and teams | Users and groups | Users | ARNs |
| Body format | GitHub Markdown | GitLab Markdown | Bitbucket Markdown | Plain-ish |

Write the body in plain CommonMark. Provider-specific syntax — task lists, mentions, issue autolinks — renders as literal noise on the providers that do not support it. Keep the tracker link as a full URL rather than a shorthand reference.

## Before opening

- The diff matches the change set. Files in the diff that the change set never mentions are a stop-the-line event, not a footnote.
- No secrets, no debug statements, no commented-out code, no unrelated formatting churn.
- The branch is current with the base.
- Tests pass, and the body says so with real output.

## After opening

Link the PR back to the tracker item and the Hermit run, in both directions. A PR that cannot be traced to its requirements is the point at which the audit trail this pipeline exists to produce quietly ends.
