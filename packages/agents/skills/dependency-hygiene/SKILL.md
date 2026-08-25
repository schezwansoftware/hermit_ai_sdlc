---
name: dependency-hygiene
description: Reading a dependency tree accurately, and knowing which upgrades are safe to take without asking.
metadata:
  hermit: true
  title: Dependency hygiene
---

## The manifest is a request; the lockfile is the truth

`package.json` says `^4.17.0`. The lockfile says `4.17.20`. The advisory is against `4.17.20`. Scan the lockfile, report the installed version, and fix by changing whichever file the ecosystem actually resolves from.

A repository with no lockfile cannot be scanned reliably — two installs a week apart produce different trees. Say so explicitly rather than reporting a clean scan of a tree that will not reproduce.

| Ecosystem | Manifest | Lockfile | Audit |
|---|---|---|---|
| npm / pnpm / yarn | `package.json` | `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock` | `npm audit --json` |
| Python | `requirements.txt`, `pyproject.toml` | `poetry.lock`, `Pipfile.lock` | `pip-audit` |
| Go | `go.mod` | `go.sum` | `govulncheck ./...` |
| JVM | `pom.xml`, `build.gradle` | `gradle.lockfile` | OWASP dependency-check |
| Ruby | `Gemfile` | `Gemfile.lock` | `bundle audit` |
| Rust | `Cargo.toml` | `Cargo.lock` | `cargo audit` |
| PHP | `composer.json` | `composer.lock` | `composer audit` |

## Direct and transitive are different problems

A vulnerable **direct** dependency you upgrade directly. A vulnerable **transitive** one you usually cannot: it arrives through a parent that pins it. Three routes, in order of preference:

1. **Upgrade the parent** to a release that depends on the fixed version. Clean, and it survives the next install.
2. **Override or resolve** the transitive version (`overrides`, `resolutions`, `constraints`). Effective and fragile — it silently stops applying when the parent restructures, so it needs a comment saying why it exists.
3. **Neither is possible.** Say so. This belongs in the report, not in a workaround nobody understands in six months.

Never report a transitive fix as applied without checking that the resolved tree actually changed. Editing a manifest is not the same as changing what gets installed.

## Runtime and dev are different risks

A prototype-pollution advisory in a test runner is not a production incident. Treating it as one trains readers to skim the report, which is how the real finding gets missed. Separate the two everywhere, and let severity mean severity.

## What makes an upgrade safe to take unattended

All three, not two:

- **In range.** Patch or minor under the ecosystem's own rules — and check what those rules are. Go modules treat major differently from npm; a Python project pinned with `==` has no range at all; a `0.x` package's minor bump is a breaking change by convention.
- **No breaking change in the notes.** Read the changelog for the span you are crossing, not just the target release.
- **Green afterwards.** Install step and test suite both. An upgrade that breaks the build is not a fix, and reporting it as one is worse than leaving the advisory open.

If any of the three fails, revert your change and move it to the approval list with the reason. A reverted upgrade with an honest explanation is a good outcome; a red suite handed downstream hides every other finding in the report.

## Upgrade one at a time

Batching four upgrades and running the suite once tells you something broke. It does not tell you which one. When the suite is slow, batch by risk — all the patch bumps together, each minor on its own — but never batch across a boundary you would have to un-pick by hand.
