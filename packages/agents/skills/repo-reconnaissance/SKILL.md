---
name: repo-reconnaissance
description: Efficiently deriving a project's real architecture from its source, cheapest signals first.
metadata:
  hermit: true
  title: Repository reconnaissance
---

Map the repository without reading it all. Order matters: each step narrows the next.

## 1. Manifests (highest signal per token)

`package.json`, `pom.xml`, `build.gradle`, `go.mod`, `Cargo.toml`, `requirements.txt`, `*.csproj`, `Gemfile`. Then lockfiles for actual resolved versions, `Dockerfile` and compose files for runtime shape, CI config for how it really builds and tests.

## 2. Structure

Directory tree to two or three levels. Map top-level directories to responsibilities. Read entry points — `main`, `index`, `app`, route registration, DI container setup, migration directories. These reveal architecture faster than any individual module.

## 3. Conventions

Lint and formatter config, `tsconfig`/compiler settings, `.editorconfig`, `CONTRIBUTING.md`, ADR directories, PR templates, `CODEOWNERS`. Then read two or three existing tests: test style is the most reliably imitated convention in any codebase.

## 4. Hotspots

```bash
git log --format=format: --name-only --since=12.months | sort | uniq -c | sort -rg | head -30
```

High-churn files are where the design is unsettled. Wide fan-in files are where changes hurt. Both belong in the codebase map.

## 5. Reconcile

Where docs and code disagree, **the code wins** — and the disagreement is itself a finding worth recording. Stale documentation actively misleads the agents downstream of you.

## Efficiency rules

- Search before reading. Locate by pattern, then read only what matched.
- Read whole files only for entry points and things you will cite.
- Sample generated code and vendored directories; never enumerate them.
- Track what you did *not* look at, and report it as a gap rather than letting silence imply coverage.
