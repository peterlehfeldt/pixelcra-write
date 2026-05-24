// write.pixelcra.sh
//
// Two repos:
//   MANUSCRIPT_REPO — the prose itself (The Broken Pilot.md)
//   CONFIG_REPO     — skills/*.md and sessions/*.json for the AI sidekick
//
// Env (secrets):
//   GITHUB_TOKEN      — fine-grained PAT, Contents R/W on BOTH repos above
//   ANTHROPIC_API_KEY — for the Claude chat panel
//
// Cloudflare Access enforces identity in front of the Worker.

const MANUSCRIPT_REPO = 'peterlehfeldt/TheBrokenPilot';
const MANUSCRIPT_BRANCH = 'main';

// Editable documents in the manuscript repo. The frontend addresses these by
// the keys below; the path is what GitHub sees.
const DOCS = {
  manuscript: { repo: MANUSCRIPT_REPO, branch: MANUSCRIPT_BRANCH, path: 'The Broken Pilot.md' },
  scenelist:  { repo: MANUSCRIPT_REPO, branch: MANUSCRIPT_BRANCH, path: 'Broken Pilot Scene List.md' },
};

const CONFIG_REPO = 'peterlehfeldt/write-config';
const CONFIG_BRANCH = 'main';

const ANTHROPIC_MODEL = 'claude-sonnet-4-6';
const ANTHROPIC_MAX_TOKENS = 4096;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;

    try {
      const fileMatch = p.match(/^\/api\/file\/([^/]+)$/);
      if (fileMatch) {
        const name = decodeURIComponent(fileMatch[1]);
        if (!DOCS[name]) return json({ error: `unknown document: ${name}` }, 404);
        if (req.method === 'GET') return getDoc(env, name);
        if (req.method === 'PUT') return putDoc(req, env, name);
        return methodNotAllowed();
      }

      if (p === '/api/skills' && req.method === 'GET') return listSkills(env);
      const skillMatch = p.match(/^\/api\/skills\/([^/]+)$/);
      if (skillMatch && req.method === 'GET') return getSkill(env, decodeURIComponent(skillMatch[1]));

      if (p === '/api/sessions' && req.method === 'GET') return listSessions(env);
      const sessionMatch = p.match(/^\/api\/sessions\/([^/]+)$/);
      if (sessionMatch) {
        const id = decodeURIComponent(sessionMatch[1]);
        if (req.method === 'GET') return getSession(env, id);
        if (req.method === 'PUT') return putSession(req, env, id);
        if (req.method === 'DELETE') return deleteSession(env, id);
        return methodNotAllowed();
      }

      if (p === '/api/chat' && req.method === 'POST') return chat(req, env);

      return env.ASSETS.fetch(req);
    } catch (e) {
      return json({ error: e.message || String(e) }, 500);
    }
  },
};

// ---------- github helpers ----------

function ghHeaders(env) {
  return {
    'authorization': `Bearer ${env.GITHUB_TOKEN}`,
    'accept': 'application/vnd.github+json',
    'user-agent': 'write.pixelcra.sh',
    'x-github-api-version': '2022-11-28',
  };
}

function b64encode(s) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(s)));
}
function b64decode(s) {
  return new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, '')), c => c.charCodeAt(0)));
}

async function ghGetFile(env, repo, branch, path) {
  const r = await fetch(
    `https://api.github.com/repos/${repo}/contents/${encodeURI(path)}?ref=${branch}`,
    { headers: ghHeaders(env), cf: { cacheTtl: 0, cacheEverything: false } },
  );
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`github GET ${path}: ${r.status} ${await r.text()}`);
  const j = await r.json();
  return { sha: j.sha, content: b64decode(j.content) };
}

async function ghListDir(env, repo, branch, path) {
  const r = await fetch(
    `https://api.github.com/repos/${repo}/contents/${encodeURI(path)}?ref=${branch}`,
    { headers: ghHeaders(env), cf: { cacheTtl: 0, cacheEverything: false } },
  );
  if (r.status === 404) return [];
  if (!r.ok) throw new Error(`github LIST ${path}: ${r.status} ${await r.text()}`);
  const j = await r.json();
  return Array.isArray(j) ? j : [];
}

async function ghPutFile(env, repo, branch, path, content, sha, message) {
  const r = await fetch(
    `https://api.github.com/repos/${repo}/contents/${encodeURI(path)}`,
    {
      method: 'PUT',
      headers: { ...ghHeaders(env), 'content-type': 'application/json' },
      body: JSON.stringify({
        message: message || `write.pixelcra.sh @ ${new Date().toISOString()}`,
        content: b64encode(content),
        sha: sha || undefined,
        branch,
      }),
    },
  );
  if (!r.ok) throw new Error(`github PUT ${path}: ${r.status} ${await r.text()}`);
  return await r.json();
}

