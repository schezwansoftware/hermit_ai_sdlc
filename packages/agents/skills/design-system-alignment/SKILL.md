---
name: design-system-alignment
description: Specifying designs in terms of existing components and tokens rather than inventing new ones.
metadata:
  hermit: true
  title: Design system alignment
---

Every new component is permanent maintenance cost, borne by people who did not attend this design. Reuse is the default; novelty needs a case.

## Before designing

Inventory what exists: `figma_get_components` and `figma_get_styles` for the library, plus any tokens file in the repo (`tokens.json`, `theme.ts`, Tailwind config, CSS custom properties). Read how the last two features were built — the real system is what shipped, not what the library documents.

## Specify by name, never by value

| Bad | Good |
|---|---|
| `#2B7FFF` | `color.action.primary` |
| `16px` | `space.4` |
| `Inter 600 18px` | `type.heading.sm` |
| "a card with a shadow" | `Card` variant `elevated` |

Raw values in a spec become raw values in code, and raw values in code are how a design system dies.

## Justifying a new component

Answer all four, in the spec:

1. What existing component is closest, and precisely why it does not work?
2. Can it be a variant of that component instead of a new one?
3. Where else would this be used? A component with one caller is a feature, not a component.
4. Who owns it after this run?

If the honest answer to (3) is "nowhere else", build it local to the feature and say so explicitly. That is a legitimate choice, but it must be a deliberate one.

## When there is no design system

Say so plainly, then define the minimum viable token set — colour roles, a type scale, a spacing scale — and put it in `design-tokens`. Do not design against ad-hoc values; you would be creating an inconsistency the next feature inherits.

## Handoff to implementation

The implementer needs, per element: the component name, its variant, the tokens applied, and the Figma node id. Anything left implicit gets re-decided in code by someone optimising for a different thing than you were.
