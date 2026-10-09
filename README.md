# rc manager

A self-hosted control panel for Claude Code and Codex remote sessions, behind
Face ID / Touch ID. Run it on an always-on box, browse your existing directories,
and choose the Anthropic or ChatGPT logo to start the engine you want.

Inspired by [rcpilot](https://github.com/kjozsa/rcpilot), minus git, PR review,
schedulers, self-update and project import — plus passkey sign-in, so it can sit
on the public internet.

## What it does

- **Choose an engine** — Anthropic and ChatGPT logo buttons start Claude or
  Codex in the same directory. Project details offer the same choice for history
  and resume.
- **See running work** — Claude processes and bridges, and loaded Codex
  conversations, including sessions opened outside this manager.
- **Connect** — Claude returns a claude.ai session link. Codex creates a named
  conversation on the host's native Remote Control daemon; open it under that
  host in ChatGPT's Codex / Remote screen. If needed, generate a short-lived
  pairing code from the session panel to connect your device.
- **Stop and resume** — Claude sessions stop while retaining their transcripts.
  Codex work is interrupted and its conversation archived; archived conversations
  remain in project history and can be resumed. Stopping a conversation never
  stops the shared Codex daemon or another conversation.
- **Remote hosts** — the same for projects on other machines, over ssh.
- **YOLO / permission mode** — per-start `bypassPermissions`, or a default mode.
- **Passkeys** — sign-in is one Face ID / Touch ID prompt. No passwords.

### Where the data comes from

Session state comes from each engine, rather than a second session database:

| What | Source |
| --- | --- |
| running sessions | the process table (`claude --remote-control …`, `claude remote-control …`) |
| claude.ai link | the `script` log of sessions rcm started; `bridge-pointer.json` for bridges |
| bridge conversations, status | `~/.claude/sessions/<pid>.json` |
| Claude titles, history, resume | transcripts in `~/.claude/projects/<cwd>/*.jsonl` |
| Codex sessions and history | native app-server JSON-RPC through `codex app-server proxy` |

The SQLite database holds sign-in state (passkeys, logins, invite codes) and the
last successful session start per directory for the **recent** list.

## Setup (Raspberry Pi)

Requirements: [Bun](https://bun.sh), the CLI for each engine you want to use on
the host’s login-shell PATH and signed in, and HTTPS in front of this manager
(passkeys require a secure origin). One unavailable engine does not prevent
using the other. Codex requires a current CLI with `remote-control` and
`app-server proxy` support.

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
  "projectsDirs": ["~/Developer"], // recursively scan existing directories
  "host": "127.0.0.1",
  "port": 8742,
  "dataDir": "~/.config/rcm",          // sign-in db and session logs
  "permissionMode": "auto",            // default, auto, acceptEdits, dontAsk, plan, bypassPermissions
  "hosts": [
    // { "name": "desktop", "ssh": "me@desktop", "projectsDirs": ["~/Developer"] }
  ],
  "auth": {
    "rpName": "rc manager",
    // Pages the UI may be served from. The passkey is bound to the hostname.
    "origins": ["https://claude.haenah.com", "http://localhost:8742", "http://localhost:5743"],
    "sessionDays": 30
  }
}
```

The default root is `~/Developer` (for example, `/home/haenah/Developer` on the Pi).
Existing configs that still use the old `~/projects`, `/home/haenah/projects`,
`/home/Developers` or `/home/Developer` default are migrated on startup; custom
roots are kept. Local and remote scans discover nested directories, skip hidden
folders, `node_modules` and `__pycache__`, and do not follow symlinks. Scans are
cached for up to 15 seconds. The **folders** view shows the directory hierarchy;
expanding a folder loads its file names. Use its arrow to view history and start
options, or its Anthropic / ChatGPT logo buttons to start a session directly. Search matches
full paths and keeps parent folders visible. **recent** lists only directories
where a session was successfully started or resumed, newest first, with one
entry per directory. Browsing folders never adds a recent entry. Recent starts
are stored on the server so they survive restarts and appear on every device;
currently running sessions are also included.

### Remote hosts

Each needs key-based ssh from the Pi (`ssh-copy-id me@desktop`), the selected
engine’s CLI on its login-shell PATH and signed in. Claude hosts need `systemd`
and `loginctl enable-linger $USER` so
sessions outlive the ssh connection. rcm checks the connection before saving a
host. An unreachable host's projects drop out of the list until it is back; its
sessions are never stopped because of it.

## Security

- Every API call except sign-in requires a login; logins are random 256-bit
  tokens (stored hashed) in an `HttpOnly; SameSite=Strict` cookie, `Secure` over HTTPS.
- State-changing requests must carry an allowed `Origin` (CSRF).
- Passkeys are discoverable and require user verification (biometrics).
  Registering one needs a login or a one-time code; failed attempts are throttled.
- Each engine validates its native session identity before stopping it.
- Codex transport uses WebSocket frames over a local control socket, or a byte proxy over SSH; no app-server
  listener is exposed to the internet. Pairing codes are returned only to the
  signed-in requester and are never saved in the application database.
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

## Session architecture

`shared/sessions.ts` defines the serializable provider, session, history, launch,
and connection contracts used by both the server and web app.

- `server/src/sessions.ts` is the provider-neutral service: it dispatches through
  the registry, validates resume requests, isolates failures and records successful
  launches for the directory recents list.
- `server/src/providers/types.ts` defines the adapter interface: status, launch,
  list, history, stop and optional device pairing.
- `server/src/providers/claude/` owns Claude process control, PTY logs, transcripts
  and conversion into the shared session model.
- `server/src/providers/codex/` owns daemon lifecycle, JSON-RPC transports, native threads,
  permission mapping and device pairing. A temporary query server can read saved
  history when the daemon is not running; browsing never creates a conversation.
- `web/src/components/session-controls.tsx` supplies the common provider picker,
  launch actions, results and connection UI used in every project view.

The API requires an explicit provider when starting or resuming:
`POST /api/projects/:key/sessions`, `POST /api/projects/:key/resume`.
History is queried with `GET /api/projects/:key/history?provider=claude|codex`.
Both engines use `DELETE /api/providers/:provider/sessions/:id?host=...`.
CLI availability is read through `GET /api/providers?host=...`; device pairing
uses `POST /api/providers/:provider/pair`.

### Codex setup

On each Codex host, install a current CLI, sign in and verify support:

```bash
codex --version
codex remote-control --help
codex app-server proxy --help
codex login --device-auth
```

The manager enables native Remote only when you explicitly start or resume a
Codex session. It creates a named conversation without sending a prompt or
starting a model turn. Continue the conversation in ChatGPT. Existing remote
pairings can be reused; generate a manual code only when a device needs to be
connected.

Codex connection and command details are documented in the official
[CLI reference](https://learn.chatgpt.com/docs/cli/reference),
[App Server guide](https://learn.chatgpt.com/docs/app-server) and
[remote connection guide](https://learn.chatgpt.com/docs/remote-connections).

The logo SVGs are distributed by [Simple Icons](https://simpleicons.org/).

### Raspberry Pi and authentication

The implementation uses portable CLI commands and Unix sockets, without macOS
APIs. Linux CLI support and headless device authentication are documented by
OpenAI, but this repository has not yet been verified on a Raspberry Pi. Check
that a current CLI runs on your Pi's OS and architecture before enabling Remote.

```bash
uname -m
codex --version
codex login --device-auth
codex remote-control start --json
codex remote-control pair
```

OpenAI can reject Remote server enrollment with `Multi-factor authentication
required`. Complete MFA in ChatGPT and sign in again with the CLI on that host.
The manager surfaces this requirement before creating a conversation.

An already running Codex daemon is connected through its control socket. The
manager enables Remote through JSON-RPC, without restarting that daemon. CLI
startup is used only when the daemon is not running. The daemon socket uses
WebSocket framing; a temporary standalone history reader uses JSONL. Device
pairing also uses the existing connection and never restarts the host.
