/**
 * Registry of the MCP servers Hermit ships, and the tools each exposes.
 *
 * Tool names are server-prefixed (`jira_get_issue`) so they read unambiguously
 * inside an agent playbook. The prefix before the first underscore resolves the
 * owning server, which is how a role's declared `context.reads.mcp` list is
 * compiled into a per-server allowlist in the host config.
 */
export const SERVERS = {
  hermit: {
    id: 'hermit',
    title: 'Hermit workflow',
    package: '@hermit/mcp-workflow',
    bin: 'hermit-mcp-workflow',
    description: 'Run state, artifacts, context bundles and gate status. The pipeline ledger.',
    env: [],
    tools: [
      'hermit_status',
      'hermit_next_task',
      'hermit_submit_artifact',
      'hermit_request_handoff',
      'hermit_get_artifact',
      'hermit_list_agents',
      'hermit_get_agent',
      'hermit_gate_status',
      'hermit_journal',
      'hermit_start_run',
      'hermit_onboarding_task',
      'hermit_submit_onboarding'
    ]
  },
  jira: {
    id: 'jira',
    title: 'Jira',
    package: '@hermit/mcp-jira',
    bin: 'hermit-mcp-jira',
    description: 'Issues, search, comments, links, transitions and subtask creation.',
    env: [
      { name: 'JIRA_BASE_URL', required: true, secret: false, hint: 'https://your-org.atlassian.net' },
      { name: 'JIRA_EMAIL', required: true, secret: false, hint: 'Atlassian account email' },
      { name: 'JIRA_API_TOKEN', required: true, secret: true, hint: 'https://id.atlassian.com/manage-profile/security/api-tokens' }
    ],
    tools: [
      'jira_get_issue',
      'jira_search',
      'jira_get_comments',
      'jira_list_issue_links',
      'jira_create_issue',
      'jira_create_subtasks',
      'jira_update_issue',
      'jira_transition_issue',
      'jira_add_comment'
    ]
  },
  confluence: {
    id: 'confluence',
    title: 'Confluence',
    package: '@hermit/mcp-confluence',
    bin: 'hermit-mcp-confluence',
    description: 'Space and page search, page content, child pages, attachments, page authoring.',
    env: [
      { name: 'CONFLUENCE_BASE_URL', required: true, secret: false, hint: 'https://your-org.atlassian.net/wiki' },
      { name: 'CONFLUENCE_EMAIL', required: true, secret: false, hint: 'Atlassian account email' },
      { name: 'CONFLUENCE_API_TOKEN', required: true, secret: true, hint: 'Atlassian API token' }
    ],
    tools: [
      'confluence_search',
      'confluence_get_page',
      'confluence_get_page_children',
      'confluence_get_attachments',
      'confluence_create_page',
      'confluence_update_page'
    ]
  },
  sharepoint: {
    id: 'sharepoint',
    title: 'SharePoint',
    package: '@hermit/mcp-sharepoint',
    bin: 'hermit-mcp-sharepoint',
    description: 'Site search, drive and folder listing, file content, list items.',
    env: [
      { name: 'SHAREPOINT_TENANT_ID', required: true, secret: false, hint: 'Entra tenant id' },
      { name: 'SHAREPOINT_CLIENT_ID', required: true, secret: false, hint: 'App registration client id' },
      { name: 'SHAREPOINT_CLIENT_SECRET', required: true, secret: true, hint: 'App registration client secret' },
      { name: 'SHAREPOINT_SITE_ID', required: false, secret: false, hint: 'Default site id, optional' }
    ],
    tools: [
      'sharepoint_search',
      'sharepoint_list_folder',
      'sharepoint_get_file',
      'sharepoint_get_list_items',
      'sharepoint_upload_file'
    ]
  },
  figma: {
    id: 'figma',
    title: 'Figma',
    package: '@hermit/mcp-figma',
    bin: 'hermit-mcp-figma',
    description: 'File and node reads, component and style libraries, image export, comments.',
    env: [
      { name: 'FIGMA_TOKEN', required: true, secret: true, hint: 'Personal access token from Figma settings' }
    ],
    tools: [
      'figma_get_file',
      'figma_get_file_nodes',
      'figma_get_components',
      'figma_get_styles',
      'figma_export_images',
      'figma_get_comments',
      'figma_post_comment',
      'figma_upsert_variables',
      'figma_create_dev_resource',
      'figma_bridge_status',
      'figma_create_design'
    ],
    notes:
      'Figma REST cannot create frames or layers — only the Plugin API can. ' +
      'figma_create_design emits a scene-graph spec over the local bridge and requires the ' +
      'companion Hermit plugin to be running in Figma. Without it the tool returns the spec ' +
      'and reports the bridge as disconnected rather than failing.'
  },
  scm: {
    id: 'scm',
    title: 'Source control',
    package: '@hermit/mcp-scm',
    bin: 'hermit-mcp-scm',
    description:
      'Provider-agnostic source control: branches, diffs and pull requests across GitHub, ' +
      'Bitbucket, GitLab and AWS CodeCommit. One tool surface; the active provider is set in ' +
      '.hermit/config.json so agent playbooks never name a vendor.',
    env: [
      { name: 'SCM_PROVIDER', required: true, secret: false, hint: 'github | bitbucket | gitlab | codecommit' },
      { name: 'SCM_TOKEN', required: false, secret: true, hint: 'PAT for github/bitbucket/gitlab; unused for codecommit' },
      { name: 'SCM_BASE_URL', required: false, secret: false, hint: 'Self-hosted GitLab/Bitbucket/GHES base URL' },
      { name: 'SCM_REPO', required: false, secret: false, hint: 'owner/repo, or project/repo — inferred from git remote when omitted' },
      { name: 'AWS_REGION', required: false, secret: false, hint: 'CodeCommit only' }
    ],
    tools: [
      'scm_get_repo',
      'scm_get_current_branch',
      'scm_create_branch',
      'scm_get_diff',
      'scm_create_pull_request',
      'scm_get_pull_request',
      'scm_update_pull_request',
      'scm_add_pr_comment',
      'scm_list_pull_requests'
    ]
  }
};

