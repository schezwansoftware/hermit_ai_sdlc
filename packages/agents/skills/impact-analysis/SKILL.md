---
name: impact-analysis
description: Mapping the blast radius of a change before it is built, including how it fails and how it is undone.
metadata:
  hermit: true
  title: Impact analysis
---

The purpose is to make the cost of being wrong visible while it is still cheap to choose differently.

## Blast radius

Work outward from every component the design touches:

1. **Direct callers** — use the fan-in data from the codebase map, not intuition.
2. **Transitive consumers** — other services, scheduled jobs, ETL, reporting, mobile clients on old versions.
3. **Data consumers** — anything reading tables you change, including analytics that nobody remembers owning.
4. **Operational surface** — dashboards, alerts, runbooks that reference what you are renaming.
5. **Teams** — who needs to know, who needs to approve, who gets paged when it misbehaves.

The consumers nobody remembers are the ones that break. Grep for table names and endpoint paths across the whole organisation's code, not just this repository.

## Breaking changes

For each: what breaks, who it breaks for, and the migration path. Categories that are routinely missed:

- **Semantic breaks** — same signature, different behaviour. The most dangerous kind, because nothing fails to compile.
- **Nullability and enum widening** — adding an enum value breaks exhaustive consumers.
- **Ordering and timing** — a call that becomes async, or a response that stops being ordered.
- **Error contract** — a new status code or error shape that clients do not handle.

## Risk register

Each risk gets likelihood, severity, and a mitigation. Prioritise by product, not by likelihood alone.

Always consider the failure modes that are quiet:

- Failing **silently** — writing wrong data that nobody notices for weeks.
- Failing **partially** — half the batch succeeded, and there is no record of which half.
- Failing **later** — a migration that works today and breaks the next deploy.
- Failing **under load only** — fine in staging, and fine in production until Monday.

## Rollback

State the concrete steps to undo this. Then answer the question that matters:

> After this ships and runs for a day, can we still get back?

If a destructive migration, an external side effect, or a published event makes rollback impossible, **say so in bold**. That single sentence is often the most consequential thing in the artifact, and the human gate exists partly to catch it.

## Effort signal

Relative sizing per component, and — more useful — where the *uncertainty* concentrates. "Three medium components and one where we genuinely don't know" is far better planning input than a total.
