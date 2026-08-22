import fs from 'node:fs';
import path from 'node:path';

/**
 * Monorepo awareness.
 *
 * A single-project repo is just a monorepo with one project, so everything
 * downstream works the same way — the difference is only how much gets scoped
 * away. Projects narrow three things: which paths an agent may read and write,
 * which stages run (no UI project in scope means no UX stages), and how the
 * onboarding agent structures its map.
 */

export const PROJECT_KINDS = /** @type {const} */ ([
  'frontend', 'backend', 'batch', 'infra', 'mobile', 'lib', 'docs', 'unknown'
]);

/** Kinds that justify running the three UX stages. */
export const UI_KINDS = new Set(['frontend', 'mobile']);

/** Kinds whose work is server-side whatever the stack detector found. */
export const BACKEND_KINDS = new Set(['backend', 'batch']);

/** Kinds that are never server-side, whatever the stack detector found. */
const NON_BACKEND_KINDS = new Set(['frontend', 'mobile', 'docs', 'infra']);

/** Stacks that only appear on the server side of a system. */
const SERVER_STACKS = new Set(['python', 'go', 'jvm', 'dotnet', 'ruby', 'rust']);

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'target', 'vendor',
  '.next', '.nuxt', '.venv', 'venv', '__pycache__', 'coverage', '.turbo', '.gradle'
]);

const readJsonSafe = (file) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
};
const exists = (...p) => fs.existsSync(path.join(...p));

/**
 * Identify the workspace-manager markers at the repo root, if any.
 * @returns {{ tool: string|null, globs: string[] }}
 */
