/**
 * Start and stop Remote Control sessions. What is running is never stored —
 * claude-state.ts reads it back from the host each time.
 *
 * A session is an interactive `claude --remote-control <name>` run inside
 * `script`, which owns a PTY independently of this server and logs the
 * terminal (where the claude.ai link appears). rcm picks the conversation id
 * up front (--session-id), so the transcript — title, history, resume — is
 * known from the start. Several can run in one folder, each stopped on its own.
 *
 * Sessions outlive the server: locally on Linux the session goes into its own
 * `systemd-run --user --scope` (else restarting the service's cgroup kills
 * it), and on a remote host into a transient `systemd-run --user` unit, which
 * detaches it from the ssh connection that started it.
 */

import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { join } from "node:path";
import { sessionLogDir, type PermissionMode, type RemoteHost } from "./config";
import { localEnv, runScript, shQuote } from "./hosts";
import { HttpError } from "./http";
import { BRIDGE_ARGS, processTable, terminate } from "./proc";

const SESSION_URL = /https:\/\/claude\.ai\/code\/session_[A-Za-z0-9_-]+/g;
// OSC first: its introducer `ESC ]` would otherwise match the two-byte branch.
const ANSI = /\x1b(?:\][^\x07\x1b]*(?:\x07|\x1b\\)|\[[0-?]*[ -/]*[@-~]|[@-Z\\-_])/g;

/** How long to wait for claude to print the session's claude.ai link. */
const URL_WAIT_MS = 60_000;
const POLL_MS = 300;

export const stripAnsi = (s: string) => s.replace(ANSI, "");

/**
 * The newest session link in raw terminal output. Pass raw text: the link can
 * be an OSC-8 hyperlink target, which stripAnsi removes.
 */
export function extractSessionUrl(raw: string): string | null {
  return raw.match(SESSION_URL)?.at(-1) ?? null;
}

/** Why claude quit before printing a link: its last `Error:` line, if any. */
export function exitReason(log: string): string {
  const errors = [...log.matchAll(/Error:\s*([^\n\r]+)/g)];
  return errors.at(-1)?.[1]?.trim() ?? "claude exited before printing a session link";
}

