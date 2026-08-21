/**
 * Minimal HTTP client for the integration servers.
 *
 * Deliberately thin: retries only idempotent requests, never retries a 4xx, and
 * surfaces the provider's own error body — an agent debugging a 403 needs the
 * provider's message, not a wrapped generic one.
 */
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);
const IDEMPOTENT = new Set(['GET', 'HEAD', 'OPTIONS']);

export class HttpError extends Error {
  constructor(status, statusText, body, url) {
    super(`HTTP ${status} ${statusText} for ${url}\n${typeof body === 'string' ? body : JSON.stringify(body, null, 2)}`);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
    this.url = url;
  }
}

export function createClient({ baseUrl, headers = {}, timeoutMs = 30_000, maxRetries = 3, sign = null }) {
  const base = baseUrl?.replace(/\/+$/, '') ?? '';

  async function request(method, urlPath, { query, body, headers: extra = {}, raw = false } = {}) {
    const url = new URL(urlPath.startsWith('http') ? urlPath : `${base}${urlPath}`);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }

    let init = {
      method,
      headers: { Accept: 'application/json', ...headers, ...extra },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
    };
    if (body !== undefined && typeof body !== 'string') init.headers['Content-Type'] = 'application/json';
    if (sign) init = await sign({ url, init });

    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, { ...init, signal: controller.signal });
        clearTimeout(timer);

        if (!res.ok) {
          const text = await res.text();
          let parsed = text;
          try { parsed = JSON.parse(text); } catch { /* keep text */ }
          const err = new HttpError(res.status, res.statusText, parsed, url.toString());
          const canRetry = RETRYABLE.has(res.status) && IDEMPOTENT.has(method) && attempt < maxRetries;
          if (!canRetry) throw err;
          lastError = err;
          await backoff(attempt, res.headers.get('retry-after'));
          continue;
        }

        if (raw) return res;
        if (res.status === 204) return null;
        const text = await res.text();
        if (!text) return null;
        try { return JSON.parse(text); } catch { return text; }
      } catch (err) {
        clearTimeout(timer);
        if (err instanceof HttpError) throw err;
        if (attempt >= maxRetries) throw err;
        lastError = err;
        await backoff(attempt, null);
      }
    }
    throw lastError;
  }

  return {
    get: (p, o) => request('GET', p, o),
    post: (p, o) => request('POST', p, o),
    put: (p, o) => request('PUT', p, o),
    patch: (p, o) => request('PATCH', p, o),
    delete: (p, o) => request('DELETE', p, o),
    request
  };
}

function backoff(attempt, retryAfter) {
  const header = Number(retryAfter);
  const ms = Number.isFinite(header) && header > 0 ? header * 1000 : Math.min(2 ** attempt * 300 + Math.random() * 200, 8000);
  return new Promise((r) => setTimeout(r, ms));
}

export function basicAuth(user, token) {
  return { Authorization: `Basic ${Buffer.from(`${user}:${token}`).toString('base64')}` };
}
