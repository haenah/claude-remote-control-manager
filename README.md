# rc manager

A self-hosted control panel for [Claude Code Remote Control](https://docs.anthropic.com/en/docs/claude-code)
sessions, behind Face ID / Touch ID. Run it on an always-on box (a Raspberry Pi),
open it from your phone, start a session in any project, and attach to it from
the Claude app.

Inspired by [rcpilot](https://github.com/kjozsa/rcpilot), minus git, PR review,
schedulers, self-update and project import — plus passkey sign-in, so it can sit
on the public internet.

## What it does

- **Start sessions** — `claude --remote-control` in any project, several per
  folder, each with a claude.ai link to attach from the app or browser.
- **See everything running** — every Remote Control session and bridge on the
  machine, including ones started from a terminal, with Claude's own titles and
  (for bridges) each conversation's idle/busy status.
- **Stop and resume** — stop a session; continue any past conversation in a
  project (from its transcript) as a new Remote Control session.
- **Remote hosts** — the same for projects on other machines, over ssh.
- **YOLO / permission mode** — per-start `bypassPermissions`, or a default mode.
- **Passkeys** — sign-in is one Face ID / Touch ID prompt. No passwords.

### Where the data comes from

rcm stores nothing about sessions. It reads what Claude Code already keeps,
every time, so there is no second copy to drift:

| What | Source |
| --- | --- |
| running sessions | the process table (`claude --remote-control …`, `claude remote-control …`) |
| claude.ai link | the `script` log of sessions rcm started; `bridge-pointer.json` for bridges |
| bridge conversations, status | `~/.claude/sessions/<pid>.json` |
| titles, history, resume | transcripts in `~/.claude/projects/<cwd>/*.jsonl` |

The SQLite database holds only sign-in state: passkeys, logins, invite codes.

## Setup (Raspberry Pi)

Requirements: [Bun](https://bun.sh), `claude` on the PATH and logged in, and a
domain pointing at the Pi with HTTPS in front (passkeys require a secure origin).

```bash
git clone <this repo> ~/Developer/haenah/claude-remote-control-manager
cd ~/Developer/haenah/claude-remote-control-manager
bun install
bun run build

cp deploy/rcm.service ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now rcm
loginctl enable-linger $USER
```

rcm listens on `127.0.0.1:8742`. Put a TLS proxy in front — `deploy/Caddyfile`
for Caddy, or a Cloudflare Tunnel to `http://localhost:8742`. The proxy must pass
the `Origin` header through unchanged.

### First passkey

With no passkey registered, rcm prints a one-time **setup code** to its log
(`journalctl --user -u rcm`) and to `~/.config/rcm/setup-token`. Open the site,
enter the code, and create the passkey with Face ID / Touch ID.

More devices: passkeys in iCloud Keychain sync across your Apple devices already.
For anything else, mint a code in **Settings → Security → Invite a device** and
enter it on the new device under **Set up a new device**.

Locked out? On the Pi:

```bash
bun run cli invite           # one-time code (30 min) to add a passkey
bun run cli passkeys         # list registered passkeys
bun run cli reset-passkeys   # forget all passkeys and logins; prints a setup code
```

## Configuration

`~/.config/rcm/config.json` (or `$RCM_CONFIG`), created on first run. Project
directories, permission mode and remote hosts are also editable in Settings.

```jsonc
{
  "projectsDirs": ["/home/Developer"], // recursively scan existing directories
  "host": "127.0.0.1",
  "port": 8742,
  "dataDir": "~/.config/rcm",          // sign-in db and session logs
  "permissionMode": "auto",            // default, auto, acceptEdits, dontAsk, plan, bypassPermissions
  "hosts": [
    // { "name": "desktop", "ssh": "me@desktop", "projectsDirs": ["/home/Developer"] }
  ],
  "auth": {
    "rpName": "rc manager",
    // Pages the UI may be served from. The passkey is bound to the hostname.
    "origins": ["https://claude.haenah.com", "http://localhost:8742", "http://localhost:5743"],
    "sessionDays": 30
  }
}
```

The default root is `/home/Developer`. Existing configs that still use the old
`~/projects`, `/home/haenah/projects` or `/home/Developers` default are migrated on startup; custom
roots are kept. Local and remote scans discover nested directories, skip hidden
folders, `node_modules` and `__pycache__`, and do not follow symlinks. Scans are
cached for up to 15 seconds. The **folders** view shows the directory hierarchy;
expanding a folder loads its file names. Use its arrow to view history and start
options, or its lightning button to start a session directly. Search matches
full paths and keeps parent folders visible. **recent** and **a–z** retain the
flat list views.

### Remote hosts

Each needs key-based ssh from the Pi (`ssh-copy-id me@desktop`), `claude` on its
login-shell PATH and logged in, `systemd`, and `loginctl enable-linger $USER` so
sessions outlive the ssh connection. rcm checks the connection before saving a
host. An unreachable host's projects drop out of the list until it is back; its
sessions are never stopped because of it.

## Security

- Every API call except sign-in requires a login; logins are random 256-bit
  tokens (stored hashed) in an `HttpOnly; SameSite=Strict` cookie, `Secure` over HTTPS.
- State-changing requests must carry an allowed `Origin` (CSRF).
- Passkeys are discoverable and require user verification (biometrics).
  Registering one needs a login or a one-time code; failed attempts are throttled.
- Stopping a session only touches a pid that is a Claude Remote Control process.
- Strict CSP; no third-party resources.

## Development

```bash
bun install
bun run dev        # server on :8742 (watch) + Vite on :5743, proxying /api
bun run test       # server tests
bun run typecheck
```

Open http://localhost:5743. The dev server reads your real `~/.config/rcm`
unless `RCM_CONFIG` points elsewhere. On macOS, `localhost` is a secure context,
so Touch ID works for local testing.

Stack: Bun + Hono, `bun:sqlite`, `@simplewebauthn`; React + Vite + Tailwind with
[Animate UI](https://animate-ui.com) components, TanStack Query.
