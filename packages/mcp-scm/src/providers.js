import { createClient, basicAuth } from '@hermit/mcp-shared';
import { signRequest } from './sigv4.js';

/**
 * Provider adapters behind one tool surface.
 *
 * Agent playbooks say "open a pull request" and never name a vendor; the active
 * provider is configuration. Each adapter normalises its provider's response
 * into the same shape so `pull-request` artifacts are comparable across repos.
 */

const norm = (o) => ({
  id: o.id,
  number: o.number ?? o.id,
  title: o.title,
  state: o.state,
  url: o.url,
  head: o.head,
  base: o.base,
  draft: o.draft ?? false,
  author: o.author ?? null,
  createdAt: o.createdAt ?? null
});

export const github = {
  id: 'github',
  client: ({ token, baseUrl }) =>
    createClient({
      baseUrl: baseUrl ?? 'https://api.github.com',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    }),
  async getRepo({ api, owner, repo }) {
    const r = await api.get(`/repos/${owner}/${repo}`);
    return { fullName: r.full_name, defaultBranch: r.default_branch, private: r.private, url: r.html_url };
  },
  async createPullRequest({ api, owner, repo }, { title, body, head, base, draft = false, reviewers = [] }) {
    const pr = await api.post(`/repos/${owner}/${repo}/pulls`, { body: { title, body, head, base, draft } });
    if (reviewers.length) {
      await api.post(`/repos/${owner}/${repo}/pulls/${pr.number}/requested_reviewers`, {
        body: { reviewers: reviewers.filter((r) => !r.includes('/')), team_reviewers: reviewers.filter((r) => r.includes('/')).map((r) => r.split('/')[1]) }
      }).catch(() => null); // reviewer assignment must not fail the PR
    }
    return norm({ id: pr.number, number: pr.number, title: pr.title, state: pr.state, url: pr.html_url, head: pr.head?.ref, base: pr.base?.ref, draft: pr.draft, author: pr.user?.login, createdAt: pr.created_at });
  },
  async getPullRequest({ api, owner, repo }, { id }) {
    const pr = await api.get(`/repos/${owner}/${repo}/pulls/${id}`);
    return norm({ id: pr.number, number: pr.number, title: pr.title, state: pr.state, url: pr.html_url, head: pr.head?.ref, base: pr.base?.ref, draft: pr.draft, author: pr.user?.login, createdAt: pr.created_at });
  },
  async updatePullRequest({ api, owner, repo }, { id, title, body, state }) {
    const pr = await api.patch(`/repos/${owner}/${repo}/pulls/${id}`, { body: { title, body, state } });
    return norm({ id: pr.number, number: pr.number, title: pr.title, state: pr.state, url: pr.html_url, head: pr.head?.ref, base: pr.base?.ref });
  },
  async addComment({ api, owner, repo }, { id, body }) {
    const c = await api.post(`/repos/${owner}/${repo}/issues/${id}/comments`, { body: { body } });
    return { id: c.id, url: c.html_url };
  },
  async listPullRequests({ api, owner, repo }, { state = 'open', limit = 20 }) {
    const list = await api.get(`/repos/${owner}/${repo}/pulls`, { query: { state, per_page: Math.min(limit, 100) } });
    return list.map((pr) => norm({ id: pr.number, number: pr.number, title: pr.title, state: pr.state, url: pr.html_url, head: pr.head?.ref, base: pr.base?.ref, author: pr.user?.login }));
  }
};

