import fs from 'node:fs';
import path from 'node:path';

/**
 * Locate the consuming workspace. Hosts launch MCP servers with an unpredictable
 * cwd, so honour HERMIT_WORKSPACE first and only then walk upward.
 */
export function workspaceRoot() {
  if (process.env.HERMIT_WORKSPACE) return path.resolve(process.env.HERMIT_WORKSPACE);
  let dir = process.cwd();
  while (true) {
    if (fs.existsSync(path.join(dir, '.hermit'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
}

export function loadConfig() {
  const root = workspaceRoot();
  const file = path.join(root, '.hermit', 'config.json');
  let config = {};
  try {
    config = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    /* absent config is fine; env vars can carry everything */
  }
  return { root, file, ...config };
}

/**
 * Resolve a setting from env first, then config, then default.
 * Env wins so CI can override a checked-in config without editing files.
 */
export function setting(config, envName, configPath, fallback = undefined) {
  if (process.env[envName]) return process.env[envName];
  const value = configPath.split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), config);
  return value ?? fallback;
}

/** Throw a message that tells the user exactly how to fix a missing credential. */
export function requireEnv(name, hint) {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}.` +
        (hint ? ` (${hint})` : '') +
        `\nSet it in your shell, your .env file, or the MCP server config, then restart the MCP server.`
    );
  }
  return value;
}
