#!/usr/bin/env node
import { z } from 'zod';
import { main, runServer, loadConfig, setting, workspaceRoot } from '@hermit/mcp-shared';
import { PROVIDERS } from './providers.js';
import { currentBranch, defaultBranch, remoteUrl, parseRemote, diffFiles, diffStat, createBranch } from './git.js';

const config = loadConfig();
const cwd = workspaceRoot();

function resolveProvider() {
  const explicit = setting(config, 'SCM_PROVIDER', 'scm.provider');
  if (explicit) {
    if (!PROVIDERS[explicit]) throw new Error(`Unknown SCM provider "${explicit}". Expected one of: ${Object.keys(PROVIDERS).join(', ')}`);
    return explicit;
  }
  // Infer from the git remote so a correctly-cloned repo needs no configuration.
  const parsed = parseRemote(remoteUrl(cwd));
  if (!parsed) throw new Error('Could not determine the SCM provider. Set scm.provider in .hermit/config.json (github | bitbucket | gitlab | codecommit).');
  if (parsed.host === 'codecommit') return 'codecommit';
  if (parsed.host.includes('github')) return 'github';
  if (parsed.host.includes('gitlab')) return 'gitlab';
  if (parsed.host.includes('bitbucket')) return 'bitbucket';
  throw new Error(`Could not infer a provider from remote host "${parsed.host}". Set scm.provider in .hermit/config.json.`);
}

/** Build the request context: provider adapter, authenticated client, repo coordinates. */
function ctx() {
  const providerId = resolveProvider();
  const provider = PROVIDERS[providerId];
  const parsed = parseRemote(remoteUrl(cwd)) ?? {};
  const repoSetting = setting(config, 'SCM_REPO', 'scm.repo');
  const [cfgOwner, cfgRepo] = repoSetting ? splitRepo(repoSetting) : [null, null];
  const owner = cfgOwner ?? parsed.owner;
  const repo = cfgRepo ?? parsed.repo;
  const baseUrl = setting(config, 'SCM_BASE_URL', 'scm.baseUrl');
  const region = setting(config, 'AWS_REGION', 'scm.region') ?? parsed.region;

  if (providerId === 'codecommit') {
    if (!repo) throw new Error('CodeCommit needs a repository name. Set scm.repo in .hermit/config.json or SCM_REPO.');
    if (!region) throw new Error('CodeCommit needs a region. Set AWS_REGION or scm.region.');
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    if (!accessKeyId || !secretAccessKey) {
      throw new Error('CodeCommit requires AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY (and AWS_SESSION_TOKEN when using temporary credentials).');
    }
    return { providerId, provider, repo, region, api: provider.client({ region, accessKeyId, secretAccessKey, sessionToken: process.env.AWS_SESSION_TOKEN }) };
  }

  const token = process.env.SCM_TOKEN ?? process.env.GITHUB_TOKEN ?? process.env.GITLAB_TOKEN ?? process.env.BITBUCKET_TOKEN;
  if (!token) throw new Error(`${providerId} requires a personal access token. Set SCM_TOKEN in your environment.`);
  if (!owner || !repo) throw new Error(`Could not determine owner/repo. Set scm.repo (e.g. "acme/shop") in .hermit/config.json.`);
  const user = setting(config, 'SCM_USER', 'scm.user');
  return { providerId, provider, owner, repo, region, api: provider.client({ token, baseUrl, user }) };
}

function splitRepo(value) {
  const parts = value.split('/');
  return parts.length === 1 ? [null, parts[0]] : [parts.slice(0, -1).join('/'), parts.at(-1)];
}

const writesEnabled = () => setting(config, 'SCM_WRITES', 'scm.writes', true) !== false;
function assertWrites() {
  if (!writesEnabled()) throw new Error('SCM writes are disabled (set scm.writes: true in .hermit/config.json).');
}

