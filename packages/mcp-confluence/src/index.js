#!/usr/bin/env node
import { z } from 'zod';
import { main, runServer, createClient, basicAuth, requireEnv, loadConfig, setting } from '@hermit/mcp-shared';

const config = loadConfig();
const baseUrl = setting(config, 'CONFLUENCE_BASE_URL', 'confluence.baseUrl');
const email = setting(config, 'CONFLUENCE_EMAIL', 'confluence.email');

let _client = null;
function api(version = 'v2') {
  const url = baseUrl ?? requireEnv('CONFLUENCE_BASE_URL', 'e.g. https://your-org.atlassian.net/wiki');
  const user = email ?? requireEnv('CONFLUENCE_EMAIL', 'your Atlassian account email');
  const token = requireEnv('CONFLUENCE_API_TOKEN', 'Atlassian API token');
  const root = url.replace(/\/+$/, '');
  const key = `${root}|${version}`;
  if (_client?.key === key) return _client.client;
  const client = createClient({
    baseUrl: version === 'v2' ? `${root}/api/v2` : `${root}/rest/api`,
    headers: basicAuth(user, token)
  });
  _client = { key, client };
  return client;
}

const writesEnabled = () => setting(config, 'CONFLUENCE_WRITES', 'confluence.writes', false) === true;
function assertWrites() {
  if (!writesEnabled()) {
    throw new Error(
      'Confluence writes are disabled. Set confluence.writes: true in .hermit/config.json to enable. ' +
        'Confluence edits are visible company-wide, so this is opt-in by default.'
    );
  }
}