function readText(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

export interface StartResult {
  status: "running" | "failed";
  url: string | null;
  name: string;
  /** Transcript id of the conversation. */
  conversationId: string;
  error?: string;
}

export interface StartOptions {
  projectPath: string;
  name: string;
  permissionMode: PermissionMode;
  host: RemoteHost | null;
  /** Continue this past conversation instead of starting a new one. */
  resume?: string | null;
}

function claudeCommand(o: StartOptions, conversationId: string): string {
  let cmd = `claude --remote-control=${shQuote(o.name)}`;
  cmd += o.resume ? ` --resume ${conversationId}` : ` --session-id ${conversationId}`;
  if (o.permissionMode !== "default") cmd += ` --permission-mode ${o.permissionMode}`;
  return cmd;
}

/**
 * `script` must not see EOF on stdin: it would pass it to claude as ^D. So it
 * reads a pipe whose writer never writes and leaves once `script` is gone —
 * `script` records its pid in $1 for that. ($2 log, $3 command.) A FIFO would
 * be simpler, but macOS `script` refuses one.
 */
function wrapper(platform: NodeJS.Platform): string {
  const run =
    platform === "darwin"
      ? `script -q -F "$2" /bin/bash -c "$3"` // BSD: -F flushes every write
      : `script -q -e -f -c "$3" "$2"`; // util-linux
  return `while [ ! -s "$1" ] || kill -0 "$(cat "$1")" 2>/dev/null; do sleep 2; done | /bin/sh -c 'echo $$ > "$1"; exec ${run}' sh "$1" "$2" "$3"`;
}

let hasSystemdRun: boolean | undefined;

/**
 * Wait for the session link in the log. Stops early once claude has exited —
 * no link is coming then, and its last error line says why.
 */
async function pollForUrl(logPath: string, exited: () => boolean): Promise<{ url: string | null; error: string | null }> {
  const deadline = Date.now() + URL_WAIT_MS;
  while (Date.now() < deadline) {
    const url = extractSessionUrl(readText(logPath));
    if (url) return { url, error: null };
    if (exited()) {
      // The exit may have raced the final flush; take one last look.
      await Bun.sleep(150);
      const raw = readText(logPath);
      return { url: extractSessionUrl(raw), error: exitReason(stripAnsi(raw)) };
    }
    await Bun.sleep(POLL_MS);
  }
  return { url: null, error: `no session link within ${URL_WAIT_MS / 1000}s` };
}

export async function startSession(o: StartOptions): Promise<StartResult> {
  const conversationId = o.resume ?? randomUUID();
  if (o.host) return startRemote(o, o.host, conversationId);

  mkdirSync(sessionLogDir(), { recursive: true });
  const base = join(sessionLogDir(), `session-${randomBytes(6).toString("hex")}`);
  const logPath = `${base}.log`;
  hasSystemdRun ??= process.platform === "linux" && Bun.which("systemd-run") !== null;
  const argv = [
    // Its own cgroup, outside the service's — restarting rcm must not take it down.
    ...(hasSystemdRun ? ["systemd-run", "--user", "--scope", "--quiet", "--"] : []),
    "/bin/sh", "-c", wrapper(process.platform), "sh", `${base}.pid`, logPath, claudeCommand(o, conversationId),
  ];
  const errFd = openSync(`${base}.err`, "w");
  const child = spawn(argv[0]!, argv.slice(1), {
    cwd: o.projectPath,
    env: localEnv(),
    detached: true,
    stdio: ["ignore", "ignore", errFd],
  });
  closeSync(errFd);
  child.unref();
  let done = false;
  // The wrapper exits only after `script`, i.e. after claude.
  child.on("exit", () => (done = true));
  child.on("error", () => (done = true));
  console.info(`start "${o.name}" in ${o.projectPath} (${conversationId}) log=${logPath}`);

  const { url, error } = await pollForUrl(logPath, () => done);
  if (url) return { status: "running", url, name: o.name, conversationId };

  // Running without a link is a session nobody can attach to.
  if (!done && child.pid) await terminate(child.pid);
  const stderr = readText(`${base}.err`).trim();
  console.warn(`start failed: ${error}${stderr ? ` (${stderr})` : ""}`);
  return { status: "failed", url: null, name: o.name, conversationId, error: error ?? (stderr || "unknown error") };
}

async function startRemote(o: StartOptions, host: RemoteHost, conversationId: string): Promise<StartResult> {
  const token = randomBytes(6).toString("hex");
  const unit = `rcm-session-${token}`;
  const base = `$HOME/.cache/rcm/session-${token}`;
  const ticks = Math.floor(URL_WAIT_MS / POLL_MS);
  // Start in a transient unit and wait for the link — one ssh round trip. The
  // unit is detached from this connection, so a drop mid-wait costs the link,
  // not the session. The login shell's PATH goes along: user units get a bare one.
  const script = `
mkdir -p "$HOME/.cache/rcm"
log="${base}.log"
err=$(systemd-run --user --collect --quiet --unit=${unit} --working-directory=${shQuote(o.projectPath)} \\
  --setenv=PATH="$PATH" /bin/sh -c ${shQuote(wrapper("linux"))} sh "${base}.pid" "$log" ${shQuote(claudeCommand(o, conversationId))} 2>&1)
if [ $? -ne 0 ]; then printf 'RCM_SPAWN_FAILED %s\\n' "$err"; exit 0; fi
i=0
while [ $i -lt ${ticks} ]; do
  grep -qa 'claude\\.ai/code/session_' "$log" 2>/dev/null && break
  systemctl --user is-active --quiet ${unit} || break
  sleep ${POLL_MS / 1000}
  i=$((i+1))
done
systemctl --user is-active --quiet ${unit} || printf 'RCM_EXITED\\n'
head -c 4194304 "$log" 2>/dev/null
`;
  console.info(`start "${o.name}" in ${o.projectPath} on ${host.name} unit=${unit}`);
  let res;
  try {
    res = await runScript(host, script, URL_WAIT_MS + 30_000);
  } catch (e) {
    return { status: "failed", url: null, name: o.name, conversationId, error: (e as Error).message };
  }
  const out = res.stdout;
  if (out.startsWith("RCM_SPAWN_FAILED")) {
    return { status: "failed", url: null, name: o.name, conversationId, error: out.slice(17).trim() };
  }
  const url = extractSessionUrl(out);
  if (url) return { status: "running", url, name: o.name, conversationId };
  const exited = out.startsWith("RCM_EXITED");
  if (!exited) await runScript(host, `systemctl --user stop ${unit} 2>/dev/null\n`).catch(() => {});
  const error = exited ? exitReason(stripAnsi(out)) : `no session link within ${URL_WAIT_MS / 1000}s`;
  return { status: "failed", url: null, name: o.name, conversationId, error };
}

/** Matches an interactive Remote Control session's argv. */
const INTERACTIVE_ARGS = /^(?:\S*\/)?claude\s.*--remote-control(?:[=\s]|$)/;

/**
 * Stop a Remote Control session or bridge by pid. Only a pid that is one right
 * now is touched, so a stale or forged request cannot kill anything else.
 */
export async function stopSession(host: RemoteHost | null, pid: number): Promise<void> {
  if (host) {
    const res = await runScript(
      host,
      `a=$(ps -o args= -p ${pid}) || exit 3
printf '%s' "$a" | grep -qE '(^|/)claude( remote-control| .*--remote-control)' || exit 3
kill -TERM ${pid}
i=0; while kill -0 ${pid} 2>/dev/null && [ $i -lt 50 ]; do sleep 0.2; i=$((i+1)); done
kill -KILL ${pid} 2>/dev/null; exit 0
`,
      25_000,
    );
    if (res.code === 3) throw new HttpError(404, "No such session");
    return;
  }
  const p = (await processTable()).get(pid);
  if (!p || !(BRIDGE_ARGS.test(p.args) || INTERACTIVE_ARGS.test(p.args))) throw new HttpError(404, "No such session");
  // claude gets to shut down cleanly (and tell claude.ai); its `script`
  // wrapper and stdin feeder then exit on their own.
  await terminate(pid);
}