const tools = [
  {
    name: 'scm_get_repo',
    title: 'Get repository',
    description: 'Active provider and repository coordinates, including the default branch to target a pull request at.',
    readOnly: true,
    input: {},
    handler: async () => {
      const c = ctx();
      const repo = await c.provider.getRepo(c);
      return { provider: c.providerId, ...repo, localBranch: currentBranch(cwd) };
    }
  },
  {
    name: 'scm_get_current_branch',
    title: 'Get current branch',
    description: 'The checked-out branch and the repository default branch, from the local clone.',
    readOnly: true,
    input: {},
    handler: () => ({ current: currentBranch(cwd), default: defaultBranch(cwd), remote: remoteUrl(cwd) })
  },
  {
    name: 'scm_create_branch',
    title: 'Create branch',
    description: 'Create and check out a local feature branch. Push happens through your normal git workflow.',
    input: { name: z.string().describe('e.g. feat/proj-412-cart-persistence'), from: z.string().optional().describe('Base ref; defaults to the current HEAD') },
    handler: ({ name, from }) => {
      assertWrites();
      return createBranch(cwd, name, from);
    }
  },
  {
    name: 'scm_get_diff',
    title: 'Get diff',
    description:
      'Files changed between two refs, with a summary stat. Compare this against the change-set artifact — ' +
      'files in the diff that the change set never mentions are a stop-the-line event.',
    readOnly: true,
    input: { base: z.string().optional(), head: z.string().optional() },
    handler: ({ base, head }) => {
      const b = base ?? defaultBranch(cwd);
      const h = head ?? currentBranch(cwd);
      return { base: b, head: h, files: diffFiles(cwd, b, h), stat: diffStat(cwd, b, h) };
    }
  },
  {
    name: 'scm_create_pull_request',
    title: 'Create pull request',
    description:
      'Open a pull request (merge request on GitLab). Outward-facing: it notifies the team, so only call this ' +
      'after the delivery gate has been approved by a human.',
    input: {
      title: z.string(),
      body: z.string().describe('Plain CommonMark — provider-specific syntax renders as noise elsewhere'),
      head: z.string().optional().describe('Source branch; defaults to the current branch'),
      base: z.string().optional().describe('Target branch; defaults to the repository default'),
      draft: z.boolean().optional().describe('Ignored by Bitbucket and CodeCommit, which have no draft state'),
      reviewers: z.array(z.string()).optional()
    },
    handler: async ({ title, body, head, base, draft = false, reviewers = [] }) => {
      assertWrites();
      const c = ctx();
      const repo = await c.provider.getRepo(c);
      const source = head ?? currentBranch(cwd);
      const target = base ?? repo.defaultBranch ?? defaultBranch(cwd);
      if (source === target) throw new Error(`Source and target are both "${source}". Create a feature branch first.`);
      const pr = await c.provider.createPullRequest(c, { title, body, head: source, base: target, draft, reviewers });
      return { provider: c.providerId, ...pr };
    }
  },
  {
    name: 'scm_get_pull_request',
    title: 'Get pull request',
    description: 'Fetch a pull request by number or id.',
    readOnly: true,
    input: { id: z.union([z.string(), z.number()]) },
    handler: async ({ id }) => {
      const c = ctx();
      return { provider: c.providerId, ...(await c.provider.getPullRequest(c, { id })) };
    }
  },
  {
    name: 'scm_update_pull_request',
    title: 'Update pull request',
    description: 'Update the title or body of an existing pull request.',
    input: { id: z.union([z.string(), z.number()]), title: z.string().optional(), body: z.string().optional(), state: z.enum(['open', 'closed']).optional() },
    handler: async ({ id, title, body, state }) => {
      assertWrites();
      const c = ctx();
      return { provider: c.providerId, ...(await c.provider.updatePullRequest(c, { id, title, body, state })) };
    }
  },
  {
    name: 'scm_add_pr_comment',
    title: 'Comment on a pull request',
    description: 'Post a comment. Used to link the Hermit run and its artifacts back to the pull request.',
    input: { id: z.union([z.string(), z.number()]), body: z.string() },
    handler: async ({ id, body }) => {
      assertWrites();
      const c = ctx();
      return await c.provider.addComment(c, { id, body });
    }
  },
  {
    name: 'scm_list_pull_requests',
    title: 'List pull requests',
    description: 'List pull requests by state. Useful for spotting an existing PR before opening a duplicate.',
    readOnly: true,
    input: { state: z.enum(['open', 'closed', 'merged', 'all']).optional(), limit: z.number().optional() },
    handler: async ({ state = 'open', limit = 20 }) => {
      const c = ctx();
      return await c.provider.listPullRequests(c, { state, limit });
    }
  }
];

main(() =>
  runServer({
    name: 'hermit-scm',
    version: '0.1.0',
    instructions:
      'Source control for Hermit, provider-agnostic across GitHub, GitLab, Bitbucket and CodeCommit. ' +
      'The active provider comes from .hermit/config.json or is inferred from the git remote — never name a ' +
      'vendor in your output; say "pull request" and let the adapter handle it. ' +
      'Creating a pull request notifies people: do it only after the delivery gate is approved.',
    tools
  })
);
