# Working in this repository

Orientation for coding agents (and humans who like a map). Product docs are in
[README.md](README.md); why the product is shaped this way is in [docs/design.md](docs/design.md); how the code is
laid out is in [docs/architecture.md](docs/architecture.md).

## Layout

| Path | What |
| --- | --- |
| `crew-server/src/` | the runtime. `index.ts` (HTTP + ws), `bots.ts` (a turn), `router.ts`, `channels.ts` + `bridges/` (IM), `desktop.ts` (shared browser), `everos.ts` (memory), `library.ts` (skill pool), `models.ts`, `upgrade.ts` |
| `crew-server/src/extensions/` | pi extensions — the tools a bot actually has: `todo`, `ask`, `act`, `build`, `operate`, `see`, `harvest`, `library`, `remember`, `connect` |
| `crew-server/src/shared/` | types shared with the App. The App imports from here; there is exactly one definition of each protocol message |
| `crew-server/library/` | 227 skills copied verbatim from upstream repos. Not our code — never edit a file in here; change `manifest.json` and run `npm run library:sync` |
| `bot-crew/src/` | the App. React 19, no UI library, one `styles.css` |
| `bot-crew/src/i18n/locales/` | all UI copy. `en.ts` is the source and its keys are the type |
| `crew-server/deploy/` | Docker compose, Caddy, and the install scripts a user runs against their own server |

## Build and check

```bash
cd crew-server && npm run typecheck && npx --yes tsx@4.23.13 --test 'src/__tests__/*.test.ts'
cd bot-crew    && npx tsc -b && npx oxlint && npm run build
```

Four traps, all of which have cost someone an hour:

1. **`npx tsc --noEmit` in `bot-crew` checks nothing.** The root tsconfig is a solution file with
   `files: []`. Use `tsc -b`.
2. **The root `.gitignore` is a whitelist.** `/*` is ignored and individual paths are allowed back in.
   A new file at the repository root will not be committed and `git add` will not complain. Whitelist it,
   then verify with `git check-ignore -v <path>` returning non-zero.
3. **Lint is a ratchet.** `oxlint --max-warnings=N` where N is today's count. Do not add warnings; if you
   clear some, lower N in `.github/workflows/ci.yml`.
4. **This working tree may be shared with another session.** Stage the files you changed by name. Do not
   `git add -A`, and do not run `git reset` with `GIT_INDEX_FILE` still exported.

## Conventions

- **Never write a user-visible string into a component.** It goes in `en.ts` and gets a key; the key is
  typed, so a typo is a compile error.
- **No explanatory helper text in the UI.** Empty states are two or three words. See DESIGN.md §2.5.
- **Comments explain the decision, not the syntax.** Where a previous approach failed, the comment says
  so. That is deliberate — keep it when you touch the code.
- **Secrets never enter the model's context.** `secrets.ts` redacts known credentials from anything
  outbound. Do not add a path around it, and never print `~/.crew/config.json`.
- **Do not vendor anything whose licence forbids redistribution.** See `docs/third-party-notices.md`.

## Running it

`bash steadbot` starts both halves against `~/.crew`. To avoid touching real data, point `CREW_HOME` at a
scratch directory — it will want its own model key, because nothing here is simulated: with no model
configured the bots refuse to take a turn and the App sends you to Settings › Models. Kill test servers
**by port**, never with a broad `pkill`.

## The one-paragraph mental model

Each bot is a long-lived `pi` `AgentSession` with one continuous thread. A user message becomes a turn;
the turn's first act is to open, update or close a **matter**; tools with side effects all funnel through
`act`, which is gated by the bot's autonomy. Bots reach each other by @-mention (hand the whole job over)
or by opening a group (several people, one result), and only a mentioned bot wakes. The whole home —
history, matters, memory, skills, credentials — is a directory that can be packed up and moved to another
machine, which is what "move the bots to a server" means.
