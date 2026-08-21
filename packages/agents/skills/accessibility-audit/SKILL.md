---
name: accessibility-audit
description: Specifying and checking WCAG 2.2 AA conformance as part of design, not as a retrofit.
metadata:
  hermit: true
  title: Accessibility audit
---

Accessibility specified at design costs nothing. Discovered at code review it costs a rebuild, because it is usually structural.

## Specify at high fidelity

**Contrast** — compute the ratio for every text/background and UI/background pair. Text needs 4.5:1, large text (18.66px+ or 14px bold) 3:1, UI components and focus indicators 3:1. State the computed number; "should be fine" is not a specification.

**Keyboard** — the complete path: tab order, what receives focus, how the focus indicator looks (3:1 against both adjacent colours), how to escape every trap, and every shortcut. Any mouse-only interaction is a defect at design time.

**Semantics** — the element for each region: real headings in order without skips, `button` for actions and `a` for navigation, `label` bound to every input, `fieldset`/`legend` for groups. ARIA only where HTML cannot express it — a wrong role is worse than none.

**Announcements** — what a screen reader says on: load, validation error, async completion, and content change. Name the live region and its politeness.

**Targets** — 24×24 CSS px minimum for pointer targets, or adequate spacing. Applies to icon buttons, which is where it is usually missed.

**Motion** — behaviour under `prefers-reduced-motion`. Nothing may flash more than three times per second.

**Forced colours** — what survives Windows High Contrast. Anything conveyed by background colour alone will not.

## Checks that catch the most

1. Turn off the stylesheet mentally — is the content order still logical?
2. Convey nothing by colour alone: errors need an icon or text, chart series need labels or patterns.
3. Every image: is it informative (needs alt) or decorative (needs empty alt)? Decide per image.
4. Every form error: is it programmatically tied to its field, not just visually near it?
5. Zoom to 200% — does anything become unreachable?

## In the spec

`## Accessibility` is checked by the pipeline and must cover contrast, keyboard, semantics, targets, and motion. Where a requirement conflicts with accessibility, raise it at the gate rather than silently choosing — that trade is a human's to make, and it is usually a false trade.
