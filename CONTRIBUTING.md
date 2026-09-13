# Contributing

Thanks for looking. This is a young project — a pull request that fixes one real thing is worth more
than a large refactor of code you have not run.

## Get it running

```bash
git clone https://github.com/arelchan/steadbot.git && cd steadbot
bash steadbot install && steadbot
```

Node.js 22+. Without a model key it runs in fake mode, which is enough to exercise most of the UI and
the whole message → matter → decision → done loop.

Two packages, developed independently:

```bash
cd crew-server && npm install --ignore-scripts && npm run dev   # ws://localhost:5200/ws
cd bot-crew    && npm install && npm run dev:live               # App against that server
```

## What CI checks

Both packages must pass before a merge. Run them locally first:

```bash
cd crew-server && npm run typecheck && npx --yes tsx@4.23.13 --test 'src/__tests__/*.test.ts'
cd bot-crew    && npx tsc -b && npx oxlint && npm run build
```

Two things that surprise people:

- In `bot-crew`, `tsc --noEmit` is a **no-op** — the root tsconfig is a solution file with `files: []`.
  The real check is `tsc -b`.
- Lint is a **ratchet**, not zero-tolerance. The number in `.github/workflows/ci.yml` is the current
  warning count; it may go down, never up. Most of what is left is `exhaustive-deps` — React behaviour
  that has to be judged one site at a time, not cleared mechanically.

## Conventions worth knowing

- **English is the source language.** `bot-crew/src/i18n/locales/en.ts` holds every UI string and its
  keys are the type; other catalogues are partial and fall back to it. Never put a user-visible string
  in a component.
- **The UI does not explain itself.** No "you can…" helper text, no persuasion, two or three words in an
  empty state. If a screen needs a paragraph to be usable, the design is not finished.
- **Comments say why, not what.** The repository is full of comments explaining the decision behind a
  line, including the ones we got wrong first. Keep that.
- **Never commit credentials.** Keys belong in `~/.crew/config.json` (mode 600) on the machine running
  the bots. There is a redaction layer (`crew-server/src/secrets.ts`) — do not route around it.
- **Do not vendor a skill whose upstream licence forbids redistribution.** `npm run library:sync` keeps
  each skill's upstream licence and a `.source.json`; if a licence reserves all rights, the skill stays
  out of this repository (see `THIRD_PARTY_NOTICES.md`).

Commit messages: one line saying what changed and, where it is not obvious, why. English or Chinese
both fine.

## Adding a skill to the pool

Skills are not code. Add an entry to `crew-server/library/manifest.json` with the upstream repository,
the path inside it, a one-line description and search tags, then run `npm run library:sync`. The sync
copies the directory verbatim, along with the upstream licence.

## Reporting things

- Bugs and feature requests: [issues](https://github.com/arelchan/steadbot/issues).
- Security: [SECURITY.md](SECURITY.md) — please do not open a public issue.
