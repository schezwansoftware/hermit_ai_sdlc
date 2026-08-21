---
name: documentation-maintenance
description: Finding and fixing the documentation a change silently invalidated, rather than writing new documents.
metadata:
  hermit: true
  title: Documentation maintenance
---

Most documentation damage is not missing pages. It is pages that are confidently wrong, because the code moved and nothing failed.

## Find candidates mechanically

Never scan documentation looking for things that feel outdated. Derive the search set from the change:

| From the change set | Search documentation for |
|---|---|
| Changed file paths | The path, the filename, the module name |
| Changed function or class | The identifier, and its usage in code samples |
| Changed endpoint | The route string, the HTTP verb, the payload field names |
| Changed config key | The literal key, and any example config block |
| **Renamed anything** | The **old** name — everywhere |
| New dependency | The install and setup instructions |
| Changed env var | The variable name in setup docs, `.env.example`, deployment guides |

The rename row finds more real defects than all the others combined. A rename breaks nothing at build time, so nobody is prompted to look.

## Places that rot quietly

- **Code samples in prose.** Nothing compiles them. Check each against the real signature.
- **Setup and quickstart.** The most-read page and the least-maintained, because the people who maintain it never run it fresh.
- **Architecture diagrams.** Usually images; nobody updates the source. Flag them even if you cannot edit them.
- **Runbooks.** Steps referencing renamed services page someone at 3am.
- **`.env.example` and config references.** Drift immediately and break onboarding.
- **API reference generated at some point in the past** and then hand-edited, so regenerating would lose changes.

## Editing well

Match the document's existing voice, structure and heading depth. A section in a different register reads as an intrusion and gets reverted.

Fix the specific claim that is wrong. Do not rewrite the surrounding page because you would have structured it differently — that turns a reviewable two-line diff into an unreviewable rewrite, and reviewers approve unreviewable diffs.

Never document what is not implemented. Aspirational documentation is worse than absent documentation, because readers trust it and build on it.

## Record what you did not change

An audit trail of documents checked and deliberately left alone is as valuable as the edits. Silence about a document is indistinguishable from never having looked at it, and the next person repeats your work.

## Creating a new document

Only when no existing document is the right home. Then answer: where is it linked from, who owns it, and what makes it different from the page it is closest to? An unlinked document is a document nobody will read and everybody will duplicate.
