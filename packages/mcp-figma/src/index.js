#!/usr/bin/env node
import { z } from 'zod';
import { main, runServer, createClient, requireEnv, loadConfig, setting } from '@hermit/mcp-shared';
import { FigmaBridge } from './bridge.js';

const config = loadConfig();
const bridge = new FigmaBridge({
  port: Number(setting(config, 'FIGMA_BRIDGE_PORT', 'figma.bridgePort', 8473)),
  token: setting(config, 'FIGMA_BRIDGE_TOKEN', 'figma.bridgeToken', null)
});
bridge.start();

let _client = null;
function api() {
  if (_client) return _client;
  const token = requireEnv('FIGMA_TOKEN', 'personal access token from Figma → Settings → Security');
  _client = createClient({ baseUrl: 'https://api.figma.com/v1', headers: { 'X-Figma-Token': token } });
  return _client;
}

const defaultFile = () => setting(config, 'FIGMA_FILE_KEY', 'figma.fileKey');
function fileOrThrow(fileKey) {
  const k = fileKey ?? defaultFile();
  if (!k) throw new Error('No Figma file key. Pass fileKey, or set figma.fileKey in .hermit/config.json.');
  return k;
}

/** Strip the node tree down to what a designer or implementer actually needs. */
function summariseNode(node, depth = 0, maxDepth = 4) {
  if (!node) return null;
  const out = {
    id: node.id,
    name: node.name,
    type: node.type,
    ...(node.componentId ? { componentId: node.componentId } : {}),
    ...(node.characters ? { text: node.characters } : {}),
    ...(node.absoluteBoundingBox ? { box: node.absoluteBoundingBox } : {})
  };
  if (depth < maxDepth && node.children?.length) {
    out.children = node.children.map((c) => summariseNode(c, depth + 1, maxDepth));
  } else if (node.children?.length) {
    out.childCount = node.children.length;
  }
  return out;
}

