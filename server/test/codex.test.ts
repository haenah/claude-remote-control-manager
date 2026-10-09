import { expect, test } from "bun:test";
import {
  createCodexLifecycle,
  codexPermissions,
  type CodexThread,
} from "../src/providers/codex/lifecycle";
import { CodexRpc } from "../src/providers/codex/rpc";
import {
  jsonlTransport,
  websocketTransport,
} from "../src/providers/codex/transport";
import type { LaunchContext } from "../src/providers/types";

const id = "d93a0993-f739-4543-909e-ee5a7321f390";
const ctx: LaunchContext = {
  host: null,
  projectPath: "/fixture/repo",
  name: "My work",
  permissionMode: "auto",
};
const thread: CodexThread = {
  id,
  cwd: ctx.projectPath,
  name: ctx.name,
  createdAt: 1791500000,
  updatedAt: 1791500100,
  status: { type: "idle" },
  originator: "rcm",
};

function fixture(overrides: Record<string, unknown> = {}) {
  const calls: { method: string; params: unknown }[] = [];
  let closed = 0;
  const rpc = {
    async request<T>(method: string, params: unknown = {}): Promise<T> {
      calls.push({ method, params });
      const values: Record<string, unknown> = {
        "remoteControl/status/read": {
          status: "connected",
          serverName: "devbox",
          environmentId: "env-fixture",
        },
        "thread/start": { thread },
        "thread/resume": { thread },
        "thread/read": { thread },
        "thread/name/set": {},
        "thread/archive": {},
        "turn/interrupt": {},
        "thread/loaded/list": { data: [id], nextCursor: null },
        "thread/list": { data: [thread], nextCursor: null },
        "remoteControl/pairing/start": {
          manualPairingCode: "PAIR-FIXTURE",
          expiresAt: 1791500300000,
        },
        ...overrides,
      };
      const value = values[method];
      if (value instanceof Error) throw value;
      if (typeof value === "function") return value(params) as T;
      if (
        method === "thread/list" &&
        (params as { archived?: boolean }).archived &&
        !(method in overrides)
      )
        return { data: [], nextCursor: null } as T;
      return value as T;
    },
    close() {
      closed++;
    },
  };
  const lifecycle = createCodexLifecycle({
    connect: async () => rpc,
    runScript: async (_host, command) => {
      calls.push({ method: "command", params: command });
      return {
        code: 0,
        stdout: JSON.stringify({
          manualPairingCode: "PAIR-FIXTURE",
          expiresAt: 1791500300000,
        }),
        stderr: "",
      };
    },
  });
  return { lifecycle, calls, closed: () => closed };
}

test("Codex creates a named native remote thread in the selected directory", async () => {
  const f = fixture();
  const result = await f.lifecycle.launch(ctx);
  expect(result).toMatchObject({
    provider: "codex",
    status: "running",
    conversationId: id,
    access: {
      kind: "remote",
      connectionName: "devbox",
      environmentId: "env-fixture",
    },
  });
  expect(f.calls.find((c) => c.method === "thread/start")?.params).toEqual({
    cwd: ctx.projectPath,
    ephemeral: false,
    approvalPolicy: "on-request",
    sandbox: "workspace-write",
  });
  expect(f.calls.some((c) => c.method === "turn/start")).toBe(false);
  expect(f.closed()).toBe(1);
  expect(f.calls.some((c) => c.method === "command")).toBe(false);
});

test("a native MFA requirement is surfaced before any chat is created", async () => {
  const f = fixture({
    "remoteControl/status/read": {
      status: "errored",
      serverName: "devbox",
      environmentId: null,
    },
    "remoteControl/enable": new Error(
      'HTTP 403: {"detail":"Multi-factor authentication required"}',
    ),
  });
  await expect(f.lifecycle.launch(ctx)).rejects.toThrow(
    "Complete multi-factor authentication",
  );
  expect(
    f.calls.some((c) => ["thread/start", "command"].includes(c.method)),
  ).toBe(false);
  expect(f.closed()).toBe(1);
});

test("a failed connection to a running daemon never restarts the host", async () => {
  const commands: string[] = [];
  const lifecycle = createCodexLifecycle({
    connect: async () => {
      throw new Error("existing daemon connection failed");
    },
    runScript: async (_host, command) => {
      commands.push(command);
      return {
        code: 0,
        stdout: JSON.stringify({ status: "running" }),
        stderr: "",
      };
    },
  });
  await expect(lifecycle.launch(ctx)).rejects.toThrow(
    "existing daemon connection failed",
  );
  expect(commands).toEqual(["codex app-server daemon version\n"]);
});

test("daemon WebSocket framing works through a byte proxy under Bun", async () => {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request, server) {
      if (server.upgrade(request)) return;
      return new Response("Expected WebSocket", { status: 400 });
    },
    websocket: {
      message(socket, data) {
        const request = JSON.parse(data.toString());
        socket.send(
          JSON.stringify({
            id: request.id,
            result: { echo: request.params, method: request.method },
          }),
        );
      },
    },
  });
  const bytes = Bun.spawn(
    [
      process.execPath,
      "-e",
      `
    import {connect} from "node:net";
    const socket=connect(${server.port},"127.0.0.1");
    process.stdin.pipe(socket);socket.pipe(process.stdout);
    socket.on("close",()=>process.exit(0));
  `,
    ],
    { stdin: "pipe", stdout: "pipe", stderr: "pipe" },
  );
  const rpc = new CodexRpc(websocketTransport(bytes));
  try {
    await rpc.ready();
    expect(
      await rpc.request<{ echo: { value: string }; method: string }>(
        "fixture",
        { value: "한글 and frames" },
      ),
    ).toEqual({ echo: { value: "한글 and frames" }, method: "fixture" });
  } finally {
    rpc.close();
    server.stop(true);
  }
});