async function ghDeleteFile(env, repo, branch, path, sha, message) {
  const r = await fetch(
    `https://api.github.com/repos/${repo}/contents/${encodeURI(path)}`,
    {
      method: 'DELETE',
      headers: { ...ghHeaders(env), 'content-type': 'application/json' },
      body: JSON.stringify({
        message: message || `write.pixelcra.sh delete @ ${new Date().toISOString()}`,
        sha,
        branch,
      }),
    },
  );
  if (!r.ok) throw new Error(`github DELETE ${path}: ${r.status} ${await r.text()}`);
  return await r.json();
}

// ---------- editable documents ----------

async function getDoc(env, name) {
  const d = DOCS[name];
  const f = await ghGetFile(env, d.repo, d.branch, d.path);
  if (!f) return json({ error: `${name} not found` }, 404);
  return json({ name, sha: f.sha, content: f.content });
}

async function putDoc(req, env, name) {
  const d = DOCS[name];
  const { sha, content, message } = await req.json();
  if (typeof content !== 'string') return json({ error: 'content required' }, 400);
  const j = await ghPutFile(env, d.repo, d.branch, d.path, content, sha, message);
  return json({ name, sha: j.content.sha, commit: j.commit.sha });
}

// ---------- skills ----------

async function listSkills(env) {
  const entries = await ghListDir(env, CONFIG_REPO, CONFIG_BRANCH, 'skills');
  const skills = entries
    .filter(e => e.type === 'file' && e.name.endsWith('.md'))
    .map(e => ({ name: e.name.replace(/\.md$/, ''), file: e.name }));
  return json({ skills });
}

async function getSkill(env, name) {
  const file = name.endsWith('.md') ? name : `${name}.md`;
  const f = await ghGetFile(env, CONFIG_REPO, CONFIG_BRANCH, `skills/${file}`);
  if (!f) return json({ error: 'skill not found' }, 404);
  return json({ name: name.replace(/\.md$/, ''), content: f.content });
}

// ---------- sessions ----------

async function listSessions(env) {
  const entries = await ghListDir(env, CONFIG_REPO, CONFIG_BRANCH, 'sessions');
  const sessions = entries
    .filter(e => e.type === 'file' && e.name.endsWith('.json'))
    .map(e => ({ id: e.name.replace(/\.json$/, ''), size: e.size }))
    .sort((a, b) => b.id.localeCompare(a.id));
  return json({ sessions });
}

async function getSession(env, id) {
  const f = await ghGetFile(env, CONFIG_REPO, CONFIG_BRANCH, `sessions/${id}.json`);
  if (!f) return json({ error: 'session not found' }, 404);
  try {
    return json({ id, sha: f.sha, session: JSON.parse(f.content) });
  } catch {
    return json({ error: 'session file is not valid json' }, 500);
  }
}

async function putSession(req, env, id) {
  const body = await req.json();
  const session = body.session || body;
  const existing = await ghGetFile(env, CONFIG_REPO, CONFIG_BRANCH, `sessions/${id}.json`);
  const j = await ghPutFile(
    env, CONFIG_REPO, CONFIG_BRANCH, `sessions/${id}.json`,
    JSON.stringify(session, null, 2),
    existing?.sha,
    `session ${id} @ ${new Date().toISOString()}`,
  );
  return json({ id, sha: j.content.sha });
}

async function deleteSession(env, id) {
  const existing = await ghGetFile(env, CONFIG_REPO, CONFIG_BRANCH, `sessions/${id}.json`);
  if (!existing) return json({ ok: true });
  await ghDeleteFile(env, CONFIG_REPO, CONFIG_BRANCH, `sessions/${id}.json`, existing.sha, `delete session ${id}`);
  return json({ ok: true });
}

// ---------- chat (anthropic proxy) ----------

const PROPOSE_EDITS_TOOL = {
  name: 'propose_edits',
  description:
    'Reply to the author and optionally propose edits to one of the editable documents. ' +
    'Each edit targets either the "manuscript" (the prose) or the "scenelist" (the planning table). ' +
    'Use type "spelling" or "grammar" ONLY for safe, narrow, mechanical corrections — these are auto-applied without review. ' +
    'Use type "prose" for any stylistic, structural, or substantive change — these are queued for the author to accept or reject. ' +
    'To insert NEW text (e.g. scaffolding a new scene, appending a new row to the scene list), use type "insert" with `at` set to either the literal string "end" or an exact substring after which the new text should appear. For "insert" edits, `find` should be the empty string. ' +
    'For non-insert edits, `find` MUST be an exact, unique substring of the document text that was sent.',
  input_schema: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: 'Reply to the author. Brief — they can see the edits separately.',
      },
      edits: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            document: { type: 'string', enum: ['manuscript', 'scenelist'], description: 'Which document the edit targets. Defaults to manuscript if omitted.' },
            type: { type: 'string', enum: ['spelling', 'grammar', 'prose', 'insert'] },
            find: { type: 'string' },
            replace: { type: 'string' },
            at: { type: 'string', description: 'For insert edits only: "end" or an exact substring to insert after.' },
            reason: { type: 'string' },
          },
          required: ['type', 'reason'],
        },
      },
    },
    required: ['message', 'edits'],
  },
};

