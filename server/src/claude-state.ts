/**
 * Live and past Claude sessions, read from where claude itself keeps them —
 * rcm stores none of this. Sources, per host:
 *
 *  - the process table: every `claude --remote-control` session that is
 *    running, whoever started it. `claude remote-control` bridges are left
 *    out: rcm cannot start them, so listing them only confuses.
 *  - the `script` log of sessions rcm started: the log path is in the parent
 *    process's argv, and the claude.ai session link is printed into it
 *  - ~/.claude/projects/<cwd>/<uuid>.jsonl: transcripts, for titles and history
 *
 * The same bash script runs locally and over ssh, so both hosts are read the
 * same way. It copes with Linux (/proc) and macOS (lsof, ps) for development.
 */

import type { RemoteHost } from "./config";
import { runScript, shQuote } from "./hosts";

export interface LiveSession {
  /** Host name, '' for this machine. */
  host: string;
  pid: number;
  cwd: string;
  /** --remote-control <name>. */
  name: string | null;
  /** Claude's own title for the conversation, once it has one. */
  title: string | null;
  /** Local transcript id. */
  conversationId: string | null;
  /** claude.ai link to the conversation. */
  url: string | null;
  permissionMode: string | null;
  startedAt: string | null;
  /** Last change to the conversation's transcript. */
  lastActivity: string | null;
  /** Started by rcm (its `script` log is known). */
  managed: boolean;
}

export interface PastConversation {
  id: string;
  title: string | null;
  firstPrompt: string | null;
  startedAt: string | null;
  updatedAt: string;
  bytes: number;
}

// Shared helpers. Claude names a project's directory after its cwd with every
// non-alphanumeric character replaced by '-'.
const COMMON = String.raw`
C="$HOME/.claude"
enc() { printf '%s' "$1" | sed 's/[^A-Za-z0-9]/-/g'; }
title_of() { [ -f "$1" ] && tail -c 262144 "$1" 2>/dev/null | grep -a '"type":"ai-title"' | tail -1; }
# T <id> <transcript mtime> <last ai-title line>
transcript() { f="$C/projects/$(enc "$2")/$1.jsonl"; m=''; [ -f "$f" ] && m=$(date -r "$f" +%s); printf 'T\t%s\t%s\t%s\n' "$1" "$m" "$(title_of "$f")"; }
`;

export const STATE_SCRIPT =
  COMMON +
  String.raw`
cwd_of() { if [ -r "/proc/$1/cwd" ]; then readlink "/proc/$1/cwd"; else lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p'; fi; }
argv_of() { if [ -r "/proc/$1/cmdline" ]; then tr '\0' '\037' < "/proc/$1/cmdline"; else ps -o args= -p "$1"; fi; }
ps -A -o pid=,ppid=,args= | awk '{ n = split($3, a, "/") } a[n] == "claude" && $0 ~ / --remote-control([= ]|$)/ && $0 !~ / --print( |$)/ { print $1, $2 }' |
while read -r pid ppid; do
  cwd=$(cwd_of "$pid")
  gp=$(ps -o ppid= -p "$ppid" | tr -d ' ')
  log=$( { ps -o args= -p "$ppid"; [ -n "$gp" ] && ps -o args= -p "$gp"; } | grep -oE '[^ ]*/session-[0-9a-f]{12}\.log' | head -1)
  url=''
  [ -n "$log" ] && [ -f "$log" ] && url=$(head -c 4194304 "$log" | grep -aoE 'https://claude\.ai/code/session_[A-Za-z0-9_-]+' | tail -1)
  argv=$(argv_of "$pid")
  printf 'R\t%s\t%s\t%s\t%s\t%s\t%s\n' "$pid" "$cwd" "$argv" "$log" "$url" "$(ps -o lstart= -p "$pid")"
  id=$(printf '%s' "$argv" | tr '\037' ' ' | grep -oE -- '--(session-id|resume)[= ][0-9a-f-]{36}' | grep -oE '[0-9a-f-]{36}$' | head -1)
  [ -n "$id" ] && transcript "$id" "$cwd"
done
`;

/** argv of a process: exact (Linux, \x1f-joined) or the ps line (macOS). */
function flag(argv: string, name: string): string | null {
  if (argv.includes("\x1f")) {
    const parts = argv.split("\x1f");
    for (let i = 0; i < parts.length; i++) {
      if (parts[i] === name) return parts[i + 1] && !parts[i + 1]!.startsWith("--") ? parts[i + 1]! : "";
      if (parts[i]!.startsWith(`${name}=`)) return parts[i]!.slice(name.length + 1);
    }
    return null;
  }
  // A space-joined ps line: a value runs to the next flag.
  const m = argv.match(new RegExp(`(?:^|\\s)${name}(?:=|\\s+)(?!--)(.*?)(?=\\s--|$)`));
  if (m) return m[1]!.trim();
  return new RegExp(`(?:^|\\s)${name}(?:\\s|$)`).test(argv) ? "" : null;
}

