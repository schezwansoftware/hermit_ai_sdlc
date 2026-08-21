import { readArtifact } from './artifacts.js';

/**
 * Evaluate one exit criterion against the run's artifacts.
 * Criteria are intentionally mechanical: they check that the agent actually
 * produced structured output, not that the output is "good". Judgement lives at
 * the HITL gate; this layer only stops obviously-incomplete handoffs.
 *
 * @returns {{ id:string, ok:boolean, detail:string }}
 */
export function evaluateCriterion(paths, runId, criterion) {
  const { id, type } = criterion;
  const fail = (detail) => ({ id, ok: false, detail, type });
  const pass = (detail = 'ok') => ({ id, ok: true, detail, type });

  const content = criterion.artifact ? readArtifact(paths, runId, criterion.artifact) : null;

  switch (type) {
    case 'artifact_exists':
      return content === null ? fail(`artifact "${criterion.artifact}" has not been submitted`) : pass();

    case 'contains':
      if (content === null) return fail(`artifact "${criterion.artifact}" missing`);
      return content.includes(criterion.value)
        ? pass()
        : fail(`artifact "${criterion.artifact}" must contain ${JSON.stringify(criterion.value)}`);

    case 'not_contains':
      if (content === null) return fail(`artifact "${criterion.artifact}" missing`);
      return content.includes(criterion.value)
        ? fail(`artifact "${criterion.artifact}" still contains placeholder ${JSON.stringify(criterion.value)}`)
        : pass();

    case 'matches': {
      if (content === null) return fail(`artifact "${criterion.artifact}" missing`);
      const re = new RegExp(criterion.pattern, criterion.flags ?? '');
      return re.test(content) ? pass() : fail(`artifact "${criterion.artifact}" must match /${criterion.pattern}/${criterion.flags ?? ''}`);
    }

    case 'min_list_items': {
      if (content === null) return fail(`artifact "${criterion.artifact}" missing`);
      const section = extractSection(content, criterion.section);
      if (section === null) return fail(`artifact "${criterion.artifact}" has no section "${criterion.section}"`);
      const items = section.split('\n').filter((l) => /^\s*([-*+]|\d+\.)\s+\S/.test(l)).length;
      return items >= criterion.min
        ? pass(`${items} item(s)`)
        : fail(`section "${criterion.section}" needs >= ${criterion.min} list items, found ${items}`);
    }

    default:
      return fail(`unknown criterion type "${type}"`);
  }
}

/** Extract the body of a markdown heading section, up to the next heading of the same or higher level. */
export function extractSection(markdown, heading) {
  const level = (heading.match(/^#+/) ?? ['#'])[0].length;
  const lines = markdown.split('\n');
  const start = lines.findIndex((l) => l.trim() === heading.trim());
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => {
    const m = l.match(/^(#+)\s/);
    return m && m[1].length <= level;
  });
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

/**
 * @returns {{ ok:boolean, results:Array<{id:string,ok:boolean,detail:string}>, failed:string[] }}
 */
export function evaluateAll(paths, runId, criteria = []) {
  const results = criteria.map((c) => evaluateCriterion(paths, runId, c));
  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results, failed: failed.map((f) => f.id) };
}
