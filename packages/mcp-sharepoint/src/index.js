#!/usr/bin/env node
import { z } from 'zod';
import { main, runServer, createClient, requireEnv, loadConfig, setting } from '@hermit/mcp-shared';

const config = loadConfig();
const GRAPH = 'https://graph.microsoft.com/v1.0';

let cachedToken = null;

/**
 * Client-credentials flow against Entra ID. Tokens are cached until 60s before
 * expiry — an MCP server is long-lived and re-authenticating per call would both
 * rate-limit and slow every tool.
 */
async function accessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const tenant = setting(config, 'SHAREPOINT_TENANT_ID', 'sharepoint.tenantId') ?? requireEnv('SHAREPOINT_TENANT_ID', 'Entra tenant id');
  const clientId = setting(config, 'SHAREPOINT_CLIENT_ID', 'sharepoint.clientId') ?? requireEnv('SHAREPOINT_CLIENT_ID', 'app registration client id');
  const secret = requireEnv('SHAREPOINT_CLIENT_SECRET', 'app registration client secret');

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: secret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials'
  });
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(
      `Entra token request failed (${res.status}): ${json.error_description ?? json.error ?? 'unknown'}\n` +
        `Check that the app registration has Sites.Read.All (and Sites.ReadWrite.All for uploads) granted with admin consent.`
    );
  }
  cachedToken = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return cachedToken.value;
}

async function api() {
  const token = await accessToken();
  return createClient({ baseUrl: GRAPH, headers: { Authorization: `Bearer ${token}` } });
}

const defaultSite = () => setting(config, 'SHAREPOINT_SITE_ID', 'sharepoint.siteId');
function siteOrThrow(siteId) {
  const s = siteId ?? defaultSite();
  if (!s) throw new Error('No site id. Pass siteId, or set sharepoint.siteId in .hermit/config.json.');
  return s;
}

const writesEnabled = () => setting(config, 'SHAREPOINT_WRITES', 'sharepoint.writes', false) === true;

const tools = [
  {
    name: 'sharepoint_search',
    title: 'Search SharePoint',
    description:
      'Search across SharePoint content. Specs, contracts and regulatory documents often live here rather than in the wiki.',
    readOnly: true,
    input: {
      query: z.string(),
      entityTypes: z.array(z.enum(['driveItem', 'listItem', 'site', 'drive'])).optional(),
      limit: z.number().optional()
    },
    handler: async ({ query, entityTypes = ['driveItem', 'listItem'], limit = 20 }) => {
      const client = await api();
      const res = await client.post('/search/query', {
        body: { requests: [{ entityTypes, query: { queryString: query }, from: 0, size: Math.min(limit, 50) }] }
      });
      const hits = res.value?.[0]?.hitsContainers?.[0]?.hits ?? [];
      return hits.map((h) => ({
        id: h.resource?.id,
        name: h.resource?.name ?? h.resource?.fields?.title,
        type: h.resource?.['@odata.type']?.split('.').pop(),
        summary: h.summary,
        lastModified: h.resource?.lastModifiedDateTime,
        webUrl: h.resource?.webUrl,
        parent: h.resource?.parentReference ?? null
      }));
    }
  },
  {
    name: 'sharepoint_list_folder',
    title: 'List folder',
    description: 'List a document-library folder. Walk the tree when search returns nothing useful.',
    readOnly: true,
    input: { path: z.string().optional().describe('Library-relative path; omit for the root'), siteId: z.string().optional() },
    handler: async ({ path: folder, siteId }) => {
      const client = await api();
      const site = siteOrThrow(siteId);
      const url = folder ? `/sites/${site}/drive/root:/${encodeURI(folder)}:/children` : `/sites/${site}/drive/root/children`;
      const res = await client.get(url, { query: { $top: 200 } });
      return (res.value ?? []).map((i) => ({
        id: i.id,
        name: i.name,
        kind: i.folder ? 'folder' : 'file',
        size: i.size,
        lastModified: i.lastModifiedDateTime,
        webUrl: i.webUrl
      }));
    }
  },
  {
    name: 'sharepoint_get_file',
    title: 'Get file',
    description:
      'Download a file as text. Office binaries (.docx, .xlsx, .pptx) are reported as unreadable rather than ' +
      'returned as mojibake — request an exported format or ask a human.',
    readOnly: true,
    input: { itemId: z.string().optional(), path: z.string().optional(), siteId: z.string().optional() },
    handler: async ({ itemId, path: filePath, siteId }) => {
      if (!itemId && !filePath) throw new Error('Pass itemId or path.');
      const client = await api();
      const site = siteOrThrow(siteId);
      const base = itemId ? `/sites/${site}/drive/items/${itemId}` : `/sites/${site}/drive/root:/${encodeURI(filePath)}:`;
      const meta = await client.get(base);
      const binary = /\.(docx|xlsx|pptx|pdf|png|jpg|jpeg|gif|zip)$/i.test(meta.name ?? '');
      if (binary) {
        return {
          state: 'not_text',
          name: meta.name,
          size: meta.size,
          webUrl: meta.webUrl,
          message: `"${meta.name}" is a binary format this server does not parse. Open it via webUrl, or ask for a text/markdown export.`
        };
      }
      const res = await client.get(`${base}/content`, { raw: true });
      return { name: meta.name, size: meta.size, webUrl: meta.webUrl, lastModified: meta.lastModifiedDateTime, content: await res.text() };
    }
  },
  {
    name: 'sharepoint_get_list_items',
    title: 'Get list items',
    description: 'Read items from a SharePoint list, with their field values expanded.',
    readOnly: true,
    input: { listId: z.string().describe('List id or name'), siteId: z.string().optional(), limit: z.number().optional() },
    handler: async ({ listId, siteId, limit = 50 }) => {
      const client = await api();
      const site = siteOrThrow(siteId);
      const res = await client.get(`/sites/${site}/lists/${encodeURIComponent(listId)}/items`, {
        query: { expand: 'fields', $top: Math.min(limit, 200) }
      });
      return (res.value ?? []).map((i) => ({ id: i.id, lastModified: i.lastModifiedDateTime, webUrl: i.webUrl, fields: i.fields }));
    }
  },
  {
    name: 'sharepoint_upload_file',
    title: 'Upload file',
    description:
      'Upload or replace a text file in a document library. Disabled by default — SharePoint writes are visible ' +
      'company-wide and are hard to undo.',
    input: { path: z.string().describe('Library-relative destination path'), content: z.string(), siteId: z.string().optional() },
    handler: async ({ path: dest, content, siteId }) => {
      if (!writesEnabled()) throw new Error('SharePoint writes are disabled. Set sharepoint.writes: true in .hermit/config.json to enable.');
      const client = await api();
      const site = siteOrThrow(siteId);
      const res = await client.put(`/sites/${site}/drive/root:/${encodeURI(dest)}:/content`, {
        body: content,
        headers: { 'Content-Type': 'text/plain' }
      });
      return { id: res.id, name: res.name, webUrl: res.webUrl, size: res.size };
    }
  }
];

main(() =>
  runServer({
    name: 'hermit-sharepoint',
    version: '0.1.0',
    instructions:
      'SharePoint access via Microsoft Graph. Reads need Sites.Read.All; uploads need Sites.ReadWrite.All and ' +
      'must be enabled in .hermit/config.json. Binary Office formats are not parsed — request an export instead.',
    tools
  })
);
