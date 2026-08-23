import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const NM = 'node_modules';

/**
 * Where a server's entry point actually lives, seen from the workspace.
 *
 * The MCP configs name a script for the host to spawn. A path that does not
 * exist is not a soft warning: the host spawns `node`, the process dies before
 * the handshake, and the server never appears at all — so an agent asking for
 * `hermit_status` finds no such tool and the pipeline has no ledger. Resolve
 * the path rather than assuming it.
 *
 *   1. **In the workspace.** `npm i @hermit/cli` brings the servers with it, so
 *      they sit in the workspace's own `node_modules`. Emit the relative path:
 *      it survives the repository being cloned somewhere else, which is the
 *      whole reason not to hardcode an absolute one.
 *
 *   2. **In a linked Hermit checkout.** A contributor who cloned the monorepo
 *      and ran `npm link @hermit/cli` has the servers on disk, but only inside
 *      that checkout — nothing put them in the workspace. Emit the absolute
 *      path. It is machine-specific and cannot be committed usefully, which is
 *      exactly what a linked development install is.
 *
 *   3. **Nowhere.** Emit the conventional relative path anyway, so the file
 *      names what is missing instead of quietly dropping the server, and let
 *      `hermit doctor` report it.
 *
 * @returns {{ script: string, absolute: boolean, found: boolean }}
 */
export function resolveServerEntry(root, def) {
  const rel = `${NM}/${def.package}/src/index.js`;

  if (root && fs.existsSync(path.join(root, NM, def.package, 'src', 'index.js'))) {
    return { script: rel, absolute: false, found: true };
  }

  const linked = resolveFromHermit(def);
  if (linked) return { script: linked, absolute: true, found: true };

  return { script: rel, absolute: false, found: false };
}

/**
 * Resolve through Hermit's own module graph.
 *
 * When the CLI is linked from a checkout this walks up to the monorepo's
 * `node_modules`, where every workspace package is already symlinked. Node
 * resolves a linked package's dependencies from its realpath, which is the same
 * mechanism that lets the linked CLI find `@hermit/core` — so if the CLI runs
 * at all, the servers beside it are reachable.
 */
function resolveFromHermit(def) {
  try {
    return createRequire(import.meta.url).resolve(def.package);
  } catch {
    return null;
  }
}