const tools = [
  {
    name: 'figma_get_file',
    title: 'Get file',
    description:
      'File metadata and the top levels of its page tree. Prefer figma_get_file_nodes for anything specific — ' +
      'whole files are large and mostly irrelevant to a single feature.',
    readOnly: true,
    input: { fileKey: z.string().optional(), depth: z.number().optional() },
    handler: async ({ fileKey, depth = 2 }) => {
      const res = await api().get(`/files/${fileOrThrow(fileKey)}`, { query: { depth } });
      return {
        name: res.name,
        lastModified: res.lastModified,
        version: res.version,
        editorType: res.editorType,
        pages: (res.document?.children ?? []).map((p) => ({ id: p.id, name: p.name, childCount: p.children?.length ?? 0 }))
      };
    }
  },
  {
    name: 'figma_get_file_nodes',
    title: 'Get nodes',
    description: 'Fetch specific nodes by id. This is the efficient way to read a frame you already located.',
    readOnly: true,
    input: { ids: z.array(z.string()), fileKey: z.string().optional(), depth: z.number().optional() },
    handler: async ({ ids, fileKey, depth = 4 }) => {
      const res = await api().get(`/files/${fileOrThrow(fileKey)}/nodes`, { query: { ids: ids.join(','), depth } });
      return Object.entries(res.nodes ?? {}).map(([id, entry]) => ({ id, node: summariseNode(entry?.document, 0, depth) }));
    }
  },
  {
    name: 'figma_get_components',
    title: 'Get components',
    description: 'The file\'s published components. Read this BEFORE designing — composing beats inventing.',
    readOnly: true,
    input: { fileKey: z.string().optional() },
    handler: async ({ fileKey }) => {
      const res = await api().get(`/files/${fileOrThrow(fileKey)}/components`);
      return (res.meta?.components ?? []).map((c) => ({ key: c.key, name: c.name, description: c.description, nodeId: c.node_id, containingFrame: c.containing_frame?.name }));
    }
  },
  {
    name: 'figma_get_styles',
    title: 'Get styles',
    description: 'Published colour, text and effect styles — the token vocabulary to specify designs in.',
    readOnly: true,
    input: { fileKey: z.string().optional() },
    handler: async ({ fileKey }) => {
      const res = await api().get(`/files/${fileOrThrow(fileKey)}/styles`);
      return (res.meta?.styles ?? []).map((s) => ({ key: s.key, name: s.name, styleType: s.style_type, description: s.description, nodeId: s.node_id }));
    }
  },
  {
    name: 'figma_export_images',
    title: 'Export images',
    description: 'Render nodes to image URLs. URLs are short-lived — download promptly if you need to keep them.',
    readOnly: true,
    input: {
      ids: z.array(z.string()),
      fileKey: z.string().optional(),
      format: z.enum(['png', 'svg', 'jpg', 'pdf']).optional(),
      scale: z.number().optional()
    },
    handler: async ({ ids, fileKey, format = 'png', scale = 2 }) => {
      const res = await api().get(`/images/${fileOrThrow(fileKey)}`, { query: { ids: ids.join(','), format, scale } });
      if (res.err) throw new Error(`Figma export failed: ${res.err}`);
      return res.images;
    }
  },
  {
    name: 'figma_get_comments',
    title: 'Get comments',
    description: 'Comments on the file. Design decisions are often recorded here rather than in a document.',
    readOnly: true,
    input: { fileKey: z.string().optional() },
    handler: async ({ fileKey }) => {
      const res = await api().get(`/files/${fileOrThrow(fileKey)}/comments`);
      return (res.comments ?? []).map((c) => ({ id: c.id, message: c.message, user: c.user?.handle, createdAt: c.created_at, resolvedAt: c.resolved_at, nodeId: c.client_meta?.node_id ?? null }));
    }
  },
  {
    name: 'figma_post_comment',
    title: 'Post comment',
    description:
      'Comment on the file or a specific node. Use to record a decision on the design — never as a substitute ' +
      'for a Hermit artifact, since comments are not tracked by the pipeline.',
    input: { message: z.string(), fileKey: z.string().optional(), nodeId: z.string().optional() },
    handler: async ({ message, fileKey, nodeId }) => {
      const body = { message, ...(nodeId ? { client_meta: { node_id: nodeId, node_offset: { x: 0, y: 0 } } } : {}) };
      const res = await api().post(`/files/${fileOrThrow(fileKey)}/comments`, { body });
      return { id: res.id, createdAt: res.created_at };
    }
  },
  {
    name: 'figma_upsert_variables',
    title: 'Upsert variables',
    description:
      'Publish design tokens as Figma variables, so code and design share one source of truth. Requires an ' +
      'Enterprise plan — the Variables write API is not available on lower tiers.',
    input: {
      fileKey: z.string().optional(),
      collection: z.string().describe('Variable collection name, created if absent'),
      variables: z.array(z.object({
        name: z.string().describe('Token path, e.g. color.text.primary'),
        type: z.enum(['COLOR', 'FLOAT', 'STRING', 'BOOLEAN']),
        value: z.union([z.string(), z.number(), z.boolean()])
      }))
    },
    handler: async ({ fileKey, collection, variables }) => {
      const key = fileOrThrow(fileKey);
      const existing = await api().get(`/files/${key}/variables/local`).catch((err) => {
        throw new Error(
          `Could not read variables: ${err.message}\n` +
            `The Variables API requires a Figma Enterprise plan. On other tiers, keep design-tokens as the source of truth and skip this step.`
        );
      });
      const collections = Object.values(existing.meta?.variableCollections ?? {});
      const target = collections.find((c) => c.name === collection);

      const payload = { variableCollections: [], variables: [], variableModeValues: [] };
      let collectionId = target?.id;
      if (!collectionId) {
        collectionId = `tempCollection:${collection}`;
        payload.variableCollections.push({ action: 'CREATE', id: collectionId, name: collection, initialModeId: 'tempMode:default' });
      }
      const modeId = target?.defaultModeId ?? 'tempMode:default';
      const byName = Object.fromEntries(Object.values(existing.meta?.variables ?? {}).map((v) => [v.name, v]));

      for (const [i, v] of variables.entries()) {
        const found = byName[v.name];
        const id = found?.id ?? `tempVar:${i}`;
        if (!found) payload.variables.push({ action: 'CREATE', id, name: v.name, variableCollectionId: collectionId, resolvedType: v.type });
        payload.variableModeValues.push({ variableId: id, modeId, value: v.type === 'COLOR' ? hexToRgba(String(v.value)) : v.value });
      }
      const res = await api().post(`/files/${key}/variables`, { body: payload });
      return { updated: variables.length, collection, result: res.meta ?? res };
    }
  },
  {
    name: 'figma_create_dev_resource',
    title: 'Create dev resource',
    description: 'Attach a link to a node — use it to point a frame back at the Hermit run and the tracker item.',
    input: { nodeId: z.string(), name: z.string(), url: z.string(), fileKey: z.string().optional() },
    handler: async ({ nodeId, name, url, fileKey }) => {
      const res = await api().post('/dev_resources', {
        body: { dev_resources: [{ name, url, file_key: fileOrThrow(fileKey), node_id: nodeId }] }
      });
      return res;
    }
  },
  {
    name: 'figma_bridge_status',
    title: 'Bridge status',
    description:
      'Whether the Hermit Figma plugin is connected. ALWAYS call this before figma_create_design. ' +
      'If disconnected, record the spec in ux-hifi and continue — do not retry in a loop.',
    readOnly: true,
    input: {},
    handler: () => bridge.status()
  },
  {
    name: 'figma_create_design',
    title: 'Create design',
    description:
      'Build real frames in Figma from a scene-graph spec, via the Hermit plugin. Colour, spacing and type must ' +
      'be token names, not literals. Returns the created node ids so you can cite them in ux-hifi.',
    input: {
      page: z.string().describe('Page to create or reuse, e.g. "Hermit — PROJ-412"'),
      frames: z.array(z.object({
        name: z.string(),
        width: z.number().optional(),
        height: z.number().optional(),
        layout: z.record(z.any()).optional(),
        children: z.array(z.record(z.any()))
      })),
      fileKey: z.string().optional()
    },
    handler: async ({ page, frames, fileKey }) => {
      if (!bridge.connected) {
        return {
          state: 'bridge_disconnected',
          spec: { page, frames },
          message:
            'No Figma plugin is connected, so nothing was drawn. This is not a failure to retry — record the ' +
            'returned spec in your ux-hifi artifact, note that the bridge was unavailable, and continue. ' +
            'To enable authoring: open the file in Figma and run the Hermit plugin.'
        };
      }
      const result = await bridge.send('createDesign', { page, frames, fileKey: fileKey ?? defaultFile() });
      return { state: 'created', ...result };
    }
  }
];

function hexToRgba(hex) {
  const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex.trim());
  if (!m) throw new Error(`"${hex}" is not a hex colour. Use #RRGGBB or #RRGGBBAA.`);
  const n = parseInt(m[1], 16);
  return {
    r: ((n >> 16) & 255) / 255,
    g: ((n >> 8) & 255) / 255,
    b: (n & 255) / 255,
    a: m[2] ? parseInt(m[2], 16) / 255 : 1
  };
}

main(() =>
  runServer({
    name: 'hermit-figma',
    version: '0.1.0',
    instructions:
      'Figma for Hermit. Reads and comments work over the REST API. Creating frames requires the Hermit plugin ' +
      'to be running in Figma — always check figma_bridge_status first, and degrade to a written spec when it is ' +
      'disconnected rather than retrying. Never modify existing frames; create new ones on a Hermit-owned page.',
    tools
  })
);
