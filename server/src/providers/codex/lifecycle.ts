/** Native Codex Remote Control, using the installed CLI and its local daemon.
 * Protocol: https://learn.chatgpt.com/docs/app-server
 * No public app-server listener or OpenAI API key is needed.
 */
import type { RemoteHost } from "../../config";
import type {
  LiveSession,
  PastConversation,
  StartResult,
} from "../../../../shared/sessions";
import type { LaunchContext } from "../types";
import { connect, type CodexRpc } from "./rpc";
import { runScript } from "../../hosts";
import { HttpError } from "../../http";

interface RemoteStatus {
  status: "disabled" | "connecting" | "connected" | "errored";
  serverName: string;
  environmentId: string | null;
}
export interface CodexRemote {
  serverName: string;
  environmentId: string | null;
}
export interface CodexThread {
  id: string;
  cwd: string;
  name?: string | null;
  preview?: string;
  createdAt: number;
  updatedAt: number;
  status: {
    type: "idle" | "active" | "notLoaded" | "systemError";
    activeFlags?: string[];
  };
  originator?: string | null;
  parentThreadId?: string | null;
  turns?: { id: string; status: string }[];
}

const epoch = (seconds: number) => new Date(seconds * 1000).toISOString();

export function codexPermissions(mode: LaunchContext["permissionMode"]) {
  if (mode === "bypassPermissions")
    return { approvalPolicy: "never", sandbox: "danger-full-access" };
  if (mode === "plan")
    return { approvalPolicy: "on-request", sandbox: "read-only" };
  if (mode === "dontAsk")
    return { approvalPolicy: "never", sandbox: "workspace-write" };
  if (mode === "default") return {};
  return { approvalPolicy: "on-request", sandbox: "workspace-write" };
}

export function codexLiveSession(
  thread: CodexThread,
  host: string,
  remote: CodexRemote,
): LiveSession {
  return {
    id: thread.id,
    provider: "codex",
    host,
    cwd: thread.cwd,
    kind: "session",
    name: thread.name ?? null,
    title: thread.name ?? thread.preview ?? null,
    conversationId: thread.id,
    access: {
      kind: "remote",
      connectionName: remote.serverName,
      environmentId: remote.environmentId,
      supportsPairing: true,
    },
    newConversationAccess: null,
    state:
      thread.status.type === "active"
        ? "busy"
        : thread.status.type === "systemError"
          ? "error"
          : "idle",
    permissionMode: null,
    startedAt: epoch(thread.createdAt),
    lastActivity: epoch(thread.updatedAt),
    managed: thread.originator === "rcm",
    conversations: [],
  };
}

type CodexClient = Pick<CodexRpc, "request" | "close">;