/** SCM providers the scm server can target. */
export const SCM_PROVIDERS = ['github', 'bitbucket', 'gitlab', 'codecommit'];

/**
 * The handoff protocol every agent must be able to speak.
 *
 * These are granted to every agent regardless of what its definition declares:
 * an agent that cannot call hermit_request_handoff cannot participate in the
 * pipeline at all. Role scoping governs *domain* access (Jira, Figma, the
 * repository) — not the ability to receive work and report completion.
 */
export const PROTOCOL_TOOLS = Object.freeze([
  'hermit_status',
  'hermit_next_task',
  'hermit_submit_artifact',
  'hermit_request_handoff',
  'hermit_get_artifact',
  'hermit_gate_status',
  'hermit_get_agent'
]);

/**
 * Onboarding sits outside the pipeline, so its two tools are not part of the
 * protocol floor every agent gets. Only the onboarding agent declares them.
 */
export const ONBOARDING_TOOLS = Object.freeze(['hermit_onboarding_task', 'hermit_submit_onboarding']);

/** Declared MCP tools plus the protocol floor, de-duplicated. */
export function effectiveMcpTools(declared = []) {
  return [...new Set([...PROTOCOL_TOOLS, ...declared])];
}

/** Resolve the server that owns a tool name, by its prefix. */
export function serverForTool(toolName) {
  const prefix = String(toolName).split('_')[0];
  return SERVERS[prefix] ?? null;
}

/**
 * Group a flat list of tool names into { serverId: [tools] }, dropping any tool
 * the registry does not know about (returned separately so callers can warn).
 */
export function groupToolsByServer(toolNames = []) {
  const grouped = {};
  const unknown = [];
  for (const name of toolNames) {
    const server = serverForTool(name);
    if (!server || !server.tools.includes(name)) {
      unknown.push(name);
      continue;
    }
    (grouped[server.id] ??= []).push(name);
  }
  return { grouped, unknown };
}

export const ALL_ENV = Object.values(SERVERS).flatMap((s) => s.env.map((e) => ({ ...e, server: s.id })));
