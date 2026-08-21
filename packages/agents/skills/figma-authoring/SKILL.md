---
name: figma-authoring
description: Creating real Figma frames through the Hermit plugin bridge, and degrading gracefully when it is unavailable.
metadata:
  hermit: true
  title: Figma authoring
---

## The constraint

Figma's REST API **cannot create frames or layers**. It reads files, components, styles and images, and it writes comments, dev resources and variables. Authoring requires the Plugin API, which runs inside Figma.

Hermit bridges the gap: `figma_create_design` sends a scene-graph spec over a local WebSocket to a companion plugin running in the designer's Figma session, which builds the frames.

## Always check the bridge first

Call `figma_bridge_status` before attempting to author.

- **`connected`** — proceed.
- **`disconnected`** — do not retry in a loop and do not treat it as a failure. Embed the spec in `ux-hifi`, state that the bridge was unavailable, and continue. A complete written specification is a valid deliverable.

## What works regardless

- `figma_upsert_variables` — publish `design-tokens` as Figma variables, giving code and design one source of truth. Do this even when you cannot draw.
- `figma_create_dev_resource` — attach the Hermit run and tracker links to a frame, so an engineer opening it finds the spec.
- `figma_post_comment` — record a decision against the design.

## Scene-graph spec

```json
{
  "page": "Hermit — PROJ-412",
  "frames": [{
    "name": "Checkout / Expired session",
    "width": 1440, "height": 900,
    "layout": { "mode": "VERTICAL", "spacing": "space.4", "padding": "space.6" },
    "children": [
      { "type": "INSTANCE", "componentKey": "abc123", "name": "Header",
        "overrides": { "title": "Your session expired" } },
      { "type": "TEXT", "characters": "Sign in to keep your cart.",
        "style": "type.body.md", "color": "color.text.secondary" }
    ]
  }]
}
```

Colour, spacing and type are **token names**, never literals. The plugin resolves them against the file's variables; an unresolvable token is reported back rather than silently substituted.

## Rules

- **Compose from library components.** Reference by `componentKey`. A frame rebuilt from primitives looks identical, is detached from the design system, and is worse than no frame — it will not inherit fixes.
- **Name layers as an engineer reads them.** `CheckoutSummary/TotalRow/Label`, not `Frame 47`. These names become the implementer's map.
- **Author onto a Hermit-owned page**, named for the run. Never into a designer's working page.
- **Never modify existing frames.** You create. If an existing frame is wrong, comment on it and raise it at the gate.
- **Every frame maps to a state** from `ux-midfi`. One frame per state, named for the state — the empty and error frames are the reason this stage exists.
- **Report what you built.** `ux-hifi` lists every created frame with its node id, so the gate reviewer can open them.
