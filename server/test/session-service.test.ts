import { afterEach, expect, test } from "bun:test";
import type {
  LiveSession,
  ProviderId,
  StartResult,
} from "../../shared/sessions";
import type { SessionProvider, LaunchContext } from "../src/providers/types";
import { createSessionService } from "../src/sessions";
import { db } from "../src/db";
import { listRecentProjects } from "../src/recent-projects";
import type { Project } from "../src/projects";

const conversationId = "d93a0993-f739-4543-909e-ee5a7321f390";
const context: LaunchContext = {
  host: null,
  projectPath: "/fixture/service/repo",
  name: "test",
  permissions: {},
  yolo: false,
};
const project: Project = {
  key: "repo",
  label: "repo",
  host: "",
  path: context.projectPath,
  root: "/fixture/service",
  relativePath: "repo",
  mtime: 1,
};
const access = {
  kind: "url" as const,
  url: "https://example.test/session",
  label: "fixture",
};

function adapter(id: ProviderId, calls: string[]): SessionProvider {
  const definition = {
    id,
    label: id,
    icon: id === "claude" ? ("anthropic" as const) : ("chatgpt" as const),
    connectionLabel: id,
    permissionFields: [],
    supportsPairing: true,
    stopLabel: "stop",
    stopDescription: "fixture",
  };
  return {
    definition,
    async status() {
      return { ...definition, available: true, version: "test", error: null };
    },
    async launch(c) {
      calls.push(`${id}:${c.resume ? "resume" : "start"}`);
      return {
        provider: id,
        status: "running",
        access,
        name: c.name,
        conversationId,
      };
    },
    async list() {
      calls.push(`${id}:list`);
      return [
        {
          id: conversationId,
          provider: id,
          host: "",
          cwd: context.projectPath,
          kind: "session",
          name: "test",
          title: null,
          conversationId,
          access,
          newConversationAccess: null,
          permissionMode: null,
          startedAt: null,
          lastActivity: null,
          managed: true,
          state: "idle",
          conversations: [],
        } satisfies LiveSession,
      ];
    },
    async history() {
      calls.push(`${id}:history`);
      return [
        {
          provider: id,
          id: conversationId,
          title: "saved",
          firstPrompt: null,
          startedAt: null,
          updatedAt: new Date().toISOString(),
          bytes: null,
          live: false,
        },
      ];
    },
    async stop(_host, key) {
      calls.push(`${id}:stop:${key}`);
    },
    async pair() {
      calls.push(`${id}:pair`);
      return { manualPairingCode: "fixture", expiresAt: 1 };
    },
  };
}

afterEach(() =>
  db
    .query("DELETE FROM recent_projects WHERE path LIKE '/fixture/service/%'")
    .run(),
);

for (const id of ["claude", "codex"] as const) {
  test(`${id} uses the same launch, history, resume, stop and pairing service`, async () => {
    const calls: string[] = [];
    const service = createSessionService([
      adapter("claude", calls),
      adapter("codex", calls),
    ]);
    const started = await service.launch(id, context);
    expect(started.provider).toBe(id);
    expect(started.status).toBe("running");
    expect(listRecentProjects([project])).toHaveLength(1);
    await service.history(id, null, context.projectPath);
    await service.launch(id, { ...context, resume: conversationId });
    await service.stop(id, null, "own-id");
    await service.pair(id, null);
    expect(calls).toEqual([
      `${id}:start`,
      `${id}:history`,
      `${id}:history`,
      `${id}:resume`,
      `${id}:stop:own-id`,
      `${id}:pair`,
    ]);
    expect(listRecentProjects([project])).toHaveLength(1);
  });
}

test("one unavailable provider does not remove the other provider's sessions", async () => {
  const calls: string[] = [];
  const unavailable = adapter("codex", calls);
  unavailable.list = async () => {
    throw new Error("offline");
  };
  const service = createSessionService([adapter("claude", calls), unavailable]);
  expect((await service.list(null)).map((s) => s.provider)).toEqual(["claude"]);
});

test("browsing and failed launches never add a directory to recents", async () => {
  const native = adapter("codex", []);
  const service = createSessionService([native]);
  await service.list(null);
  await service.history("codex", null, context.projectPath);
  expect(listRecentProjects([project])).toEqual([]);
  native.launch = async () => {
    throw new Error("not signed in");
  };
  const result = await service.launch("codex", context);
  expect(result).toMatchObject({
    provider: "codex",
    status: "failed",
    error: "not signed in",
    access: null,
  });
  expect(listRecentProjects([project])).toEqual([]);
});

test("resume validates provider, directory and running state before launching", async () => {
  const calls: string[] = [];
  const native = adapter("claude", calls);
  const service = createSessionService([native]);
  await expect(service.launch("unknown", context)).rejects.toThrow(
    "Unknown session provider",
  );
  await expect(
    service.launch("claude", { ...context, resume: "../../anything" }),
  ).rejects.toThrow("Invalid conversation");
  native.history = async () => [];
  await expect(
    service.launch("claude", { ...context, resume: conversationId }),
  ).rejects.toThrow("Conversation not found");
  const history = await adapter("claude", []).history(
    null,
    context.projectPath,
  );
  native.history = async () => history.map((c) => ({ ...c, live: true }));
  await expect(
    service.launch("claude", { ...context, resume: conversationId }),
  ).rejects.toThrow("already running");
  expect(calls).toEqual([]);
});