export const gitlab = {
  id: 'gitlab',
  client: ({ token, baseUrl }) =>
    createClient({ baseUrl: `${(baseUrl ?? 'https://gitlab.com').replace(/\/+$/, '')}/api/v4`, headers: { 'PRIVATE-TOKEN': token } }),
  projectId: ({ owner, repo }) => encodeURIComponent(`${owner}/${repo}`),
  async getRepo(ctx) {
    const p = await ctx.api.get(`/projects/${gitlab.projectId(ctx)}`);
    return { fullName: p.path_with_namespace, defaultBranch: p.default_branch, private: p.visibility !== 'public', url: p.web_url };
  },
  async createPullRequest(ctx, { title, body, head, base, draft = false, reviewers = [] }) {
    const mr = await ctx.api.post(`/projects/${gitlab.projectId(ctx)}/merge_requests`, {
      body: {
        title: draft ? `Draft: ${title}` : title,
        description: body,
        source_branch: head,
        target_branch: base,
        ...(reviewers.length ? { reviewer_ids: [] } : {}) // ids require a lookup; usernames are not accepted here
      }
    });
    return norm({ id: mr.iid, number: mr.iid, title: mr.title, state: mr.state, url: mr.web_url, head: mr.source_branch, base: mr.target_branch, draft: mr.draft, author: mr.author?.username, createdAt: mr.created_at });
  },
  async getPullRequest(ctx, { id }) {
    const mr = await ctx.api.get(`/projects/${gitlab.projectId(ctx)}/merge_requests/${id}`);
    return norm({ id: mr.iid, number: mr.iid, title: mr.title, state: mr.state, url: mr.web_url, head: mr.source_branch, base: mr.target_branch, draft: mr.draft, author: mr.author?.username, createdAt: mr.created_at });
  },
  async updatePullRequest(ctx, { id, title, body, state }) {
    const mr = await ctx.api.put(`/projects/${gitlab.projectId(ctx)}/merge_requests/${id}`, {
      body: { title, description: body, ...(state === 'closed' ? { state_event: 'close' } : {}) }
    });
    return norm({ id: mr.iid, number: mr.iid, title: mr.title, state: mr.state, url: mr.web_url, head: mr.source_branch, base: mr.target_branch });
  },
  async addComment(ctx, { id, body }) {
    const n = await ctx.api.post(`/projects/${gitlab.projectId(ctx)}/merge_requests/${id}/notes`, { body: { body } });
    return { id: n.id, url: null };
  },
  async listPullRequests(ctx, { state = 'open', limit = 20 }) {
    const map = { open: 'opened', closed: 'closed', all: 'all' };
    const list = await ctx.api.get(`/projects/${gitlab.projectId(ctx)}/merge_requests`, { query: { state: map[state] ?? 'opened', per_page: Math.min(limit, 100) } });
    return list.map((mr) => norm({ id: mr.iid, number: mr.iid, title: mr.title, state: mr.state, url: mr.web_url, head: mr.source_branch, base: mr.target_branch, author: mr.author?.username }));
  }
};

export const bitbucket = {
  id: 'bitbucket',
  client: ({ token, baseUrl, user }) =>
    createClient({
      baseUrl: baseUrl ?? 'https://api.bitbucket.org/2.0',
      // Bitbucket Cloud accepts an app password via basic auth, or a bearer access token.
      headers: user ? basicAuth(user, token) : { Authorization: `Bearer ${token}` }
    }),
  async getRepo({ api, owner, repo }) {
    const r = await api.get(`/repositories/${owner}/${repo}`);
    return { fullName: r.full_name, defaultBranch: r.mainbranch?.name, private: r.is_private, url: r.links?.html?.href };
  },
  async createPullRequest({ api, owner, repo }, { title, body, head, base, reviewers = [] }) {
    const pr = await api.post(`/repositories/${owner}/${repo}/pullrequests`, {
      body: {
        title,
        description: body,
        source: { branch: { name: head } },
        destination: { branch: { name: base } },
        ...(reviewers.length ? { reviewers: reviewers.map((uuid) => ({ uuid })) } : {})
      }
    });
    return norm({ id: pr.id, number: pr.id, title: pr.title, state: pr.state, url: pr.links?.html?.href, head: pr.source?.branch?.name, base: pr.destination?.branch?.name, author: pr.author?.display_name, createdAt: pr.created_on });
  },
  async getPullRequest({ api, owner, repo }, { id }) {
    const pr = await api.get(`/repositories/${owner}/${repo}/pullrequests/${id}`);
    return norm({ id: pr.id, number: pr.id, title: pr.title, state: pr.state, url: pr.links?.html?.href, head: pr.source?.branch?.name, base: pr.destination?.branch?.name, author: pr.author?.display_name, createdAt: pr.created_on });
  },
  async updatePullRequest({ api, owner, repo }, { id, title, body }) {
    const pr = await api.put(`/repositories/${owner}/${repo}/pullrequests/${id}`, { body: { title, description: body } });
    return norm({ id: pr.id, number: pr.id, title: pr.title, state: pr.state, url: pr.links?.html?.href, head: pr.source?.branch?.name, base: pr.destination?.branch?.name });
  },
  async addComment({ api, owner, repo }, { id, body }) {
    const c = await api.post(`/repositories/${owner}/${repo}/pullrequests/${id}/comments`, { body: { content: { raw: body } } });
    return { id: c.id, url: c.links?.html?.href };
  },
  async listPullRequests({ api, owner, repo }, { state = 'open', limit = 20 }) {
    const map = { open: 'OPEN', closed: 'DECLINED', merged: 'MERGED', all: null };
    const res = await api.get(`/repositories/${owner}/${repo}/pullrequests`, { query: { state: map[state] ?? 'OPEN', pagelen: Math.min(limit, 50) } });
    return (res.values ?? []).map((pr) => norm({ id: pr.id, number: pr.id, title: pr.title, state: pr.state, url: pr.links?.html?.href, head: pr.source?.branch?.name, base: pr.destination?.branch?.name, author: pr.author?.display_name }));
  }
};