async function chat(req, env) {
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'ANTHROPIC_API_KEY not configured' }, 500);

  const { skill, messages, contextText, contextLabel, sceneListText } = await req.json();
  if (!Array.isArray(messages) || messages.length === 0) {
    return json({ error: 'messages required' }, 400);
  }

  const rawSkill = skill ? await loadSkillBody(env, skill) : '';
  const { meta: skillMeta, body: skillBody } = parseFrontmatter(rawSkill);
  const model = skillMeta.model || ANTHROPIC_MODEL;

  const systemBlocks = [
    {
      type: 'text',
      text:
        'You are an editorial sidekick for a novelist working in the pixelcra.sh "write" app. ' +
        'Two documents are editable: the manuscript (prose) and the scenelist (planning table with status flags). ' +
        'You always reply by calling the `propose_edits` tool; tag each edit with the `document` it targets ("manuscript" or "scenelist"). ' +
        'Keep `message` short — the author values terse, direct feedback. ' +
        'When the author asks a question that does not call for edits, return an empty `edits` array.',
    },
  ];
  if (skillBody) {
    systemBlocks.push({
      type: 'text',
      text: `--- active skill: ${skill} ---\n\n${skillBody}`,
      cache_control: { type: 'ephemeral' },
    });
  }
  if (typeof sceneListText === 'string' && sceneListText.length > 0) {
    systemBlocks.push({
      type: 'text',
      text: `--- scenelist (full) ---\n\n${sceneListText}`,
      cache_control: { type: 'ephemeral' },
    });
  }
  if (typeof contextText === 'string' && contextText.length > 0) {
    systemBlocks.push({
      type: 'text',
      text: `--- manuscript context${contextLabel ? ` (${contextLabel})` : ''} ---\n\n${contextText}`,
      cache_control: { type: 'ephemeral' },
    });
  }

  const apiMessages = messages.map(m => ({
    role: m.role,
    content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
  }));

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: ANTHROPIC_MAX_TOKENS,
      system: systemBlocks,
      tools: [PROPOSE_EDITS_TOOL],
      tool_choice: { type: 'tool', name: 'propose_edits' },
      messages: apiMessages,
    }),
  });

  if (!r.ok) {
    const errText = await r.text();
    return json({ error: `anthropic ${r.status}: ${errText}` }, r.status);
  }

  const data = await r.json();
  const toolBlock = (data.content || []).find(b => b.type === 'tool_use' && b.name === 'propose_edits');
  if (!toolBlock) {
    return json({ error: 'model did not return propose_edits tool call', raw: data }, 502);
  }

  // Normalize edits: default `document` to "manuscript", default `find` to "" for inserts.
  const rawEdits = Array.isArray(toolBlock.input.edits) ? toolBlock.input.edits : [];
  const edits = rawEdits.map(e => ({
    document: e.document === 'scenelist' ? 'scenelist' : 'manuscript',
    type: e.type,
    find: typeof e.find === 'string' ? e.find : '',
    replace: typeof e.replace === 'string' ? e.replace : '',
    at: typeof e.at === 'string' ? e.at : undefined,
    reason: e.reason || '',
  }));

  return json({
    message: toolBlock.input.message || '',
    edits,
    usage: data.usage,
    model: data.model,
  });
}

async function loadSkillBody(env, name) {
  try {
    const file = name.endsWith('.md') ? name : `${name}.md`;
    const f = await ghGetFile(env, CONFIG_REPO, CONFIG_BRANCH, `skills/${file}`);
    return f ? f.content : '';
  } catch {
    return '';
  }
}

// Minimal YAML-ish frontmatter parser: handles `key: value` pairs between two `---` fences.
// Returns the raw body (without frontmatter) if a fence is found; otherwise the whole string.
function parseFrontmatter(text) {
  if (!text) return { meta: {}, body: '' };
  const m = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n([\s\S]*)$/);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*?)\s*$/);
    if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, '');
  }
  return { meta, body: m[2] };
}

// ---------- misc ----------

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function methodNotAllowed() {
  return new Response('method not allowed', { status: 405 });
}
