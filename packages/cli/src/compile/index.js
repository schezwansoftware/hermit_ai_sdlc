import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DEFAULT_PIPELINE, ensureDir, readJson, writeJson } from '@hermit/core';
import { compileAgentsMd } from './copilot.js';
import { HARNESSES, resolveHarnesses } from './harnesses.js';

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

/**
 * Produce every host-facing file from the canonical definitions.
 * Nothing here reads a previously generated file, so compilation is idempotent.
 *
 * `AGENTS.md` is emitted once regardless of harness: it is the portable
 * baseline that Copilot CLI and Claude Code both read, and duplicating it per
 * harness would mean two writers racing for one path.
 */
export function compileAll({
  registry, config = {}, pipeline = DEFAULT_PIPELINE,
  layoutInfo = { monorepo: false, projects: [] }, harnesses
}) {
  const ids = harnesses ?? resolveHarnesses(config);
  const files = [compileAgentsMd({ registry, pipeline })];
  for (const id of ids) {
    files.push(...HARNESSES[id].files({ registry, config, pipeline, layoutInfo }));
  }
  return files;
}

/**
 * Files a previously-enabled harness wrote that the current selection no longer
 * produces. Returned rather than deleted so the caller can report them: a file
 * Hermit stops owning is not automatically a file the user wants gone.
 */
export function orphanedFiles(manifest, files) {
  const current = new Set(files.map((f) => f.path));
  return Object.keys(manifest?.files ?? {}).filter((p) => !current.has(p));
}

/**
 * Write generated files, never clobbering a human's edits.
 *
 * The manifest records the hash we last wrote. If a file's current hash differs
 * from that, someone changed it by hand: we skip it and report, rather than
 * silently discarding their work. `--force` overrides.
 */
export function writeFiles(root, files, { force = false, manifestFile } = {}) {
  const manifest = readJson(manifestFile, { version: 1, files: {} });
  const result = { written: [], skipped: [], unchanged: [], modified: [] };

  for (const file of files) {
    const abs = path.join(root, file.path);
    const exists = fs.existsSync(abs);
    const current = exists ? fs.readFileSync(abs, 'utf8') : null;
    const previous = manifest.files[file.path];

    let content = file.content;

    // For JSON configs we own one key and leave the rest of the file alone.
    if (exists && file.merge && !force) {
      content = mergeJsonKey(current, file.content, file.merge, file.owns) ?? content;
    }

    if (exists && current === content) {
      result.unchanged.push(file.path);
      manifest.files[file.path] = sha(content);
      continue;
    }

    // A merge file is *expected* to carry other people's entries — that is what
    // merging is for — so a changed hash is not evidence of a conflict there.
    // Hermit rewrites only the entries it owns and leaves the rest as found.
    const editedByHuman = exists && previous && !file.merge && sha(current) !== previous;
    if (editedByHuman && !force) {
      result.skipped.push(file.path);
      result.modified.push(file.path);
      continue;
    }

    ensureDir(path.dirname(abs));
    fs.writeFileSync(abs, content, 'utf8');
    manifest.files[file.path] = sha(content);
    result.written.push(file.path);
  }

  if (manifestFile) {
    manifest.generatedAt = new Date().toISOString();
    writeJson(manifestFile, manifest);
  }
  return result;
}

/**
 * Replace one top-level key in an existing JSON file, preserving everything else.
 *
 * `owns` names the entries inside that key which belong to Hermit. Anything else
 * under it — a server the user configured themselves — survives untouched, while
 * one of Hermit's own that is no longer enabled is dropped. Without that second
 * half, disabling a server in config would leave it in the generated file
 * forever, because a plain merge only ever adds.
 */
function mergeJsonKey(currentText, nextText, key, owns = null) {
  try {
    const current = JSON.parse(currentText);
    const next = JSON.parse(nextText);
    const kept = { ...(current[key] ?? {}) };
    if (Array.isArray(owns)) {
      for (const id of owns) if (!(id in (next[key] ?? {}))) delete kept[id];
    }
    const merged = { ...current, [key]: { ...kept, ...next[key] } };
    return JSON.stringify(merged, null, 2) + '\n';
  } catch {
    return null; // not valid JSON — fall back to overwrite rules
  }
}

/** Copy the canonical agent/skill/knowledge packs into the workspace. */
export function installPacks(packRoot, hermitDir, { force = false } = {}) {
  const result = { copied: [], preserved: [] };
  for (const dir of ['agents', 'skills', 'knowledge']) {
    const from = path.join(packRoot, dir);
    const to = path.join(hermitDir, dir);
    if (!fs.existsSync(from)) continue;

    if (fs.existsSync(to) && !force) {
      // Only add packs the workspace does not already have; never overwrite a
      // team's customised agent.
      for (const entry of fs.readdirSync(from)) {
        const dest = path.join(to, entry);
        if (fs.existsSync(dest)) { result.preserved.push(`${dir}/${entry}`); continue; }
        fs.cpSync(path.join(from, entry), dest, { recursive: true });
        result.copied.push(`${dir}/${entry}`);
      }
    } else {
      ensureDir(to);
      fs.cpSync(from, to, { recursive: true });
      for (const entry of fs.readdirSync(from)) result.copied.push(`${dir}/${entry}`);
    }
  }
  return result;
}
