#!/usr/bin/env node
import { z } from 'zod';
import { main, runServer, createClient, basicAuth, requireEnv, loadConfig, setting } from '@hermit/mcp-shared';

const config = loadConfig();
const baseUrl = setting(config, 'JIRA_BASE_URL', 'jira.baseUrl');
const email = setting(config, 'JIRA_EMAIL', 'jira.email');

/** Lazy client: the server must start even without credentials so the host can list its tools. */
let _client = null;
function api() {
  if (_client) return _client;
  const url = baseUrl ?? requireEnv('JIRA_BASE_URL', 'e.g. https://your-org.atlassian.net');
  const user = email ?? requireEnv('JIRA_EMAIL', 'your Atlassian account email');
  const token = requireEnv('JIRA_API_TOKEN', 'create at https://id.atlassian.com/manage-profile/security/api-tokens');
  _client = createClient({ baseUrl: `${url.replace(/\/+$/, '')}/rest/api/3`, headers: basicAuth(user, token) });
  return _client;
}

const writesEnabled = () => setting(config, 'JIRA_WRITES', 'jira.writes', true) !== false;
function assertWrites() {
  if (!writesEnabled()) throw new Error('Jira writes are disabled (set jira.writes: true in .hermit/config.json to enable).');
}

/** Atlassian Document Format: the v3 API refuses plain strings for rich-text fields. */
function adf(text) {
  return {
    type: 'doc',
    version: 1,
    content: String(text)
      .split(/\n{2,}/)
      .map((para) => ({ type: 'paragraph', content: [{ type: 'text', text: para }] }))
  };
}

/** Flatten ADF back to text so an agent reads prose, not a node tree. */
function fromAdf(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  const inner = (node.content ?? []).map(fromAdf).join('');
  return ['paragraph', 'heading', 'listItem', 'codeBlock'].includes(node.type) ? inner + '\n' : inner;
}

function issueSummary(issue) {
  const f = issue.fields ?? {};
  return {
    key: issue.key,
    summary: f.summary,
    status: f.status?.name,
    type: f.issuetype?.name,
    priority: f.priority?.name,
    assignee: f.assignee?.displayName ?? null,
    reporter: f.reporter?.displayName ?? null,
    labels: f.labels ?? [],
    created: f.created,
    updated: f.updated,
    parent: f.parent?.key ?? null,
    description: fromAdf(f.description).trim(),
    url: `${baseUrl?.replace(/\/+$/, '')}/browse/${issue.key}`
  };
}

