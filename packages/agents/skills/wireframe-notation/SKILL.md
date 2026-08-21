---
name: wireframe-notation
description: A consistent text notation for expressing wireframes at low and mid fidelity.
metadata:
  hermit: true
  title: Wireframe notation
---

Wireframes here are text, because text diffs, reviews and survives. The notation must be unambiguous enough that an implementer builds the right structure from it.

## Regions

```
+--------------------------------------------------+
| [logo]                          [search] [avatar] |   <- header
+------------+-------------------------------------+
| NAV        |  H1: Page title                     |
| - Item     |                                     |
| - Item     |  {content region}                   |
|            |                                     |
|            |  [ Primary ]  [ Secondary ]         |
+------------+-------------------------------------+
```

## Element conventions

| Notation | Means |
|---|---|
| `[ Label ]` | Button |
| `[input: placeholder]` | Text input |
| `[select: a / b / c]` | Dropdown, options listed |
| `( ) option` / `(•) option` | Radio, unselected / selected |
| `[ ] label` / `[x] label` | Checkbox |
| `{region name}` | Container whose contents are specified elsewhere |
| `« item »` | Repeating item — say how many and what drives the count |
| `H1:` `H2:` | Heading level — the semantic level, not the visual size |
| `→ target` | Navigation, naming the destination screen id |
| `⚠ message` | Error or warning region |

## Fidelity discipline

**Low fidelity** shows what exists and where it sits. No colour, no fonts, no spacing values, no icon choices. If a reviewer comments on aesthetics, the wireframe is too detailed and is stealing the review.

**Mid fidelity** adds behaviour: real copy, validation, and one wireframe per *state* rather than per screen. The empty state and the error state are separate diagrams — that is the point of the stage.

## States to draw at mid fidelity

Every screen gets its full set: default · empty · loading · partial · error · offline · unauthorised · maximum content · success. Nine diagrams per screen sounds like a lot until the eighth one turns out to be the reason the feature gets rebuilt.

## Annotations

Number anything needing explanation and annotate below the diagram:

```
  [ Submit ]  (1)

1. Disabled until all required fields validate. On click: optimistic update,
   spinner in-button, 8s timeout → inline error, form state preserved.
```
