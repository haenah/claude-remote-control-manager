import {
  processTable,
  descendants,
  isAlive,
  signalAndWait,
  KILL_GRACE_MS,
} from "../../proc";

/** Matches the argv of a `claude remote-control` bridge process. */
export const BRIDGE_ARGS = /^(?:\S*\/)?claude remote-control(?:\s|$)/;

/**
 * Stop *pid* and its whole process tree, bridge first.
 *
 * The `claude remote-control` bridge gets SIGTERM on its own and time to shut
 * down: it has to tell claude.ai it is gone. Signalling the tree at once kills
 * `script`, whose closing pty SIGHUPs claude mid-shutdown — claude.ai then keeps
 * the folder marked "already served" and every new session there fails.
 *
 * The tree, not the process group: `script` runs claude in a session of its
 * own on the pty, so signalling script's group would miss it. Returns once
 * everything is gone or has been SIGKILLed.
 */
export async function terminate(
  pid: number,
  graceMs = KILL_GRACE_MS,
): Promise<void> {
  const table = await processTable();
  const tree = [pid, ...descendants(table, pid)];
  const bridges = tree.filter((t) =>
    BRIDGE_ARGS.test(table.get(t)?.args ?? ""),
  );
  const deadline = Date.now() + graceMs;
  if (bridges.length) await signalAndWait(bridges, "SIGTERM", graceMs);
  // Whatever the bridge left behind: script, the stdin feeder, session workers.
  const rest = tree.filter((t) => isAlive(table, t));
  const left = await signalAndWait(
    rest,
    "SIGTERM",
    Math.max(2000, deadline - Date.now()),
  );
  if (left.length) {
    console.warn(
      `pids ${left.join(",")} still alive after SIGTERM; sending SIGKILL`,
    );
    for (const pid of left) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* Already gone. */
      }
    }
  }
}
