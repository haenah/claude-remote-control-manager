import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config, DEFAULT_PROJECTS_DIR } from "../src/config";
import { runScript, shQuote } from "../src/hosts";
import { createProject, invalidateHostCache, listLocalProjects, listProjectFiles, REMOTE_SCAN, resolveProject, scanLocalProjects } from "../src/projects";

let dir: string;
let roots: string[];
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "rcm-projects-"));
  roots = config.projectsDirs;
  config.projectsDirs = [dir];
  invalidateHostCache();
});
afterEach(async () => {
  config.projectsDirs = roots;
  invalidateHostCache();
  await rm(dir, { recursive: true, force: true });
});

async function folder(path: string) {
  await mkdir(join(dir, path), { recursive: true });
}

test("discovers nested directories without traversing metadata, dependencies or symlinks", async () => {
  await Promise.all(["owner/repo/src", "other/repo", "repo/node_modules/pkg", ".git/objects", "repo/.venv/bin", "repo/__pycache__/cache"].map(folder));
  await symlink(dir, join(dir, "loop"));
  const projects = await scanLocalProjects([dir, join(dir, "missing")]);
  expect(projects.map((p) => p.relativePath).sort()).toEqual(["other", "other/repo", "owner", "owner/repo", "owner/repo/src", "repo"]);
  expect(new Set(projects.map((p) => p.key)).size).toBe(projects.length);
  const nested = projects.find((p) => p.key === "owner/repo/src")!;
  expect(nested.path).toBe(await realpath(join(dir, "owner/repo/src")));
  expect(nested.root).toBe(dir);
  expect(nested.mtime).toBeGreaterThan(0);
});

test("multiple roots keep identical names distinct and overlapping roots deduplicate paths", async () => {
  await Promise.all(["first/repo", "second/repo"].map(folder));
  const projects = await scanLocalProjects([join(dir, "first"), join(dir, "second"), join(dir, "first")]);
  expect(projects.map((p) => p.key)).toEqual(["repo", "@1/repo"]);
  expect(new Set(projects.map((p) => p.path)).size).toBe(2);
});

test("nested and reserved names resolve to the correct directory and return only files", async () => {
  await folder("owner/a:b %/src");
  await writeFile(join(dir, "owner/a:b %/README.md"), "hello");
  await writeFile(join(dir, "owner/a:b %/.env"), "fixture");
  await symlink(dir, join(dir, "owner/a:b %/link"));
  const project = (await listLocalProjects()).find((p) => p.label === "a:b %")!;
  expect(project.key).toBe("owner/a%3Ab%20%25");
  expect((await resolveProject(project.key)).path).toBe(project.path);
  expect(await listProjectFiles(project.key)).toEqual([{ name: ".env" }, { name: "README.md" }]);
  await expect(resolveProject("../outside")).rejects.toThrow("not found");
});

test("creating a project refreshes cached recursive discovery immediately", async () => {
  expect(await listLocalProjects()).toEqual([]);
  const created = await createProject("new-repo", null);
  expect((await listLocalProjects()).map((p) => p.key)).toEqual([created.key]);
  expect((await resolveProject(created.key)).path).toBe(created.path);
});

test("file API requires sign-in and accepts encoded nested project keys", async () => {
  await folder("owner/a:b %");
  await writeFile(join(dir, "owner/a:b %", "README.md"), "fixture");
  const { app } = await import("../src/app");
  const { createAuthSession, destroyAuthSession, SESSION_COOKIE } = await import("../src/auth/store");
  const { db, now } = await import("../src/db");
  db.query("INSERT INTO passkeys (id, public_key, name, created_at) VALUES ('pk-projects', x'00', 'test', ?)").run(now());
  const token = createAuthSession("pk-projects", "test");
  const project = (await listLocalProjects()).find((p) => p.label === "a:b %")!;
  const url = `/api/projects/${encodeURIComponent(project.key)}/files`;
  const { listRecentProjects } = await import("../src/recent-projects");
  try {
    expect(listRecentProjects(await listLocalProjects())).toEqual([]);
    expect((await app.request(url)).status).toBe(401);
    const res = await app.request(url, { headers: { Cookie: `${SESSION_COOKIE}=${token}` } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ name: "README.md" }]);
    // Reopening a folder stays read-only and never adds a recent-session entry.
    expect((await app.request(url, { headers: { Cookie: `${SESSION_COOKIE}=${token}` } })).status).toBe(200);
    expect(listRecentProjects(await listLocalProjects())).toEqual([]);
  } finally {
    destroyAuthSession(token);
    db.query("DELETE FROM passkeys WHERE id = 'pk-projects'").run();
  }
});

test("remote shell scan matches local discovery and preserves unusual names", async () => {
  await Promise.all(["owner/repo/src", "other/repo", "tabs\tand\nlines", "node_modules/pkg", ".git/objects"].map(folder));
  const res = await runScript(null, REMOTE_SCAN + `scan ${shQuote(dir)} 0\n`);
  expect(res.code).toBe(0);
  const fields = res.stdout.split("\0");
  const rows = [];
  for (let i = 0; i + 3 < fields.length; i += 4) {
    rows.push({ relative: fields[i]!, path: fields[i + 1]!, mtime: Number(fields[i + 2]) });
    expect(fields[i + 3]).toBe("0");
  }
  const local = await scanLocalProjects([dir]);
  expect(rows.map((p) => p.relative).sort()).toEqual(local.map((p) => p.relativePath).sort());
  for (const row of rows) {
    expect(row.path).toBe(local.find((p) => p.relativePath === row.relative)!.path);
    expect(row.mtime).toBeGreaterThan(0);
  }
});

test("existing default configs migrate and persist while custom roots remain", async () => {
  const module = join(import.meta.dir, "../src/config.ts");
  for (const root of ["~/projects", "/home/haenah/projects", "/home/Developers", "/home/Developer", "/home/haenah/Developer", "/srv/custom"]) {
    const path = join(dir, "config.json");
    await writeFile(path, JSON.stringify({ projectsDirs: [root], permissionMode: "plan" }));
    const proc = Bun.spawn([process.execPath, "-e", `const {config} = await import(${JSON.stringify(module)}); console.log(JSON.stringify(config.projectsDirs));`], {
      env: { ...process.env, RCM_CONFIG: path }, stdout: "pipe", stderr: "pipe",
    });
    const output = await new Response(proc.stdout).text();
    expect(await proc.exited).toBe(0);
    const expected = ["/srv/custom", "/home/haenah/Developer"].includes(root) ? root : DEFAULT_PROJECTS_DIR;
    expect(JSON.parse(output)).toEqual([expected]);
    const saved = JSON.parse(await readFile(path, "utf8"));
    expect(saved.projectsDirs).toEqual([expected]);
    expect(saved.permissionMode).toBe("plan");
  }
});
