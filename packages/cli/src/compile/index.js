import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DEFAULT_PIPELINE, ensureDir, readJson, writeJson } from '@hermit/core';
import { HARNESSES, resolveHarnesses } from './harnesses.js';

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

/**
 * Produce every host-facing file from the canonical definitions.
 * Nothing here reads a previously generated file, so compilation is idempotent.
 *
 * Every file comes from a harness. Nothing is shared, so a workspace only ever
 * holds configuration for the hosts it actually enabled.
 */
export function compileAll({
  registry, config = {}, pipeline = DEFAULT_PIPELINE,
  layoutInfo = { monorepo: false, projects: [] }, harnesses
}) {
  const ids = harnesses ?? resolveHarnesses(config);
  const files = [];
  for (const id of ids) {
    files.push(...HARNESSES[id].files({ registry, config, pipeline, layoutInfo }));
  }
  return files;
}

/**
 * Files a previously-enabled harness wrote that the current selection no longer
 * produces.
 */
export function orphanedFiles(manifest, files) {
  const current = new Set(files.map((f) => f.path));
  return Object.keys(manifest?.files ?? {}).filter((p) => !current.has(p));
}

/**
 * Remove files a disabled harness left behind.
 *
 * Only files whose contents still match what Hermit last wrote are deleted —
 * the manifest hash proves they are ours and unmodified. Anything a person
 * touched is kept and reported instead, because switching harness is not
 * consent to discard someone's edits.
 */
export function pruneOrphans(root, orphans, { manifestFile } = {}) {
  const manifest = readJson(manifestFile, { version: 1, files: {} });
  const result = { removed: [], kept: [] };

  for (const rel of orphans) {
    const abs = path.join(root, rel);
    const recorded = manifest.files[rel];
    if (!fs.existsSync(abs)) { delete manifest.files[rel]; result.removed.push(rel); continue; }

    const current = fs.readFileSync(abs, 'utf8');
    if (recorded && sha(current) === recorded) {
      fs.rmSync(abs);
      delete manifest.files[rel];
      result.removed.push(rel);
      pruneEmptyDirs(root, path.dirname(abs));
    } else {
      result.kept.push(rel);
    }
  }

  if (manifestFile) writeJson(manifestFile, manifest);
  return result;
}

/** Walk up removing directories emptied by the prune, stopping at the root. */
function pruneEmptyDirs(root, dir) {
  let cur = path.resolve(dir);
  const stop = path.resolve(root);
  while (cur.startsWith(stop) && cur !== stop) {
    if (!fs.existsSync(cur) || fs.readdirSync(cur).length) return;
    fs.rmdirSync(cur);
    cur = path.dirname(cur);
  }
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
