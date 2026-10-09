import { expect, test } from "bun:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sessionService } from "../src/sessions";
import { codexPermissions } from "../src/providers/codex/lifecycle";
import { config, updateConfig } from "../src/config";
import { db, now } from "../src/db";

test("each provider exposes and validates only its native permission settings", () => {
  const settings = sessionService.permissionSettings({
    claude: { mode: "plan" },
  });
  const claude = settings.find((p) => p.provider === "claude")!;
  const codex = settings.find((p) => p.provider === "codex")!;
  expect(claude.values).toEqual({ mode: "plan" });
  expect(codex.fields.map((f) => f.key)).toEqual(["sandbox", "approvalPolicy"]);
  expect(codex.values).toEqual({
    sandbox: "workspace-write",
    approvalPolicy: "on-request",
  });
  expect(() =>
    sessionService.permissionValues("codex", { mode: "auto" }, true),
  ).toThrow("Unknown permission setting");
  expect(() =>
    sessionService.permissionValues(
      "claude",
      { sandbox: "workspace-write" },
      true,
    ),
  ).toThrow("Unknown permission setting");
  expect(() =>
    sessionService.permissionValues("codex", { sandbox: "invalid" }, true),
  ).toThrow("Unknown Sandbox");
});

test("Codex sandbox and approval policy are independent, and YOLO overrides both", () => {
  expect(
    codexPermissions({ sandbox: "read-only", approvalPolicy: "never" }),
  ).toEqual({ sandbox: "read-only", approvalPolicy: "never" });
  expect(
    codexPermissions({
      sandbox: "danger-full-access",
      approvalPolicy: "on-request",
    }),
  ).toEqual({ sandbox: "danger-full-access", approvalPolicy: "on-request" });
  expect(
    codexPermissions({ sandbox: "default", approvalPolicy: "default" }),
  ).toEqual({});
  expect(
    codexPermissions(
      { sandbox: "read-only", approvalPolicy: "on-request" },
      true,
    ),
  ).toEqual({ sandbox: "danger-full-access", approvalPolicy: "never" });
});

test("legacy shared plan restrictions migrate once and stay independent afterwards", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rcm-permissions-migrate-"));
  const path = join(dir, "config.json");
  const module = join(import.meta.dir, "../src/config.ts");
  const load = async () => {
    const proc = Bun.spawn(
      [
        process.execPath,
        "-e",
        `const {config}=await import(${JSON.stringify(module)}); console.log(JSON.stringify(config.providerPermissions));`,
      ],
      {
        env: { ...process.env, RCM_CONFIG: path },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const output = await new Response(proc.stdout).text();
    expect(await proc.exited).toBe(0);
    return JSON.parse(output);
  };
  try {
    await writeFile(
      path,
      JSON.stringify({ permissionMode: "plan", projectsDirs: [dir] }),
    );
    expect(await load()).toEqual({
      claude: { mode: "plan" },
      codex: { sandbox: "read-only", approvalPolicy: "on-request" },
    });
    const saved = JSON.parse(await readFile(path, "utf8"));
    saved.permissionMode = "bypassPermissions";
    saved.providerPermissions.claude.mode = "bypassPermissions";
    await writeFile(path, JSON.stringify(saved));
    expect((await load()).codex).toEqual({
      sandbox: "read-only",
      approvalPolicy: "on-request",
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("settings API saves each engine independently and rejects cross-engine modes", async () => {
  const { app } = await import("../src/app");
  const { createAuthSession, destroyAuthSession, SESSION_COOKIE } =
    await import("../src/auth/store");
  const original = {
    ...config,
    providerPermissions: structuredClone(config.providerPermissions),
  };
  db.query(
    "INSERT INTO passkeys(id,public_key,name,created_at) VALUES('permission-test',x'00','test',?)",
  ).run(now());
  const token = createAuthSession("permission-test", "test");
  const headers = {
    Cookie: `${SESSION_COOKIE}=${token}`,
    Origin: "http://localhost:8742",
    "Content-Type": "application/json",
  };
  const save = (providerPermissions: unknown) =>
    app.request("/api/settings", {
      method: "PUT",
      headers,
      body: JSON.stringify({ providerPermissions }),
    });
  try {
    expect(
      (await save({ codex: { sandbox: "read-only", approvalPolicy: "never" } }))
        .status,
    ).toBe(200);
    expect(config.providerPermissions.claude).toEqual(
      original.providerPermissions.claude,
    );
    expect((await save({ claude: { mode: "plan" } })).status).toBe(200);
    expect(config.providerPermissions.codex).toEqual({
      sandbox: "read-only",
      approvalPolicy: "never",
    });
    expect((await save({ codex: { mode: "acceptEdits" } })).status).toBe(422);
    const response = await app.request("/api/settings", { headers });
    const settings = (await response.json()) as {
      providerPermissions: {
        provider: string;
        values: Record<string, string>;
      }[];
    };
    expect(
      settings.providerPermissions.find((p) => p.provider === "claude")?.values,
    ).toEqual({ mode: "plan" });
    expect(
      settings.providerPermissions.find((p) => p.provider === "codex")?.values,
    ).toEqual({ sandbox: "read-only", approvalPolicy: "never" });
  } finally {
    updateConfig(original);
    destroyAuthSession(token);
    db.query("DELETE FROM passkeys WHERE id='permission-test'").run();
  }
});