/** Confluence storage format is XHTML; agents want readable text. */
function toText(html = '') {
  return String(html)
    .replace(/<ac:structured-macro[^>]*ac:name="code"[\s\S]*?<\/ac:structured-macro>/g, (m) => {
      const body = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(m);
      return body ? `\n\`\`\`\n${body[1]}\n\`\`\`\n` : '';
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<h([1-6])[^>]*>/gi, (_, n) => '\n' + '#'.repeat(Number(n)) + ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const pageUrl = (id) => `${baseUrl?.replace(/\/+$/, '')}/pages/${id}`;

const tools = [
  {
    name: 'confluence_search',
    title: 'Search Confluence',
    description:
      'Search pages by text or CQL. Search the feature name AND the product area — the page you need is usually named neither.',
    readOnly: true,
    input: {
      query: z.string().describe('Free text, or a full CQL expression when cql is true'),
      cql: z.boolean().optional().describe('Treat query as raw CQL'),
      spaceKey: z.string().optional(),
      limit: z.number().optional()
    },
    handler: async ({ query, cql = false, spaceKey, limit = 20 }) => {
      const expr = cql ? query : `text ~ "${query.replace(/"/g, '\\"')}"${spaceKey ? ` AND space = "${spaceKey}"` : ''}`;
      const res = await api('v1').get('/search', { query: { cql: expr, limit: Math.min(limit, 50) } });
      return (res.results ?? []).map((r) => ({
        id: r.content?.id ?? r.id,
        title: r.content?.title ?? r.title,
        type: r.content?.type,
        space: r.resultGlobalContainer?.title ?? r.space?.name,
        lastModified: r.lastModified ?? r.friendlyLastModified,
        excerpt: toText(r.excerpt ?? ''),
        url: r.content?.id ? pageUrl(r.content.id) : null
      }));
    }
  },
  {
    name: 'confluence_get_page',
    title: 'Get page',
    description: 'Full page body as readable text, with version and last-modified so you can judge staleness.',
    readOnly: true,
    input: { id: z.string().describe('Page id') },
    handler: async ({ id }) => {
      const page = await api().get(`/pages/${encodeURIComponent(id)}`, { query: { 'body-format': 'storage' } });
      return {
        id: page.id,
        title: page.title,
        spaceId: page.spaceId,
        version: page.version?.number,
        lastModified: page.version?.createdAt,
        authorId: page.version?.authorId,
        url: pageUrl(page.id),
        body: toText(page.body?.storage?.value ?? '')
      };
    }
  },
  {
    name: 'confluence_get_page_children',
    title: 'Get child pages',
    description: 'Direct children of a page. Follow the space tree rather than relying on search alone.',
    readOnly: true,
    input: { id: z.string(), limit: z.number().optional() },
    handler: async ({ id, limit = 50 }) => {
      const res = await api().get(`/pages/${encodeURIComponent(id)}/children`, { query: { limit: Math.min(limit, 100) } });
      return (res.results ?? []).map((c) => ({ id: c.id, title: c.title, url: pageUrl(c.id) }));
    }
  },
  {
    name: 'confluence_get_attachments',
    title: 'Get attachments',
    description: 'Attachments on a page — specs and diagrams are often attached rather than inline.',
    readOnly: true,
    input: { id: z.string() },
    handler: async ({ id }) => {
      const res = await api().get(`/pages/${encodeURIComponent(id)}/attachments`, { query: { limit: 50 } });
      return (res.results ?? []).map((a) => ({ id: a.id, title: a.title, mediaType: a.mediaType, fileSize: a.fileSize, downloadUrl: a.downloadLink }));
    }
  },
  {
    name: 'confluence_create_page',
    title: 'Create page',
    description: 'Create a page. Prefer updating an existing page — a duplicate splits the truth and the old one keeps ranking in search.',
    input: {
      spaceId: z.string(),
      title: z.string(),
      body: z.string().describe('Markdown-ish text; converted to storage format'),
      parentId: z.string().optional()
    },
    handler: async ({ spaceId, title, body, parentId }) => {
      assertWrites();
      const res = await api().post('/pages', {
        body: {
          spaceId,
          status: 'current',
          title,
          ...(parentId ? { parentId } : {}),
          body: { representation: 'storage', value: toStorage(body) }
        }
      });
      return { id: res.id, title: res.title, url: pageUrl(res.id) };
    }
  },
  {
    name: 'confluence_update_page',
    title: 'Update page',
    description:
      'Update an existing page. Requires the current version number, which the API uses for optimistic concurrency — ' +
      'fetch the page first so you never silently overwrite someone else\'s edit.',
    input: {
      id: z.string(),
      title: z.string(),
      body: z.string(),
      version: z.number().describe('Current version number from confluence_get_page, incremented automatically'),
      message: z.string().optional().describe('Version comment')
    },
    handler: async ({ id, title, body, version, message }) => {
      assertWrites();
      const res = await api().put(`/pages/${encodeURIComponent(id)}`, {
        body: {
          id,
          status: 'current',
          title,
          body: { representation: 'storage', value: toStorage(body) },
          version: { number: version + 1, message: message ?? 'Updated by Hermit' }
        }
      });
      return { id: res.id, version: res.version?.number, url: pageUrl(res.id) };
    }
  }
];

/** Minimal markdown → Confluence storage format. Headings, lists, code and paragraphs. */
function toStorage(md) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const out = [];
  let inCode = false;
  let codeBuf = [];
  let listOpen = false;
  const closeList = () => { if (listOpen) { out.push('</ul>'); listOpen = false; } };

  for (const line of String(md).split('\n')) {
    if (/^```/.test(line)) {
      if (inCode) {
        out.push(`<ac:structured-macro ac:name="code"><ac:plain-text-body><![CDATA[${codeBuf.join('\n')}]]></ac:plain-text-body></ac:structured-macro>`);
        codeBuf = []; inCode = false;
      } else { closeList(); inCode = true; }
      continue;
    }
    if (inCode) { codeBuf.push(line); continue; }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { closeList(); out.push(`<h${h[1].length}>${esc(h[2])}</h${h[1].length}>`); continue; }
    const li = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (li) { if (!listOpen) { out.push('<ul>'); listOpen = true; } out.push(`<li>${esc(li[1])}</li>`); continue; }
    if (!line.trim()) { closeList(); continue; }
    closeList();
    out.push(`<p>${esc(line)}</p>`);
  }
  closeList();
  return out.join('');
}

main(() =>
  runServer({
    name: 'hermit-confluence',
    version: '0.1.0',
    instructions:
      'Confluence access for Hermit. Reads are always available. Writes are OFF by default because Confluence ' +
      'edits are visible company-wide; enable with confluence.writes in .hermit/config.json. Never delete a page — supersede it with a link.',
    tools
  })
);