test("Codex listing and history only read the daemon and never enable Remote or start a chat", async () => {
  const f = fixture();
  const sessions = await f.lifecycle.list(null);
  expect(sessions[0]).toMatchObject({
    id,
    provider: "codex",
    kind: "session",
    cwd: ctx.projectPath,
    managed: true,
  });
  expect(await f.lifecycle.history(null, ctx.projectPath)).toMatchObject([
    { provider: "codex", id, live: true },
  ]);
  expect(
    f.calls.every(
      (c) =>
        !["command", "thread/start", "thread/resume", "turn/start"].includes(
          c.method,
        ),
    ),
  ).toBe(true);
});

test("Codex stops only the selected thread, interrupting work before archiving", async () => {
  const f = fixture({
    "thread/read": {
      thread: {
        ...thread,
        turns: [{ id: "turn-fixture", status: "inProgress" }],
      },
    },
  });
  await f.lifecycle.stop(null, id);
  expect(f.calls.map((c) => c.method)).toEqual([
    "thread/read",
    "turn/interrupt",
    "thread/archive",
  ]);
  expect(f.calls[1]?.params).toEqual({ threadId: id, turnId: "turn-fixture" });
});

test("failed setup archives its new empty thread, while resume protects other directories", async () => {
  const f = fixture({ "thread/name/set": new Error("setup failed") });
  await expect(f.lifecycle.launch(ctx)).rejects.toThrow("setup failed");
  expect(f.calls.at(-1)?.method).toBe("thread/archive");
  const other = fixture({
    "thread/read": { thread: { ...thread, cwd: "/other/repo" } },
  });
  await expect(
    other.lifecycle.launch({ ...ctx, resume: id, resumeArchived: true }),
  ).rejects.toThrow("different directory");
  expect(other.calls.some((c) => c.method === "thread/resume")).toBe(false);
  expect(other.calls.some((c) => c.method === "thread/unarchive")).toBe(false);
  expect(other.closed()).toBe(1);
});

test("pairing expiry is normalized and permission mappings keep YOLO explicit", async () => {
  expect(await fixture().lifecycle.pair(null)).toEqual({
    manualPairingCode: "PAIR-FIXTURE",
    expiresAt: 1791500300,
  });
  expect(codexPermissions("bypassPermissions")).toEqual({
    approvalPolicy: "never",
    sandbox: "danger-full-access",
  });
  expect(codexPermissions("plan").sandbox).toBe("read-only");
  expect(codexPermissions("default")).toEqual({});
});

test("archived Codex conversations remain in history and are restored before resume", async () => {
  const f = fixture({
    "thread/list": (params: { archived: boolean }) => ({
      data: params.archived
        ? [{ ...thread, status: { type: "notLoaded" } }]
        : [],
      nextCursor: null,
    }),
    "thread/unarchive": { thread },
  });
  const history = await f.lifecycle.history(null, ctx.projectPath);
  expect(history).toMatchObject([{ id, archived: true, live: false }]);
  await f.lifecycle.launch({ ...ctx, resume: id, resumeArchived: true });
  const methods = f.calls.map((c) => c.method);
  expect(methods.indexOf("thread/unarchive")).toBeLessThan(
    methods.indexOf("thread/resume"),
  );
});

function proxy(code: string) {
  return jsonlTransport(
    Bun.spawn([process.execPath, "-e", code], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    }),
  );
}

test("JSONL transport handles shell noise, split responses, notifications and concurrent requests", async () => {
  const proc = proxy(`
    import { createInterface } from "node:readline";
    console.log("login shell banner");
    for await (const line of createInterface({input:process.stdin})) {
      const msg=JSON.parse(line);
      console.log(JSON.stringify({method:"thread/started",params:{}}));
      const body=JSON.stringify({id:msg.id,result:{method:msg.method}})+"\\n";
      process.stdout.write(body.slice(0,4));
      await Bun.sleep(5);
      process.stdout.write(body.slice(4));
    }
  `);
  const rpc = new CodexRpc(proc);
  try {
    expect(await Promise.all([rpc.request("one"), rpc.request("two")])).toEqual(
      [{ method: "one" }, { method: "two" }],
    );
  } finally {
    rpc.close();
  }
});

test("JSONL transport rejects protocol errors and outstanding requests on disconnect", async () => {
  const rpc = new CodexRpc(
    proxy(`
    import {createInterface} from "node:readline";
    for await (const line of createInterface({input:process.stdin})) {
      const msg=JSON.parse(line);
      console.log(JSON.stringify({id:msg.id,error:{code:-1,message:"denied"}}));
      break;
    }
  `),
  );
  try {
    await expect(rpc.request("failure")).rejects.toThrow("denied");
  } finally {
    rpc.close();
  }
  const closed = new CodexRpc(proxy("process.exit(0)"));
  try {
    await expect(closed.request("pending")).rejects.toThrow(
      "daemon is unavailable",
    );
  } finally {
    closed.close();
  }
});
