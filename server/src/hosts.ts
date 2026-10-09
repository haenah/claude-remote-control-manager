/**
 * Run commands locally or on a configured remote host over ssh.
 *
 * A project is addressed by a *key*:
 *     "myrepo"            → project 'myrepo' on this machine
 *     "stardust:myrepo"   → project 'myrepo' on the host named 'stardust'
 *
 * Remote execution notes:
 *  - ssh connections are multiplexed (ControlMaster), so the many short calls
 *    the UI triggers cost ~10ms each instead of a full handshake.
 *  - Scripts are piped to `bash -ls` on stdin instead of passed as an argument,
 *    which removes a whole layer of quoting. A login shell is used so `claude`
 *    in ~/.local/bin resolves.
 *  - Login shells print MOTDs and profile noise, so every script emits an RS
 *    (0x1e) marker before its real output and callers keep only what follows.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RemoteHost } from "./config";
import { config } from "./config";

export const KEY_SEP = ":";
const MARKER = "\x1e";
const CONTROL_DIR = join(homedir(), ".cache", "rcm", "ssh");

export class HostUnreachable extends Error {}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

// ---------------------------------------------------------------------------
// Project keys
// ---------------------------------------------------------------------------

export function splitKey(key: string): [host: string, name: string] {
  const i = key.indexOf(KEY_SEP);
  return i === -1 ? ["", key] : [key.slice(0, i), key.slice(i + 1)];
}

export function makeKey(host: string, name: string): string {
  return host ? `${host}${KEY_SEP}${name}` : name;
}

export function findHost(name: string): RemoteHost | undefined {
  return config.hosts.find((h) => h.name === name);
}

// ---------------------------------------------------------------------------
// Shell quoting
// ---------------------------------------------------------------------------

/** POSIX single-quote *s* (same rules as Python's shlex.quote). */
export function shQuote(s: string): string {
  if (s === "") return "''";
  if (/^[\w@%+=:,./-]+$/.test(s)) return s;
  return `'${s.replaceAll("'", `'"'"'`)}'`;
}

/**
 * Quote a path for a shell while keeping a leading `~` expandable.
 * `shQuote('~/projects')` would make bash look for a directory literally named '~'.
 */
export function shPath(p: string): string {
  if (p === "~") return "~";
  if (p.startsWith("~/")) return `~/${shQuote(p.slice(2))}`;
  return shQuote(p);
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

/** The server's env with ~/.local/bin on PATH — systemd hands services a stripped PATH. */
export function localEnv(): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;
  const localBin = join(homedir(), ".local", "bin");
  const parts = (env.PATH ?? "").split(":").filter(Boolean);
  if (!parts.includes(localBin)) env.PATH = [localBin, ...parts].join(":");
  return env;
}

function sshArgv(host: RemoteHost): string[] {
  mkdirSync(CONTROL_DIR, { recursive: true });
  return [
    "ssh",
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=5",
    "-o", "ServerAliveInterval=10",
    "-o", "ControlMaster=auto",
    "-o", "ControlPersist=300",
    "-o", `ControlPath=${CONTROL_DIR}/cm-%C`,
    host.ssh,
    "bash", "-ls",
  ];
}

/**
 * Run a bash *script* on *host* (locally when host is null). Login-shell noise
 * is stripped from stdout. Throws HostUnreachable on ssh failure or timeout.
 */
export async function runScript(
  host: RemoteHost | null,
  script: string,
  timeoutMs = 20_000,
): Promise<RunResult> {
  const body = `printf '${MARKER}'\n${script}`;
  const argv = host ? sshArgv(host) : ["bash", "-lc", body];
  const proc = Bun.spawn(argv, {
    stdin: host ? new TextEncoder().encode(body) : "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: localEnv(),
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGKILL");
  }, timeoutMs);
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);
  const where = host ? `${host.name} (${host.ssh})` : "local";
  if (timedOut) throw new HostUnreachable(`timed out after ${timeoutMs / 1000}s running script on ${where}`);
  if (host && code === 255) throw new HostUnreachable(`ssh to ${where} failed: ${stderr.trim()}`);
  const i = stdout.indexOf(MARKER);
  return { code, stdout: i === -1 ? stdout : stdout.slice(i + 1), stderr };
}

/** Probe *host*. Resolves to an error message, or null when it answered. */
export async function checkOnline(host: RemoteHost): Promise<string | null> {
  try {
    const res = await runScript(host, "printf ok\n", 10_000);
    if (res.code !== 0) return res.stderr.trim() || `exit ${res.code}`;
    return res.stdout.includes("ok") ? null : "no response";
  } catch (e) {
    return (e as Error).message;
  }
}

// ---------------------------------------------------------------------------
// Claude's folder trust prompt
// ---------------------------------------------------------------------------

const TRUST_PY = `import json, os, sys
path = os.path.expanduser('~/.claude.json')
try:
    data = json.load(open(path))
except Exception:
    data = {}
entry = data.setdefault('projects', {}).setdefault(sys.argv[1], {})
if not entry.get('hasTrustDialogAccepted'):
    entry['hasTrustDialogAccepted'] = True
    tmp = path + '.rcm-tmp'
    with open(tmp, 'w') as fh:
        json.dump(data, fh, indent=2)
    os.replace(tmp, path)
`;

/**
 * Mark *projectPath* trusted in the host's ~/.claude.json. Otherwise a
 * remote-control session blocks on a "Do you trust this folder?" prompt that
 * nobody is there to answer.
 */
export async function acceptClaudeTrust(host: RemoteHost | null, projectPath: string): Promise<void> {
  if (host) {
    try {
      const res = await runScript(
        host,
        `python3 - ${shPath(projectPath)} <<'RCM_PY'\n${TRUST_PY}RCM_PY\n`,
        15_000,
      );
      if (res.code !== 0) console.warn(`trust for ${projectPath} on ${host.name}: ${res.stderr.trim()}`);
    } catch (e) {
      console.warn(`trust on ${host.name}: ${(e as Error).message}`);
    }
    return;
  }
  const file = join(homedir(), ".claude.json");
  let data: { projects?: Record<string, Record<string, unknown>> } = {};
  try {
    if (existsSync(file)) data = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    // An unreadable file is rewritten below rather than left blocking sessions.
  }
  const key = realpathSync(projectPath);
  const entry = ((data.projects ??= {})[key] ??= {});
  if (entry.hasTrustDialogAccepted) return;
  entry.hasTrustDialogAccepted = true;
  try {
    const tmp = `${file}.rcm-tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, file);
  } catch (e) {
    console.warn(`could not write trust entry to ~/.claude.json: ${(e as Error).message}`);
  }
}
