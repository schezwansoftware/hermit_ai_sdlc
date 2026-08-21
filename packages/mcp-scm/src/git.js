import { execFileSync } from 'node:child_process';

function git(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

export function currentBranch(cwd) {
  return git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
}

export function defaultBranch(cwd) {
  const ref = git(['symbolic-ref', 'refs/remotes/origin/HEAD'], cwd);
  if (ref) return ref.replace('refs/remotes/origin/', '');
  for (const candidate of ['main', 'master', 'develop']) {
    if (git(['rev-parse', '--verify', `origin/${candidate}`], cwd)) return candidate;
  }
  return 'main';
}

export function remoteUrl(cwd, remote = 'origin') {
  return git(['remote', 'get-url', remote], cwd);
}

export function diffStat(cwd, base, head) {
  return git(['diff', '--stat', `${base}...${head}`], cwd);
}

export function diffFiles(cwd, base, head) {
  const out = git(['diff', '--name-status', `${base}...${head}`], cwd);
  if (!out) return [];
  return out.split('\n').filter(Boolean).map((line) => {
    const [status, ...rest] = line.split('\t');
    return { status, path: rest.join('\t') };
  });
}

export function createBranch(cwd, name, from) {
  try {
    execFileSync('git', from ? ['checkout', '-b', name, from] : ['checkout', '-b', name], { cwd, stdio: 'ignore' });
    return { created: true, branch: name };
  } catch (err) {
    throw new Error(`Could not create branch "${name}": ${err.message}`);
  }
}

/**
 * Parse owner/repo (and host) out of any common remote URL form:
 * https, ssh, git+ssh, scp-style, and AWS CodeCommit's grc:// and https forms.
 */
export function parseRemote(url) {
  if (!url) return null;

  const cc = /codecommit[:.]{1,2}(?:\/\/)?([a-z0-9-]+)?(?:.*?)\/v1\/repos\/([^/\s]+)/i.exec(url)
        ?? /codecommit::([a-z0-9-]+):\/\/(?:.*?)([^/\s]+)$/i.exec(url);
  if (cc) return { host: 'codecommit', region: cc[1] ?? null, owner: null, repo: cc[2], full: cc[2] };

  const scp = /^(?:[\w.-]+@)?([\w.-]+):([^/]+)\/(.+?)(?:\.git)?$/.exec(url);
  if (scp && !url.includes('://')) {
    return { host: scp[1], owner: scp[2], repo: scp[3], full: `${scp[2]}/${scp[3]}` };
  }
  try {
    const u = new URL(url.replace(/^git\+/, ''));
    const parts = u.pathname.replace(/^\/+/, '').replace(/\.git$/, '').split('/').filter(Boolean);
    if (parts.length < 2) return null;
    const repo = parts.pop();
    const owner = parts.join('/'); // GitLab subgroups
    return { host: u.hostname, owner, repo, full: `${owner}/${repo}` };
  } catch {
    return null;
  }
}
