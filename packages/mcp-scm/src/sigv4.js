import crypto from 'node:crypto';

const sha256 = (data) => crypto.createHash('sha256').update(data, 'utf8').digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data, 'utf8').digest();

/**
 * AWS Signature Version 4 for CodeCommit's JSON-RPC API.
 *
 * CodeCommit has no token-based REST surface like the other three providers, so
 * requests must be SigV4-signed. Implemented here rather than pulling in the AWS
 * SDK: this is one POST shape, and the SDK would add tens of megabytes to a
 * package teams install into their workspace.
 */
export function signRequest({ method = 'POST', url, body, service = 'codecommit', region, accessKeyId, secretAccessKey, sessionToken, target }) {
  const u = new URL(url);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payload = typeof body === 'string' ? body : JSON.stringify(body ?? {});
  const payloadHash = sha256(payload);

  const headers = {
    'content-type': 'application/x-amz-json-1.1',
    host: u.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...(target ? { 'x-amz-target': target } : {}),
    ...(sessionToken ? { 'x-amz-security-token': sessionToken } : {})
  };

  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonicalHeaders = Object.keys(headers).sort().map((k) => `${k}:${String(headers[k]).trim()}\n`).join('');
  const canonicalQuery = [...u.searchParams.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  const canonicalRequest = [method, u.pathname || '/', canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');

  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  headers.authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { headers, body: payload };
}
