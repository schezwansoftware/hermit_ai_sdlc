/**
 * The single source of truth for the Hermit release version.
 *
 * `hermit doctor` and `hermit --version` read this. Bump it in the same change
 * that ships the work, following semver:
 *
 *   - patch (1.0.0 → 1.0.1): bug fixes, docs, maintenance — no new capability
 *   - minor (1.0.x → 1.1.0): a new feature or a behaviour change that is
 *     backward compatible
 *   - major (1.x.y → 2.0.0): a breaking change to the CLI, the MCP tools, the
 *     artifact/gate contracts, or the pipeline shape
 *
 * This is the version the product reports. The individual workspace
 * `package.json` files are internal and not kept in lockstep — update
 * `CHANGELOG.md` alongside this constant instead.
 */
export const HERMIT_VERSION = '1.2.0';
