/**
 * What Hermit may create in Jira, and how an issue's fields are built.
 *
 * Kept free of network and config access so the rules can be tested without a
 * Jira site. The server calls `assertCreatable` before it touches credentials,
 * so a forbidden request fails the same way whether or not Jira is reachable.
 */

/** The only issue types Hermit agents may create. Stories, Bugs and Epics are made by people. */
export const CREATABLE_TYPES = ['Task', 'Subtask'];

const squash = (s) => String(s).trim().toLowerCase().replace(/[\s_-]+/g, '');

/**
 * Validate a create request and return the canonical issue type name.
 * Throws a message an agent can act on.
 */
export function assertCreatable({ issueType = 'Task', parent } = {}) {
  const type = CREATABLE_TYPES.find((t) => squash(t) === squash(issueType));
  if (!type) {
    throw new Error(
      `Issue type "${issueType}" is not allowed. Hermit may only create ${CREATABLE_TYPES.join(' or ')} issues; ` +
        'Stories, Bugs and Epics are created by people. If the work needs one, record it under Gaps and leave it out of Jira.'
    );
  }
  if (type === 'Subtask' && !parent) {
    throw new Error('A Subtask needs a parent issue: pass `parent` with the key of the Task it belongs to.');
  }
  if (type === 'Task' && parent) {
    throw new Error(
      'A Task cannot be created under a parent here. Create it without `parent` and attach it to its source ' +
        'with jira_link_issues. Only Subtasks use `parent`.'
    );
  }
  return type;
}

/**
 * Minimal Markdown to Atlassian Document Format: `#`-headings, `-` bullet lists
 * and paragraphs. Enough to carry a description with named sections; anything
 * richer is out of scope on purpose.
 */
export function adf(text) {
  const text1 = (s) => ({ type: 'text', text: s });
  const inline = (lines) =>
    lines.flatMap((l, i) => (i ? [{ type: 'hardBreak' }, text1(l)] : [text1(l)])).filter((n) => n.type !== 'text' || n.text);
  const content = [];

  for (const block of String(text).split(/\n{2,}/)) {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    if (!lines.length) continue;

    const heading = /^(#{1,3})\s+(.+)$/.exec(lines[0]);
    if (heading) {
      content.push({ type: 'heading', attrs: { level: heading[1].length }, content: [text1(heading[2].trim())] });
      lines.shift();
      if (!lines.length) continue;
    }

    if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
      content.push({
        type: 'bulletList',
        content: lines.map((l) => ({
          type: 'listItem',
          content: [{ type: 'paragraph', content: [text1(l.replace(/^\s*[-*]\s+/, ''))] }]
        }))
      });
    } else {
      content.push({ type: 'paragraph', content: inline(lines) });
    }
  }
  return { type: 'doc', version: 1, content };
}

/**
 * Build the `fields` object for a create call.
 *
 * Acceptance Criteria and Definition of Done go into their own custom fields
 * when the project has them (`fieldIds`), and into named sections of the
 * description when it does not.
 */
export function buildIssueFields(
  { project, summary, issueType, parent, labels, description, acceptanceCriteria, definitionOfDone },
  fieldIds = {}
) {
  const fields = { project: { key: project }, summary, issuetype: { name: issueType } };
  if (parent) fields.parent = { key: parent };
  if (labels?.length) fields.labels = labels;

  const sections = [];
  const place = (value, id, heading) => {
    if (!value) return;
    if (id) fields[id] = adf(value);
    else sections.push(`## ${heading}\n\n${value}`);
  };
  place(acceptanceCriteria, fieldIds.acceptanceCriteria, 'Acceptance Criteria');
  place(definitionOfDone, fieldIds.definitionOfDone, 'Definition of Done');

  const body = [description, ...sections].filter(Boolean).join('\n\n');
  if (body) fields.description = adf(body);
  return fields;
}
