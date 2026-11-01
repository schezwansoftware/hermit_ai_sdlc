/**
 * Jira create rules: what Hermit may create, and where Acceptance Criteria and
 * Definition of Done end up. No Jira site needed; the rules are pure.
 */
import assert from 'node:assert/strict';
import { assertCreatable, buildIssueFields, adf, CREATABLE_TYPES } from '../packages/mcp-jira/src/issue-rules.js';

assert.deepEqual(CREATABLE_TYPES, ['Task', 'Subtask']);

// Types: only Task and Subtask, in any reasonable spelling.
for (const bad of ['Story', 'Bug', 'Epic', 'Feature', 'story', 'EPIC', '']) {
  assert.throws(() => assertCreatable({ issueType: bad, parent: 'P-1' }), /not allowed/, `"${bad}" must be rejected`);
}
assert.equal(assertCreatable({}), 'Task', 'Task is the default');
assert.equal(assertCreatable({ issueType: 'task' }), 'Task');
for (const spelling of ['Subtask', 'sub-task', 'Sub task', 'SUBTASK']) {
  assert.equal(assertCreatable({ issueType: spelling, parent: 'P-1' }), 'Subtask');
}
console.log('  ✓ only Task and Subtask can be created');

// Parent rules.
assert.throws(() => assertCreatable({ issueType: 'Subtask' }), /needs a parent/);
assert.throws(() => assertCreatable({ issueType: 'Task', parent: 'P-1' }), /jira_link_issues/);
console.log('  ✓ a Subtask needs a parent and a Task must not have one');

// Fields: no custom field ids configured, so the criteria become description sections.
const inline = buildIssueFields({
  project: 'P', summary: 'S', issueType: 'Task', labels: ['hermit'],
  description: 'Why this exists.', acceptanceCriteria: 'Given a, when b, then c.', definitionOfDone: '- tests pass'
});
assert.equal(inline.issuetype.name, 'Task');
assert.deepEqual(inline.labels, ['hermit']);
const headings = inline.description.content.filter((n) => n.type === 'heading').map((n) => n.content[0].text);
assert.deepEqual(headings, ['Acceptance Criteria', 'Definition of Done']);
assert.ok(inline.description.content.some((n) => n.type === 'bulletList'), 'a "- " line becomes a bullet list');
console.log('  ✓ without custom fields, criteria become description sections');

// Fields: custom field ids configured, so the criteria go there and stay out of the description.
const custom = buildIssueFields(
  { project: 'P', summary: 'S', issueType: 'Subtask', parent: 'P-1', description: 'Body', acceptanceCriteria: 'AC text', definitionOfDone: 'DoD text' },
  { acceptanceCriteria: 'customfield_10100', definitionOfDone: 'customfield_10101' }
);
assert.equal(custom.parent.key, 'P-1');
assert.ok(custom.customfield_10100 && custom.customfield_10101);
assert.equal(custom.description.content.some((n) => n.type === 'heading'), false);
console.log('  ✓ with custom fields, criteria go into those fields');

// Only one of the two configured: the other falls back to the description.
const mixed = buildIssueFields(
  { project: 'P', summary: 'S', issueType: 'Task', acceptanceCriteria: 'AC', definitionOfDone: 'DoD' },
  { acceptanceCriteria: 'customfield_10100' }
);
assert.ok(mixed.customfield_10100);
assert.deepEqual(mixed.description.content.filter((n) => n.type === 'heading').map((n) => n.content[0].text), ['Definition of Done']);
console.log('  ✓ each criterion falls back independently');

// ADF stays valid: no empty text nodes, a plain string still yields paragraphs.
const doc = adf('First paragraph.\n\nSecond line one\nSecond line two\n\n\n');
assert.equal(doc.type, 'doc');
assert.equal(doc.content.length, 2);
assert.ok(JSON.stringify(doc).includes('hardBreak'));
assert.ok(!JSON.stringify(doc).includes('"text":""'), 'no empty text nodes');
assert.equal(buildIssueFields({ project: 'P', summary: 'S', issueType: 'Task' }).description, undefined, 'no body, no description');
console.log('  ✓ ADF output is well formed');

console.log('\nJira rules OK');
