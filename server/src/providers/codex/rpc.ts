import type { RemoteHost } from "../../config";
import { spawnScript } from "../../hosts";

import {
  jsonlTransport,
  websocketTransport,
  type RpcTransport,
} from "./transport";
type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class CodexRpc {
  private id = 0;
  private pending = new Map<number, Pending>();
  private closed = false;
  constructor(private transport: RpcTransport) {
    transport.listen(
      (message) => this.receive(message),
      (error) => this.fail(error),
    );
  }
  private receive(data: unknown) {
    const message = data as {
      id?: number;
      method?: string;
      error?: { message?: string };
      result?: unknown;
    };
    if (message.method) {
      if (message.id !== undefined)
        this.notify({
          id: message.id,
          error: {
            code: -32601,
            message: "Use ChatGPT to handle interactive requests",
          },
        });
      return;
    }
    if (message.id === undefined) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error)
      pending.reject(
        new Error(message.error.message ?? "Codex request failed"),
      );
    else pending.resolve(message.result);
  }
  ready() {
    return this.transport.ready;
  }
  private fail(error: Error) {
    this.closed = true;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
  }
  notify(message: unknown) {
    if (this.closed) throw new Error("Codex connection is closed");
    this.transport.send(message);
  }
  request<T>(
    method: string,
    params: unknown = {},
    timeoutMs = 20_000,
  ): Promise<T> {
    if (this.closed)
      return Promise.reject(new Error("Codex connection is closed"));
    const id = ++this.id;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex ${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve: (v) => resolve(v as T), reject, timer });
      try {
        this.notify({ id, method, params });
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }
  close() {
    this.fail(new Error("Codex connection closed"));
    this.transport.close();
    // Only the proxy is stopped; the shared daemon and its work stay alive.
  }
}

async function initialize(
  host: RemoteHost | null,
  command: string,
  mode: "jsonl" | "websocket",
): Promise<CodexRpc> {
  const proc = spawnScript(host, command);
  const rpc = new CodexRpc(
    mode === "websocket" ? websocketTransport(proc) : jsonlTransport(proc),
  );
  try {
    await rpc.ready();
    await rpc.request("initialize", {
      clientInfo: { name: "rcm", title: "rc manager", version: "0.1.0" },
      capabilities: { experimentalApi: true },
    });
    rpc.notify({ method: "initialized" });
    return rpc;
  } catch (e) {
    rpc.close();
    throw e;
  }
}

export async function connect(
  host: RemoteHost | null,
  options: { readStored?: boolean } = {},
): Promise<CodexRpc> {
  try {
    return await initialize(host, "exec codex app-server proxy", "websocket");
  } catch (e) {
    if (!options.readStored) throw e;
    // A temporary query server reads saved chats even when the daemon is off.
    // It never enables Remote, creates a thread or runs an inference turn.
    return initialize(host, "exec codex app-server --listen stdio://", "jsonl");
  }
}