export function createCodexLifecycle(
  runtime: {
    connect: (
      host: RemoteHost | null,
      options?: { readStored?: boolean },
    ) => Promise<CodexClient>;
    runScript: typeof runScript;
  } = { connect, runScript },
) {
  async function enableRemote(host: RemoteHost | null) {
    const res = await runtime.runScript(
      host,
      "codex remote-control start --json\n",
      45_000,
    );
    if (res.code !== 0)
      throw remoteSetupError(
        res.stderr.trim() ||
          res.stdout.trim() ||
          "Install the current Codex CLI and run codex login on this host.",
      );
  }

  async function readyRemote(rpc: CodexClient): Promise<RemoteStatus> {
    const deadline = Date.now() + 25_000;
    do {
      const status = await rpc.request<RemoteStatus>(
        "remoteControl/status/read",
      );
      if (status.status === "connected" && status.environmentId) return status;
      if (status.status === "disabled" || status.status === "errored")
        throw new Error(
          "Codex Remote is not connected. Check codex login and Remote Control access on this host.",
        );
      await Bun.sleep(300);
    } while (Date.now() < deadline);
    throw new Error(
      "Codex Remote did not connect in time. Check this host's connection and Codex sign-in.",
    );
  }

  async function startCodexSession(o: LaunchContext): Promise<StartResult> {
    let rpc: CodexClient;
    try {
      rpc = await runtime.connect(o.host);
    } catch (error) {
      // An inaccessible running daemon must not be restarted by a chat launch.
      const version = await runtime.runScript(
        o.host,
        "codex app-server daemon version\n",
        10_000,
      );
      if (version.code !== 0) throw error;
      let daemon: { status?: string };
      try {
        daemon = JSON.parse(version.stdout.trim());
      } catch {
        throw error;
      }
      if (daemon.status === "running") throw error;
      await enableRemote(o.host);
      rpc = await runtime.connect(o.host);
    }
    try {
      const state = await rpc.request<RemoteStatus>(
        "remoteControl/status/read",
      );
      if (state.status === "disabled" || state.status === "errored") {
        try {
          await rpc.request("remoteControl/enable", { ephemeral: false });
        } catch (e) {
          throw remoteSetupError((e as Error).message);
        }
      }
      const remote = await readyRemote(rpc);
      const params = {
        cwd: o.projectPath,
        ...codexPermissions(o.permissionMode),
      };
      let response: { thread: CodexThread };
      if (o.resume) {
        const { thread } = await rpc.request<{ thread: CodexThread }>(
          "thread/read",
          { threadId: o.resume },
        );
        if (thread.cwd !== o.projectPath)
          throw new Error(
            "This Codex conversation belongs to a different directory",
          );
        if (o.resumeArchived)
          await rpc.request("thread/unarchive", { threadId: o.resume });
        response = await rpc.request("thread/resume", {
          ...params,
          threadId: o.resume,
        });
      } else {
        response = await rpc.request("thread/start", {
          ...params,
          ephemeral: false,
        });
      }
      try {
        await rpc.request("thread/name/set", {
          threadId: response.thread.id,
          name: o.name,
        });
      } catch (e) {
        // A failed setup must not leave a new empty conversation for every retry.
        if (!o.resume)
          await rpc
            .request("thread/archive", { threadId: response.thread.id })
            .catch(() => {});
        throw e;
      }
      invalidateCodexSessions(o.host?.name ?? "");
      return {
        status: "running",
        provider: "codex",
        name: o.name,
        conversationId: response.thread.id,
        access: {
          kind: "remote",
          connectionName: remote.serverName,
          environmentId: remote.environmentId,
          supportsPairing: true,
        },
      };
    } finally {
      rpc.close();
    }
  }

  const liveCache = new Map<
    string,
    { at: number; pending: Promise<LiveSession[]> }
  >();
  function invalidateCodexSessions(host: string) {
    liveCache.delete(host);
  }

  function readCodexSessions(host: RemoteHost | null): Promise<LiveSession[]> {
    const key = host?.name ?? "";
    const hit = liveCache.get(key);
    if (hit && Date.now() - hit.at < 5_000) return hit.pending;
    const pending = (async () => {
      let rpc: CodexClient | undefined;
      try {
        rpc = await runtime.connect(host); // Reading never starts a daemon or creates a thread.
        const remote = await rpc.request<RemoteStatus>(
          "remoteControl/status/read",
        );
        const threads: CodexThread[] = [];
        let cursor: string | null = null;
        do {
          const page: { data: string[]; nextCursor: string | null } =
            await rpc.request("thread/loaded/list", { limit: 100, cursor });
          const results = await Promise.all(
            page.data.map((id) =>
              rpc!
                .request<{ thread: CodexThread }>("thread/read", {
                  threadId: id,
                })
                .catch(() => null),
            ),
          );
          for (const result of results)
            if (
              result &&
              result.thread.status.type !== "notLoaded" &&
              !result.thread.parentThreadId
            )
              threads.push(result.thread);
          cursor = page.nextCursor;
        } while (cursor);
        return threads.map((t) => codexLiveSession(t, key, remote));
      } catch {
        return [];
      } finally {
        // Claude stays usable when Codex is missing or stopped.
        rpc?.close();
      }
    })();
    liveCache.set(key, { at: Date.now(), pending });
    return pending;
  }

  async function readCodexHistory(
    host: RemoteHost | null,
    cwd: string,
  ): Promise<PastConversation[]> {
    const rpc = await runtime.connect(host, { readStored: true });
    try {
      const groups = await Promise.all(
        [false, true].map(async (archived) => {
          const { data } = await rpc.request<{ data: CodexThread[] }>(
            "thread/list",
            { cwd, limit: 60, sortKey: "updated_at", archived },
          );
          return data
            .filter((t) => t.cwd === cwd)
            .map((t): PastConversation => ({
              provider: "codex",
              id: t.id,
              title: t.name ?? null,
              firstPrompt: t.preview || null,
              startedAt: epoch(t.createdAt),
              updatedAt: epoch(t.updatedAt),
              bytes: null,
              live: !archived && t.status.type !== "notLoaded",
              archived,
            }));
        }),
      );
      return groups
        .flat()
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 60);
    } finally {
      rpc.close();
    }
  }

  async function stopCodexSession(
    host: RemoteHost | null,
    threadId: string,
  ): Promise<void> {
    const rpc = await runtime.connect(host);
    try {
      const { thread } = await rpc.request<{ thread: CodexThread }>(
        "thread/read",
        { threadId, includeTurns: true },
      );
      const turn = thread.turns?.findLast((t) => t.status === "inProgress");
      if (turn)
        await rpc.request("turn/interrupt", { threadId, turnId: turn.id });
      await rpc.request("thread/archive", { threadId });
      invalidateCodexSessions(host?.name ?? "");
    } finally {
      rpc.close();
    }
  }

  async function pairCodex(host: RemoteHost | null) {
    const rpc = await runtime.connect(host);
    try {
      const data = await rpc.request<{
        manualPairingCode: string | null;
        expiresAt: number;
      }>("remoteControl/pairing/start", { manualCode: true });
      if (typeof data.manualPairingCode !== "string" || !data.manualPairingCode)
        throw new HttpError(502, "Codex did not return a manual pairing code");
      const expiry = Number(data.expiresAt);
      if (!Number.isFinite(expiry) || expiry <= 0)
        throw new HttpError(502, "Codex returned an invalid pairing expiry");
      return {
        manualPairingCode: data.manualPairingCode,
        expiresAt: expiry > 1_000_000_000_000 ? expiry / 1000 : expiry,
      };
    } catch (e) {
      throw remoteSetupError((e as Error).message);
    } finally {
      rpc.close();
    }
  }

  return {
    launch: startCodexSession,
    list: readCodexSessions,
    history: readCodexHistory,
    stop: stopCodexSession,
    pair: pairCodex,
  };
}

function remoteSetupError(message: string): Error {
  if (/multi.factor authentication required/i.test(message))
    return new Error(
      "Complete multi-factor authentication in ChatGPT, then sign in again with codex login on this host.",
    );
  const concise = message
    .split("\n")
    .findLast((line) => line.startsWith("Error:"))
    ?.replace(/^Error:\s*/, "");
  return new Error(concise || message);
}