const tools = [
  {
    name: 'jira_get_issue',
    title: 'Get issue',
    description: 'Full issue: description, status, assignee, labels, parent and links. Start every requirements run here.',
    readOnly: true,
    input: { key: z.string().describe('Issue key, e.g. PROJ-412') },
    handler: async ({ key }) => issueSummary(await api().get(`/issue/${encodeURIComponent(key)}`, { query: { expand: 'names' } }))
  },
  {
    name: 'jira_search',
    title: 'Search issues (JQL)',
    description: 'Search with JQL. Use for prior art: previous attempts at a feature carry constraints nobody restates.',
    readOnly: true,
    input: {
      jql: z.string().describe('e.g. project = PROJ AND text ~ "checkout" ORDER BY updated DESC'),
      limit: z.number().optional().describe('Default 25, max 100')
    },
    handler: async ({ jql, limit = 25 }) => {
      const res = await api().post('/search/jql', {
        body: { jql, maxResults: Math.min(limit, 100), fields: ['summary', 'status', 'issuetype', 'assignee', 'updated', 'labels', 'parent'] }
      });
      return { total: res.total ?? res.issues?.length ?? 0, issues: (res.issues ?? []).map(issueSummary) };
    }
  },
  {
    name: 'jira_get_comments',
    title: 'Get comments',
    description: 'All comments in order. The real requirement is often in comment 7, not the description.',
    readOnly: true,
    input: { key: z.string() },
    handler: async ({ key }) => {
      const res = await api().get(`/issue/${encodeURIComponent(key)}/comment`, { query: { maxResults: 100, orderBy: 'created' } });
      return (res.comments ?? []).map((c) => ({ author: c.author?.displayName, created: c.created, body: fromAdf(c.body).trim() }));
    }
  },
  {
    name: 'jira_list_issue_links',
    title: 'List issue links',
    description: 'Linked issues with relationship types, plus subtasks. Duplicates reveal what people keep asking for.',
    readOnly: true,
    input: { key: z.string() },
    handler: async ({ key }) => {
      const issue = await api().get(`/issue/${encodeURIComponent(key)}`, { query: { fields: 'issuelinks,subtasks' } });
      return {
        links: (issue.fields?.issuelinks ?? []).map((l) => ({
          type: l.type?.name,
          direction: l.outwardIssue ? 'outward' : 'inward',
          relation: l.outwardIssue ? l.type?.outward : l.type?.inward,
          key: (l.outwardIssue ?? l.inwardIssue)?.key,
          summary: (l.outwardIssue ?? l.inwardIssue)?.fields?.summary
        })),
        subtasks: (issue.fields?.subtasks ?? []).map((s) => ({ key: s.key, summary: s.fields?.summary, status: s.fields?.status?.name }))
      };
    }
  },
  {
    name: 'jira_create_issue',
    title: 'Create issue',
    description: 'Create an issue. Only for work inside the approved plan — never to record scope you invented.',
    input: {
      project: z.string().describe('Project key'),
      summary: z.string(),
      description: z.string().optional(),
      issueType: z.string().optional().describe('Default: Task'),
      parent: z.string().optional().describe('Parent key, for subtasks'),
      labels: z.array(z.string()).optional()
    },
    handler: async ({ project, summary, description, issueType = 'Task', parent, labels }) => {
      assertWrites();
      const fields = { project: { key: project }, summary, issuetype: { name: issueType } };
      if (description) fields.description = adf(description);
      if (parent) fields.parent = { key: parent };
      if (labels?.length) fields.labels = labels;
      const res = await api().post('/issue', { body: { fields } });
      return { key: res.key, url: `${baseUrl?.replace(/\/+$/, '')}/browse/${res.key}` };
    }
  },
  {
    name: 'jira_create_subtasks',
    title: 'Create subtasks',
    description: 'Create several subtasks under a parent in one call. Used by the planner to publish work packages.',
    input: {
      parent: z.string().describe('Parent issue key'),
      project: z.string(),
      subtasks: z.array(z.object({ summary: z.string(), description: z.string().optional() })),
      issueType: z.string().optional().describe('Default: Subtask')
    },
    handler: async ({ parent, project, subtasks, issueType = 'Subtask' }) => {
      assertWrites();
      const created = [];
      for (const st of subtasks) {
        const fields = { project: { key: project }, parent: { key: parent }, summary: st.summary, issuetype: { name: issueType } };
        if (st.description) fields.description = adf(st.description);
        const res = await api().post('/issue', { body: { fields } });
        created.push({ key: res.key, summary: st.summary });
      }
      return { parent, created };
    }
  },
  {
    name: 'jira_update_issue',
    title: 'Update issue',
    description: 'Update summary, description or labels on an existing issue.',
    input: {
      key: z.string(),
      summary: z.string().optional(),
      description: z.string().optional(),
      labels: z.array(z.string()).optional()
    },
    handler: async ({ key, summary, description, labels }) => {
      assertWrites();
      const fields = {};
      if (summary) fields.summary = summary;
      if (description) fields.description = adf(description);
      if (labels) fields.labels = labels;
      if (!Object.keys(fields).length) throw new Error('Nothing to update: pass summary, description or labels.');
      await api().put(`/issue/${encodeURIComponent(key)}`, { body: { fields } });
      return { key, updated: Object.keys(fields) };
    }
  },
  {
    name: 'jira_transition_issue',
    title: 'Transition issue',
    description: 'Move an issue to a new status by transition name. Lists the valid transitions when the name does not match.',
    input: { key: z.string(), transition: z.string().describe('e.g. "In Progress", "Done"') },
    handler: async ({ key, transition }) => {
      assertWrites();
      const { transitions = [] } = await api().get(`/issue/${encodeURIComponent(key)}/transitions`);
      const match = transitions.find((t) => t.name.toLowerCase() === transition.toLowerCase() || t.to?.name?.toLowerCase() === transition.toLowerCase());
      if (!match) {
        return { state: 'no_such_transition', available: transitions.map((t) => t.name), message: `"${transition}" is not available from the current status.` };
      }
      await api().post(`/issue/${encodeURIComponent(key)}/transitions`, { body: { transition: { id: match.id } } });
      return { key, transitionedTo: match.to?.name ?? match.name };
    }
  },
  {
    name: 'jira_add_comment',
    title: 'Add comment',
    description: 'Post a comment. Used to link a Hermit run and its pull request back to the tracker.',
    input: { key: z.string(), body: z.string() },
    handler: async ({ key, body }) => {
      assertWrites();
      const res = await api().post(`/issue/${encodeURIComponent(key)}/comment`, { body: { body: adf(body) } });
      return { key, commentId: res.id };
    }
  }
];

main(() =>
  runServer({
    name: 'hermit-jira',
    version: '0.1.0',
    instructions:
      'Jira access for Hermit. Reads are always available; writes obey jira.writes in .hermit/config.json. ' +
      'Never create tracker items for work outside the approved architecture.',
    tools
  })
);
