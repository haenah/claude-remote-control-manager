import type { Writable } from "node:stream";
import { createHash, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { spawnScript } from "../../hosts";

type ProxyProcess = ReturnType<typeof spawnScript>;
export interface RpcTransport {
  ready: Promise<void>;
  listen(
    message: (data: unknown) => void,
    disconnected: (error: Error) => void,
  ): void;
  send(message: unknown): void;
  close(): void;
}

function closeProcess(proc: ProxyProcess) {
  try {
    proc.stdin.end();
  } catch {
    /* Already disconnected. */
  }
  try {
    proc.kill();
  } catch {
    /* Already exited. */
  }
}
const disconnected = () =>
  new Error(
    "Codex daemon is unavailable. Install the current Codex CLI and run codex login on this host.",
  );

/** Standalone app-server uses JSONL on stdio, including read-only history. */
export function jsonlTransport(proc: ProxyProcess): RpcTransport {
  void new Response(proc.stderr).text();
  let failed: (error: Error) => void = () => {};
  return {
    ready: Promise.resolve(),
    listen(message, onClose) {
      failed = onClose;
      void (async () => {
        const reader = proc.stdout.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let end: number;
            while ((end = buffer.indexOf("\n")) !== -1) {
              const line = buffer.slice(0, end);
              buffer = buffer.slice(end + 1);
              try {
                message(JSON.parse(line));
              } catch {
                /* Login-shell banners. */
              }
            }
          }
        } catch {
          /* SSH disconnect or proxy shutdown. */
        } finally {
          reader.releaseLock();
          onClose(disconnected());
        }
      })();
    },
    send(message) {
      proc.stdin.write(JSON.stringify(message) + "\n");
      void Promise.resolve(proc.stdin.flush()).catch(() =>
        failed(disconnected()),
      );
    },
    close() {
      closeProcess(proc);
    },
  };
}

interface WebSocketCodec {
  Receiver: new (options: {
    isServer: boolean;
    maxPayload: number;
  }) => Writable;
  Sender: {
    frame(
      data: Buffer,
      options: {
        fin: boolean;
        mask: boolean;
        opcode: number;
        readOnly: boolean;
      },
    ): Buffer[];
  };
}
// Public ws codec exports provide masking, fragmentation, UTF-8 checks and
// control frames. Bun's WebSocket constructor ignores custom stream sockets.
const load = createRequire(import.meta.url);
const { Receiver, Sender } = load(
  join(dirname(load.resolve("ws/package.json")), "index.js"),
) as WebSocketCodec;

/** Native daemon WebSocket framing over the CLI's byte proxy (local or SSH). */
export function websocketTransport(proc: ProxyProcess): RpcTransport {
  void new Response(proc.stderr).text();
  const key = randomBytes(16).toString("base64");
  const accept = createHash("sha1")
    .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
    .digest("base64");
  const receiver = new Receiver({
    isServer: false,
    maxPayload: 16 * 1024 * 1024,
  });
  let receive: (data: unknown) => void = () => {};
  let failed: (error: Error) => void = () => {};
  let upgraded = false;
  let headers = Buffer.alloc(0);
  let resolveReady: () => void;
  let rejectReady: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const timer = setTimeout(() => {
    const error = new Error("Codex daemon WebSocket handshake timed out");
    rejectReady(error);
    failed(error);
    closeProcess(proc);
  }, 10_000);
  const fail = (error: Error) => {
    clearTimeout(timer);
    rejectReady(error);
    failed(error);
  };
  const frame = (data: Buffer, opcode: number) => {
    for (const part of Sender.frame(data, {
      fin: true,
      mask: true,
      opcode,
      readOnly: true,
    }))
      proc.stdin.write(part);
    void Promise.resolve(proc.stdin.flush()).catch(() => fail(disconnected()));
  };
  receiver.on("message", (data: Buffer) => {
    try {
      receive(JSON.parse(data.toString()));
    } catch {
      fail(new Error("Invalid Codex protocol message"));
    }
  });
  receiver.on("ping", (data: Buffer) => frame(data, 10));
  receiver.on("conclude", () => {
    fail(disconnected());
    closeProcess(proc);
  });
  receiver.on("error", fail);
  void (async () => {
    const reader = proc.stdout.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (upgraded) {
          receiver.write(Buffer.from(value));
          continue;
        }
        headers = Buffer.concat([headers, Buffer.from(value)]);
        const end = headers.indexOf("\r\n\r\n");
        if (end === -1) {
          if (headers.length > 16_384)
            throw new Error("Invalid Codex handshake");
          continue;
        }
        const response = headers.subarray(0, end).toString();
        const returnedAccept = response
          .match(/^sec-websocket-accept:\s*(.+)$/im)?.[1]
          ?.trim();
        if (!/^HTTP\/1\.[01] 101 /.test(response) || returnedAccept !== accept)
          throw new Error("Codex daemon rejected the WebSocket handshake");
        upgraded = true;
        clearTimeout(timer);
        resolveReady!();
        const rest = headers.subarray(end + 4);
        if (rest.length) receiver.write(rest);
        headers = Buffer.alloc(0);
      }
    } catch (e) {
      fail(e as Error);
    } finally {
      reader.releaseLock();
      fail(disconnected());
    }
  })();
  proc.stdin.write(
    `GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
  );
  void Promise.resolve(proc.stdin.flush()).catch(() => fail(disconnected()));
  return {
    ready,
    listen(message, onClose) {
      receive = message;
      failed = onClose;
    },
    send(message) {
      if (!upgraded) throw new Error("Codex transport is not ready");
      frame(Buffer.from(JSON.stringify(message)), 1);
    },
    close() {
      clearTimeout(timer);
      receiver.destroy();
      closeProcess(proc);
    },
  };
}
