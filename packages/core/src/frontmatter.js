import YAML from 'yaml';

const FM = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * Split a markdown document into YAML frontmatter and body.
 * @param {string} source
 * @returns {{ data: Record<string, any>, body: string }}
 */
export function parseFrontmatter(source) {
  const match = FM.exec(source);
  if (!match) return { data: {}, body: source };
  let data = {};
  try {
    data = YAML.parse(match[1]) ?? {};
  } catch (err) {
    throw new Error(`Invalid YAML frontmatter: ${err.message}`);
  }
  return { data, body: source.slice(match[0].length) };
}

/**
 * Re-serialise frontmatter + body back to a markdown document.
 * @param {Record<string, any>} data
 * @param {string} body
 */
export function stringifyFrontmatter(data, body) {
  const yaml = YAML.stringify(data, { lineWidth: 0 }).trimEnd();
  return `---\n${yaml}\n---\n\n${body.replace(/^\n+/, '')}`;
}
