import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { dbPath } from "../src/config";
import { db } from "../src/db";
import type { Project } from "../src/projects";
import { listRecentProjects, rememberSessionStart } from "../src/recent-projects";
import type { StartResult } from "../../shared/sessions";

const host = "test-recent";
const running: StartResult = { provider: "claude", status: "running", access: { kind: "url", url: "https://claude.ai/code/session_fixture", label: "Claude" }, name: "test", conversationId: "fixture" };
const failed: StartResult = { ...running, status: "failed", access: null };
const firstAt = "2026-10-09T01:00:00.000Z";
const nextAt = "2026-10-09T02:00:00.000Z";
const latestAt = "2026-10-09T03:00:00.000Z";

function project(name: string): Project {
  return { key: `${host}:${name}`, label: name, host, path: `/fixture/${name}`, root: "/fixture", relativePath: name, mtime: Date.now() / 1000 };
}

afterEach(() => {
  db.query("DELETE FROM recent_projects WHERE host = ? OR host = ?").run(host, `${host}-other`);
});

test("new directory mtimes and failed starts do not populate recents", () => {
  const p = project("untouched");
  expect(listRecentProjects([p])).toEqual([]);
  rememberSessionStart(host, p.path, latestAt, failed);
  expect(listRecentProjects([p])).toEqual([]);
});

test("successful starts and resumes keep one entry per directory in start-time order", () => {
  const a = project("a");
  const b = project("b");
  rememberSessionStart(host, a.path, firstAt, running);
  rememberSessionStart(host, b.path, nextAt, running);
  expect(listRecentProjects([a, b]).map((p) => p.key)).toEqual([b.key, a.key]);
  rememberSessionStart(host, a.path, latestAt, running);
  expect(listRecentProjects([a, b]).map((p) => [p.key, p.lastStartedAt])).toEqual([[a.key, latestAt], [b.key, nextAt]]);
  rememberSessionStart(host, b.path, latestAt, failed);
  expect(listRecentProjects([a, b]).map((p) => p.key)).toEqual([a.key, b.key]);
});

test("a slow older start cannot replace a newer start and recents survive a database reopen", () => {
  const p = project("concurrent");
  rememberSessionStart(host, p.path, latestAt, running);
  rememberSessionStart(host, p.path, firstAt, running);
  const reopened = new Database(dbPath(), { readonly: true });
  try {
    expect(reopened.query("SELECT last_started_at FROM recent_projects WHERE host = ? AND path = ?").get(host, p.path)).toEqual({ last_started_at: latestAt });
  } finally {
    reopened.close();
  }
  expect(listRecentProjects([{ ...p, key: "changed-root-key" }])[0]?.lastStartedAt).toBe(latestAt);
});

test("matching paths on different hosts stay distinct and unavailable directories are omitted", () => {
  const a = project("same");
  const b = { ...a, host: `${host}-other`, key: `${host}-other:same` };
  rememberSessionStart(a.host, a.path, firstAt, running);
  rememberSessionStart(b.host, b.path, nextAt, running);
  rememberSessionStart(host, "/fixture/removed", latestAt, running);
  expect(listRecentProjects([a, b]).map((p) => p.key)).toEqual([b.key, a.key]);
});

test("existing running sessions use their start time and do not duplicate remembered directories", () => {
  const a = project("active");
  const b = project("remembered");
  rememberSessionStart(host, a.path, firstAt, running);
  rememberSessionStart(host, b.path, nextAt, running);
  const live = [
    { host, cwd: a.path, startedAt: latestAt },
    { host, cwd: a.path, startedAt: nextAt },
    { host, cwd: "/fixture/outside", startedAt: latestAt },
    { host, cwd: b.path, startedAt: null },
  ];
  expect(listRecentProjects([a, b], live).map((p) => [p.key, p.lastStartedAt])).toEqual([[a.key, latestAt], [b.key, nextAt]]);
});