export const codecommit = {
  id: 'codecommit',
  /**
   * CodeCommit exposes a JSON-RPC API rather than REST, and requires SigV4 —
   * there is no personal-access-token equivalent. Credentials come from the
   * standard AWS environment variables.
   */
  client: ({ region, accessKeyId, secretAccessKey, sessionToken }) => {
    const endpoint = `https://codecommit.${region}.amazonaws.com/`;
    return {
      async call(target, payload) {
        const { headers, body } = signRequest({
          url: endpoint,
          body: payload,
          region,
          accessKeyId,
          secretAccessKey,
          sessionToken,
          target: `CodeCommit_20150413.${target}`
        });
        const res = await fetch(endpoint, { method: 'POST', headers, body });
        const text = await res.text();
        let parsed = text;
        try { parsed = JSON.parse(text); } catch { /* keep raw */ }
        if (!res.ok) {
          const type = String(parsed?.__type ?? '').split('#').pop();
          throw new Error(`CodeCommit ${target} failed (${res.status} ${type || res.statusText}): ${parsed?.message ?? text}`);
        }
        return parsed;
      }
    };
  },
  consoleUrl: (region, repo, prId) =>
    `https://${region}.console.aws.amazon.com/codesuite/codecommit/repositories/${repo}/pull-requests/${prId}?region=${region}`,
  async getRepo({ api, repo, region }) {
    const r = await api.call('GetRepository', { repositoryName: repo });
    const meta = r.repositoryMetadata ?? {};
    return { fullName: meta.repositoryName, defaultBranch: meta.defaultBranch, private: true, url: meta.cloneUrlHttp };
  },
  async createPullRequest({ api, repo, region }, { title, body, head, base }) {
    const r = await api.call('CreatePullRequest', {
      title,
      description: body,
      targets: [{ repositoryName: repo, sourceReference: head, destinationReference: base }]
    });
    const pr = r.pullRequest ?? {};
    return norm({
      id: pr.pullRequestId, number: pr.pullRequestId, title: pr.title, state: (pr.pullRequestStatus ?? '').toLowerCase(),
      url: codecommit.consoleUrl(region, repo, pr.pullRequestId),
      head, base, author: pr.authorArn, createdAt: pr.creationDate
    });
  },
  async getPullRequest({ api, repo, region }, { id }) {
    const r = await api.call('GetPullRequest', { pullRequestId: String(id) });
    const pr = r.pullRequest ?? {};
    const t = pr.pullRequestTargets?.[0] ?? {};
    return norm({
      id: pr.pullRequestId, number: pr.pullRequestId, title: pr.title, state: (pr.pullRequestStatus ?? '').toLowerCase(),
      url: codecommit.consoleUrl(region, repo, pr.pullRequestId),
      head: t.sourceReference, base: t.destinationReference, author: pr.authorArn, createdAt: pr.creationDate
    });
  },
  async updatePullRequest({ api, repo, region }, { id, title, body }) {
    if (title) await api.call('UpdatePullRequestTitle', { pullRequestId: String(id), title });
    if (body) await api.call('UpdatePullRequestDescription', { pullRequestId: String(id), description: body });
    return codecommit.getPullRequest({ api, repo, region }, { id });
  },
  async addComment({ api, repo }, { id, body }) {
    const r = await api.call('PostCommentForPullRequest', {
      pullRequestId: String(id),
      repositoryName: repo,
      content: body
    });
    return { id: r.comment?.commentId, url: null };
  },
  async listPullRequests({ api, repo, region }, { state = 'open', limit = 20 }) {
    const r = await api.call('ListPullRequests', {
      repositoryName: repo,
      pullRequestStatus: state === 'closed' ? 'CLOSED' : 'OPEN',
      maxResults: Math.min(limit, 100)
    });
    const ids = r.pullRequestIds ?? [];
    return Promise.all(ids.map((id) => codecommit.getPullRequest({ api, repo, region }, { id })));
  }
};

export const PROVIDERS = { github, gitlab, bitbucket, codecommit };
