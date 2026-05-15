// write.pixelcra.sh — proxies edits to a single file in a GitHub repo.
// Env:
//   GITHUB_TOKEN — fine-grained PAT, Contents: Read+Write, scoped to the REPO below.
// Auth/identity is enforced by Cloudflare Access in front of this Worker;
// the PAT is the GitHub identity used for commits.

const REPO   = 'peterlehfeldt/TheBrokenPilot';
const BRANCH = 'main';
const PATH   = 'The Broken Pilot.md';

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/api/file') {
      if (req.method === 'GET') return getFile(env);
      if (req.method === 'PUT') return putFile(req, env);
      return new Response('method not allowed', { status: 405 });
    }
    return env.ASSETS.fetch(req);
  }
};

function ghHeaders(env) {
  return {
    'authorization': `Bearer ${env.GITHUB_TOKEN}`,
    'accept':        'application/vnd.github+json',
    'user-agent':    'write.pixelcra.sh',
    'x-github-api-version': '2022-11-28',
  };
}

function b64encode(s) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(s)));
}
function b64decode(s) {
  return new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, '')), c => c.charCodeAt(0)));
}

async function getFile(env) {
  const r = await fetch(
    `https://api.github.com/repos/${REPO}/contents/${encodeURIComponent(PATH)}?ref=${BRANCH}`,
    { headers: ghHeaders(env), cf: { cacheTtl: 0, cacheEverything: false } },
  );
  if (!r.ok) return new Response(await r.text(), { status: r.status });
  const j = await r.json();
  return Response.json({ sha: j.sha, content: b64decode(j.content) });
}

async function putFile(req, env) {
  const { sha, content, message } = await req.json();
  if (typeof content !== 'string') return new Response('content required', { status: 400 });
  const r = await fetch(
    `https://api.github.com/repos/${REPO}/contents/${encodeURIComponent(PATH)}`,
    {
      method: 'PUT',
      headers: { ...ghHeaders(env), 'content-type': 'application/json' },
      body: JSON.stringify({
        message: message || `edit via write.pixelcra.sh @ ${new Date().toISOString()}`,
        content: b64encode(content),
        sha,
        branch: BRANCH,
      }),
    },
  );
  if (!r.ok) return new Response(await r.text(), { status: r.status });
  const j = await r.json();
  return Response.json({ sha: j.content.sha, commit: j.commit.sha });
}
