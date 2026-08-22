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
      content = mergeJsonKey(current, file.content, file.merge) ?? content;
    }

    if (exists && current === content) {
      result.unchanged.push(file.path);
      manifest.files[file.path] = sha(content);
      continue;
    }

    const editedByHuman = exists && previous && sha(current) !== previous;
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

/** Replace one top-level key in an existing JSON file, preserving everything else. */
function mergeJsonKey(currentText, nextText, key) {
  try {
    const current = JSON.parse(currentText);
    const next = JSON.parse(nextText);
    const merged = { ...current, [key]: { ...(current[key] ?? {}), ...next[key] } };
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
