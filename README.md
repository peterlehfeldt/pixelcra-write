# pixelcra-write

`write.pixelcra.sh` — edit the broken pilot, sync to github, with an
optional Claude sidekick panel.

## Repos

- **manuscript** — `peterlehfeldt/TheBrokenPilot`, file `The Broken Pilot.md`
- **config**     — `peterlehfeldt/write-config`
  - `skills/*.md`    — editorial skills (system prompts) the panel can use
  - `sessions/*.json` — chat transcripts, one file per session

## Secrets (Worker)

- `GITHUB_TOKEN` — fine-grained PAT, Contents R/W on **both** repos above
- `ANTHROPIC_API_KEY` — for the chat panel

Set with:
```
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put ANTHROPIC_API_KEY
```

## Deploy

```
CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… npx wrangler deploy
```

## API

| route                          | method | purpose                                    |
| ------------------------------ | ------ | ------------------------------------------ |
| `/api/file`                    | GET    | load manuscript                            |
| `/api/file`                    | PUT    | save manuscript (optimistic via sha)       |
| `/api/skills`                  | GET    | list available skills                      |
| `/api/skills/:name`            | GET    | get skill body (markdown)                  |
| `/api/sessions`                | GET    | list session ids, newest first             |
| `/api/sessions/:id`            | GET    | load session                               |
| `/api/sessions/:id`            | PUT    | upsert session (debounced from client)     |
| `/api/sessions/:id`            | DELETE | remove session                             |
| `/api/chat`                    | POST   | proxy to Anthropic, returns structured edits |

Cloudflare Access enforces identity in front of the Worker; the PAT is the
GitHub identity used for commits.