function aiTitle(line: string | undefined): string | null {
  if (!line) return null;
  try {
    return JSON.parse(line).aiTitle ?? null;
  } catch {
    return null;
  }
}

function parseDate(s: string | undefined): string | null {
  if (!s?.trim()) return null;
  const t = Date.parse(s.trim().replace(/\s+/g, " "));
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** Epoch seconds → ISO, or null for anything that isn't one. */
function epoch(s: string | undefined): string | null {
  const n = Number(s);
  return s && Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : null;
}

const sessionUrl = (id: string) => `https://claude.ai/code/${id}`;

/** Every live remote-control session on *host*. Throws HostUnreachable for a remote host that can't be reached. */
export async function readLiveSessions(host: RemoteHost | null): Promise<LiveSession[]> {
  const res = await runScript(host, STATE_SCRIPT, 20_000);
  return parseState(res.stdout, host?.name ?? "");
}

/** Parse the state script's output. */
export function parseState(stdout: string, hostName: string): LiveSession[] {
  const sessions: LiveSession[] = [];
  const transcripts = new Map<string, { title: string | null; mtime: string | null }>();

  for (const line of stdout.split("\n")) {
    const f = line.split("\t");
    if (f[0] === "R" && f.length >= 7) {
      const [, pid, cwd, argv, log, url, lstart] = f as string[];
      sessions.push({
        host: hostName,
        pid: Number(pid),
        cwd: cwd!,
        name: flag(argv!, "--remote-control") || null,
        title: null,
        conversationId: flag(argv!, "--session-id") || flag(argv!, "--resume") || null,
        url: url || null,
        permissionMode: flag(argv!, "--permission-mode") || (flag(argv!, "--dangerously-skip-permissions") !== null ? "bypassPermissions" : null),
        startedAt: parseDate(lstart),
        lastActivity: null,
        managed: !!log,
      });
    } else if (f[0] === "T" && f[1]) {
      transcripts.set(f[1], {
        title: aiTitle(f.slice(3).join("\t")),
        mtime: epoch(f[2]),
      });
    }
  }

  for (const s of sessions) {
    const t = s.conversationId ? transcripts.get(s.conversationId) : undefined;
    s.title = t?.title ?? null;
    // The transcript moves when the conversation does; the terminal log
    // (repainted constantly by the TUI) would always read "just now".
    s.lastActivity = t?.mtime ?? null;
  }
  return sessions;
}

export const HISTORY_SCRIPT =
  COMMON +
  String.raw`
d="$C/projects/$(enc "$1")"
ls -t "$d"/*.jsonl 2>/dev/null | head -n "$2" | while read -r f; do
  [ -s "$f" ] || continue
  first=$(head -c 1048576 "$f" | grep -a -m1 '"type":"user"' | cut -c1-20000)
  printf 'H\t%s\t%s\t%s\t%s\t%s\n' "$(basename "$f" .jsonl)" "$(date -r "$f" +%s)" "$(wc -c < "$f" | tr -d ' ')" "$(title_of "$f")" "$first"
done
`;

/** The first thing the user said, from a (possibly truncated) transcript line. */
function firstPrompt(line: string): { text: string | null; at: string | null } {
  let msg: { message?: { content?: unknown }; timestamp?: string } | null = null;
  try {
    msg = JSON.parse(line);
  } catch {
    const m = line.match(/"content":"((?:[^"\\]|\\.)*)/);
    const at = line.match(/"timestamp":"([^"]+)"/)?.[1] ?? null;
    return { text: m ? m[1]!.replace(/\\n/g, " ").replace(/\\(.)/g, "$1") : null, at };
  }
  const c = msg?.message?.content;
  const text =
    typeof c === "string"
      ? c
      : Array.isArray(c)
        ? (c.find((p: { type?: string }) => p?.type === "text") as { text?: string } | undefined)?.text
        : undefined;
  return { text: text?.replace(/\s+/g, " ").trim().slice(0, 200) || null, at: msg?.timestamp ?? null };
}

/** Past conversations in *cwd* on *host*, newest first. */
export async function readHistory(host: RemoteHost | null, cwd: string, limit = 60): Promise<PastConversation[]> {
  const res = await runScript(host, `set -- ${shQuote(cwd)} ${limit}\n${HISTORY_SCRIPT}`, 20_000);
  return parseHistory(res.stdout);
}

export function parseHistory(stdout: string): PastConversation[] {
  const out: PastConversation[] = [];
  for (const line of stdout.split("\n")) {
    const f = line.split("\t");
    if (f[0] !== "H" || !f[1]) continue;
    const first = firstPrompt(f.slice(5).join("\t"));
    // Slash-command and hook noise make poor titles.
    const prompt = first.text && !first.text.startsWith("<") ? first.text : null;
    out.push({
      id: f[1],
      title: aiTitle(f[4]),
      firstPrompt: prompt,
      startedAt: first.at,
      updatedAt: epoch(f[2]) ?? new Date(0).toISOString(),
      bytes: Number(f[3]) || 0,
    });
  }
  return out;
}
