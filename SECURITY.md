# Security

## Reporting a vulnerability

Please do not open a public issue. Use GitHub's
[private vulnerability reporting](https://github.com/arelchan/steadbot/security/advisories/new), or email
**security@evermind.ai**. Include what you did, what happened, and what an attacker could do with it.
We will acknowledge within a few working days.

This is a pre-1.0 project maintained by a small team; there is no bounty programme.

## What Steadbot assumes about your environment

Worth knowing before you put it on the public internet:

- **The server is the trust boundary, and its token is the whole key.** A pairing code (`url` + token)
  grants full access to the bots, their files and their desktop. Treat it like a password. Deploy with a
  domain so it travels over HTTPS — `deploy/install.sh` will set up Caddy for you.
- **Credentials never reach the model.** Model keys, IM secrets and connector tokens live in
  `~/.crew/config.json` (mode 600) and are read only by the server. Known secrets are replaced with `••••`
  in anything the model emits. The `harvest` tool exists so a bot can capture a credential off a web page
  without the value passing through it.
- **The bots share one browser and one set of logins.** Anything one bot logs into, every bot on that
  machine can use. That is the point of a shared computer, but it means you should not put an account in
  there you would not give the whole team.
- **Agents execute code and use a real browser.** A bot can run shell commands and drive a desktop on its
  machine. Run it on a machine you are willing to hand over, not next to production secrets.
- **Actions with side effects go through one door.** Paying, ordering, sending messages and changing other
  people's calendars all route through `act`, gated by the bot's autonomy setting. A bot is not allowed to
  claim it did something without going through it.
- **Prompt injection is a live risk.** A bot reading a hostile web page or email can be told to do things.
  The autonomy gate and the confirmation cards are the mitigation; do not set every bot to "just do it"
  and then point it at untrusted input.

## Supported versions

Only `main`. Upgrade is a `git pull` and a restart, or the upgrade button in the App.
