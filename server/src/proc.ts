/**
 * Local process control via `ps`, which works the same on Linux (the Pi) and
 * macOS (development) — unlike /proc.
 */

export interface ProcInfo {
  pid: number;
  ppid: number;
  /** ps STAT column; starts with 'Z' for zombies. */
  stat: string;
  args: string;
}

export async function processTable(): Promise<Map<number, ProcInfo>> {
  const proc = Bun.spawn(["ps", "-A", "-o", "pid=,ppid=,stat=,args="], { stdout: "pipe", stderr: "ignore" });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  const table = new Map<number, ProcInfo>();
  for (const line of out.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (!m) continue;
    table.set(Number(m[1]), { pid: Number(m[1]), ppid: Number(m[2]), stat: m[3]!, args: m[4]! });
  }
  return table;
}

/** Alive and not a zombie. A finished child we spawned lingers as one until reaped. */
export function isAlive(table: Map<number, ProcInfo>, pid: number | null | undefined): boolean {
  if (!pid) return false;
  const p = table.get(pid);
  return !!p && !p.stat.startsWith("Z");
}

export function descendants(table: Map<number, ProcInfo>, pid: number): number[] {
  const children = new Map<number, number[]>();
  for (const p of table.values()) {
    const list = children.get(p.ppid) ?? [];
    list.push(p.pid);
    children.set(p.ppid, list);
  }
  const found: number[] = [];
  const todo = [pid];
  while (todo.length) {
    for (const child of children.get(todo.pop()!) ?? []) {
      found.push(child);
      todo.push(child);
    }
  }
  return found;
}

function signal(pids: number[], sig: NodeJS.Signals): void {
  for (const pid of pids) {
    try {
      process.kill(pid, sig);
    } catch {
      // Already gone.
    }
  }
}

/** How long a killed session gets after SIGTERM before it is SIGKILLed. */
export const KILL_GRACE_MS = 10_000;

/** Matches the argv of a Remote Control session's claude process. */
export const SESSION_ARGS = /^(?:\S*\/)?claude\s.*--remote-control(?:[=\s]|$)/;

/** Send *sig* and wait up to *graceMs* for *pids* to go; returns the ones still alive. */
async function signalAndWait(pids: number[], sig: NodeJS.Signals, graceMs: number): Promise<number[]> {
  signal(pids, sig);
  const deadline = Date.now() + graceMs;
  let left = pids;
  while (left.length && Date.now() < deadline) {
    await Bun.sleep(200);
    const table = await processTable();
    left = pids.filter((t) => isAlive(table, t));
  }
  return left;
}

/**
 * Stop *pid* and its whole process tree, claude first.
 *
 * claude gets SIGTERM on its own and time to shut down: it has to tell
 * claude.ai it is gone. Signalling the tree at once kills
 * `script`, whose closing pty SIGHUPs claude mid-shutdown — claude.ai then keeps
 * the folder marked "already served" and every new session there fails.
 *
 * The tree, not the process group: `script` runs claude in a session of its
 * own on the pty, so signalling script's group would miss it. Returns once
 * everything is gone or has been SIGKILLed.
 */
export async function terminate(pid: number, graceMs = KILL_GRACE_MS): Promise<void> {
  const table = await processTable();
  const tree = [pid, ...descendants(table, pid)];
  const claudes = tree.filter((t) => SESSION_ARGS.test(table.get(t)?.args ?? ""));
  const deadline = Date.now() + graceMs;
  if (claudes.length) await signalAndWait(claudes, "SIGTERM", graceMs);
  // Whatever claude left behind: script, the stdin feeder, tool processes.
  const rest = tree.filter((t) => isAlive(table, t));
  const left = await signalAndWait(rest, "SIGTERM", Math.max(2000, deadline - Date.now()));
  if (left.length) {
    console.warn(`pids ${left.join(",")} still alive after SIGTERM; sending SIGKILL`);
    signal(left, "SIGKILL");
  }
}