export function detectWorkspaceGlobs(root) {
  const pkg = readJsonSafe(path.join(root, 'package.json'));
  const ws = pkg?.workspaces;
  if (ws) {
    const globs = Array.isArray(ws) ? ws : (ws.packages ?? []);
    if (globs.length) return { tool: pkg.pnpm ? 'pnpm' : 'npm-workspaces', globs };
  }

  if (exists(root, 'pnpm-workspace.yaml')) {
    const text = fs.readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8');
    const globs = [...text.matchAll(/^\s*-\s*['"]?([^'"\n]+)['"]?\s*$/gm)].map((m) => m[1].trim());
    if (globs.length) return { tool: 'pnpm', globs };
  }

  const lerna = readJsonSafe(path.join(root, 'lerna.json'));
  if (lerna?.packages?.length) return { tool: 'lerna', globs: lerna.packages };

  if (exists(root, 'go.work')) {
    const text = fs.readFileSync(path.join(root, 'go.work'), 'utf8');
    const globs = [...text.matchAll(/^\s*\.?\/?([\w./-]+)\s*$/gm)].map((m) => m[1]).filter((g) => g !== 'go');
    if (globs.length) return { tool: 'go-work', globs };
  }

  const cargo = exists(root, 'Cargo.toml') ? fs.readFileSync(path.join(root, 'Cargo.toml'), 'utf8') : '';
  if (/^\s*\[workspace\]/m.test(cargo)) {
    const block = /members\s*=\s*\[([\s\S]*?)\]/.exec(cargo);
    const globs = block ? [...block[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]) : [];
    if (globs.length) return { tool: 'cargo', globs };
  }

  for (const f of ['settings.gradle', 'settings.gradle.kts']) {
    if (!exists(root, f)) continue;
    const text = fs.readFileSync(path.join(root, f), 'utf8');
    const globs = [...text.matchAll(/include\s*\(?\s*["']:?([\w:.-]+)["']/g)].map((m) => m[1].replace(/:/g, '/'));
    if (globs.length) return { tool: 'gradle', globs };
  }

  if (exists(root, 'pom.xml')) {
    const text = fs.readFileSync(path.join(root, 'pom.xml'), 'utf8');
    const globs = [...text.matchAll(/<module>([^<]+)<\/module>/g)].map((m) => m[1].trim());
    if (globs.length) return { tool: 'maven', globs };
  }

  if (exists(root, 'nx.json') || exists(root, 'turbo.json')) {
    return { tool: exists(root, 'nx.json') ? 'nx' : 'turbo', globs: ['apps/*', 'packages/*', 'libs/*', 'services/*'] };
  }
  return { tool: null, globs: [] };
}

/** Expand a workspace glob like `apps/*` into concrete directories. */
function expandGlob(root, glob) {
  const clean = glob.replace(/\/\*\*$/, '/*').replace(/\/$/, '');
  if (!clean.includes('*')) return exists(root, clean) ? [clean] : [];
  const [prefix] = clean.split('*');
  const base = path.join(root, prefix);
  if (!fs.existsSync(base)) return [];
  return fs
    .readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !IGNORE_DIRS.has(d.name) && !d.name.startsWith('.'))
    .map((d) => path.posix.join(prefix.replace(/\/$/, ''), d.name));
}

/** Directory-name conventions, used when no workspace manager declares the layout. */
const CONVENTIONAL_PARENTS = ['apps', 'packages', 'services', 'libs', 'modules', 'projects'];
const CONVENTIONAL_LEAVES = [
  'frontend', 'web', 'client', 'ui', 'admin', 'mobile',
  'backend', 'api', 'server', 'gateway', 'service',
  'batch', 'worker', 'jobs', 'scheduler', 'etl',
  'infra', 'infrastructure', 'deploy', 'terraform', 'k8s', 'charts',
  'docs', 'documentation', 'website',
  'db', 'database', 'migrations', 'e2e'
];

/**
 * A manifest, a build file or a deployment descriptor — something that says
 * "a thing is built here".
 *
 * Required of conventionally-named directories, because the name alone is not
 * evidence: Hermit writes `docs/hermit-intellij-setup.md` into the workspace
 * itself, and without this a repository would come back reporting Hermit's own
 * output as its only project.
 */
const PROJECT_EVIDENCE = [
  /^package\.json$/, /^go\.mod$/, /^pom\.xml$/, /^build\.gradle(\.kts)?$/,
  /^Cargo\.toml$/, /^(requirements\.txt|pyproject\.toml|setup\.py)$/, /^Gemfile$/,
  /\.csproj$/, /^Dockerfile$/, /\.tf$/, /^(Chart\.yaml|Pulumi\.yaml|cdk\.json|skaffold\.yaml)$/,
  /^index\.html$/, /^pubspec\.yaml$/
];

function hasProjectEvidence(root, rel) {
  const dir = path.join(root, rel);
  if (!fs.existsSync(dir)) return false;
  return fs.readdirSync(dir).some((f) => PROJECT_EVIDENCE.some((re) => re.test(f)));
}

function conventionalDirs(root) {
  const found = [];
  for (const parent of CONVENTIONAL_PARENTS) {
    if (!exists(root, parent)) continue;
    for (const d of fs.readdirSync(path.join(root, parent), { withFileTypes: true })) {
      if (d.isDirectory() && !IGNORE_DIRS.has(d.name) && !d.name.startsWith('.')) {
        found.push(path.posix.join(parent, d.name));
      }
    }
  }
  for (const leaf of CONVENTIONAL_LEAVES) {
    if (exists(root, leaf) && fs.statSync(path.join(root, leaf)).isDirectory()) found.push(leaf);
  }
  return [...new Set(found)].filter((d) => hasProjectEvidence(root, d));
}

/** Infer what a project *is* from what is inside it. Evidence, not the folder name alone. */
export function classifyProject(root, rel) {
  const dir = path.join(root, rel);
  const pkg = readJsonSafe(path.join(dir, 'package.json'));
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  const has = (...names) => names.some((n) => n in deps);
  const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  const hasFile = (re) => files.some((f) => re.test(f));
  const name = path.basename(rel).toLowerCase();

  const stack = [];
  if (pkg) stack.push('node');
  if (hasFile(/^(pom\.xml|build\.gradle(\.kts)?)$/)) stack.push('jvm');
  if (hasFile(/^(go\.mod)$/)) stack.push('go');
  if (hasFile(/^(Cargo\.toml)$/)) stack.push('rust');
  if (hasFile(/^(requirements\.txt|pyproject\.toml|setup\.py)$/)) stack.push('python');
  if (hasFile(/^(Gemfile)$/)) stack.push('ruby');
  if (hasFile(/\.csproj$/)) stack.push('dotnet');

  let kind = 'unknown';
  if (hasFile(/\.tf$/) || hasFile(/^(main\.tf|Chart\.yaml|Pulumi\.yaml|cdk\.json|skaffold\.yaml)$/) || /^(infra|infrastructure|deploy|terraform|k8s)$/.test(name)) {
    kind = 'infra';
  } else if (has('react-native', 'expo', '@ionic/core') || exists(dir, 'pubspec.yaml') || (exists(dir, 'ios') && exists(dir, 'android'))) {
    kind = 'mobile';
  } else if (has('react', 'vue', 'svelte', '@angular/core', 'next', 'nuxt', 'vite', 'astro', 'solid-js') || hasFile(/^index\.html$/)) {
    kind = 'frontend';
  } else if (/(batch|worker|job|jobs|cron|scheduler|etl|consumer)/.test(name) || has('bullmq', 'agenda', 'node-cron', 'celery')) {
    kind = 'batch';
  } else if (has('express', 'fastify', '@nestjs/core', 'koa', 'hapi', 'apollo-server') || hasFile(/^(Dockerfile)$/) || stack.includes('go') || stack.includes('jvm') || /(api|server|backend|service|gateway)/.test(name)) {
    kind = 'backend';
  } else if (/^(docs?|documentation|website)$/.test(name)) {
    kind = 'docs';
  } else if (/^(packages|libs)\//.test(rel)) {
    kind = 'lib';
  }

  return {
    id: rel.replace(/[/\\]/g, '-'),
    name: pkg?.name ?? path.basename(rel),
    path: rel.split(path.sep).join('/'),
    kind,
    stack: stack.length ? stack : ['unknown'],
    ui: UI_KINDS.has(kind)
  };
}

/**
 * Discover the projects in a workspace.
 * @returns {{ monorepo:boolean, tool:string|null, projects:Array<object> }}
 */
export function detectProjects(root) {
  const { tool, globs } = detectWorkspaceGlobs(root);

  // Union, not fallback. A JS workspace declares apps/* and packages/*, but
  // infra/ and docs/ are real projects that sit outside those globs — and they
  // are exactly the ones a change can break without anyone noticing.
  const declared = globs.flatMap((g) => expandGlob(root, g));
  const conventional = conventionalDirs(root).filter(
    (d) => !declared.some((w) => d === w || d.startsWith(`${w}/`) || w.startsWith(`${d}/`))
  );
  const dirs = [...declared, ...conventional];

  const projects = [...new Set(dirs)]
    .filter((d) => fs.existsSync(path.join(root, d)) && fs.statSync(path.join(root, d)).isDirectory())
    .map((d) => classifyProject(root, d))
    .sort((a, b) => a.path.localeCompare(b.path));

  return { monorepo: projects.length > 1, tool, projects };
}

/** Config-declared projects win over detection; detection fills the gap. */
export function resolveProjects(root, config = {}) {
  const declared = config.projects;
  if (Array.isArray(declared) && declared.length) {
    return {
      monorepo: declared.length > 1,
      tool: config.monorepoTool ?? null,
      source: 'config',
      projects: declared.map((p) => ({
        id: p.id ?? p.path.replace(/[/\\]/g, '-'),
        name: p.name ?? p.id ?? p.path,
        path: p.path,
        kind: p.kind ?? 'unknown',
        stack: p.stack ?? ['unknown'],
        ui: p.ui ?? UI_KINDS.has(p.kind ?? '')
      }))
    };
  }
  return { ...detectProjects(root), source: 'detected' };
}

/**
 * Path globs for a set of projects. Used to narrow an agent's read/write scope
 * so an implementer working in `backend` is not handed the frontend tree.
 */
export function projectPathScope(projects, selectedIds = []) {
  const selected = selectedIds.length ? projects.filter((p) => selectedIds.includes(p.id)) : projects;
  return selected.map((p) => `${p.path}/**`);
}

/** Narrow a declared glob list to the selected projects, keeping root-level globs intact. */
export function scopePathsToProjects(paths = [], projects = [], selectedIds = []) {
  if (!projects.length || !selectedIds.length) return paths;
  const selected = projects.filter((p) => selectedIds.includes(p.id));
  if (!selected.length) return paths;

  const out = [];
  for (const glob of paths) {
    if (glob === '**' || glob === '**/*') {
      out.push(...selected.map((p) => `${p.path}/**`));
      continue;
    }
    // A glob already inside a selected project stays; one inside a different
    // project is dropped; anything root-relative gets re-anchored per project.
    const owner = projects.find((p) => glob.startsWith(`${p.path}/`));
    if (owner) {
      if (selectedIds.includes(owner.id)) out.push(glob);
      continue;
    }
    out.push(...selected.map((p) => `${p.path}/${glob.replace(/^\.\//, '')}`));
  }
  return [...new Set(out)];
}

/** Do any selected projects have a user interface? Drives UX stage skipping. */
export function hasUiProject(projects, selectedIds = []) {
  const selected = selectedIds.length ? projects.filter((p) => selectedIds.includes(p.id)) : projects;
  return selected.some((p) => p.ui);
}

/**
 * Is this project's implementation work server-side?
 *
 * `node` is not a server stack on its own — the same runtime builds both sides —
 * so a Node project qualifies on its kind, while a Python or Go one qualifies on
 * its stack even when the directory name told the classifier nothing.
 */
export function isBackendProject(project) {
  if (!project) return false;
  if (NON_BACKEND_KINDS.has(project.kind)) return false;
  if (BACKEND_KINDS.has(project.kind)) return true;
  return (project.stack ?? []).some((s) => SERVER_STACKS.has(s));
}

/**
 * What a run actually touches, reduced to the two facts that route work:
 * the stack and the kind of each unit in scope.
 *
 * A flat single-service repository declares no sub-projects, so scoping it from
 * `projects` alone would report an empty scope and every specialist would decline.
 * Classifying the repository root covers that case — it is the same evidence
 * `classifyProject` reads, applied one level up.
 */
export function techScope(root, projects = [], selectedIds = []) {
  const selected = selectedIds.length ? projects.filter((p) => selectedIds.includes(p.id)) : projects;
  const units = selected.length ? selected : [classifyProject(root, '.')];
  return {
    units: units.map((p) => ({ kind: p.kind, stack: p.stack ?? ['unknown'] })),
    stacks: [...new Set(units.flatMap((p) => p.stack ?? []))].sort(),
    backend: units.some(isBackendProject)
  };
}
