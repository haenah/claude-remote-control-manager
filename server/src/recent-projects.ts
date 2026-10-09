import { db } from "./db";
import type { LiveSession } from "./claude-state";
import type { Project } from "./projects";
import type { StartResult } from "./sessions";

export interface RecentProject extends Project {
  lastStartedAt: string;
}

/** Browsing, failed starts and opening the project sheet never call this. */
export function rememberSessionStart(host: string, path: string, startedAt: string, result: StartResult): void {
  if (result.status !== "running") return;
  db.query(`
    INSERT INTO recent_projects (host, path, last_started_at) VALUES (?, ?, ?)
    ON CONFLICT (host, path) DO UPDATE SET
      last_started_at = MAX(recent_projects.last_started_at, excluded.last_started_at)
  `).run(host, path, startedAt);
}

/** One entry per directory, including sessions already running before an update. */
export function listRecentProjects(
  projects: Project[],
  sessions: Pick<LiveSession, "host" | "cwd" | "startedAt">[] = [],
): RecentProject[] {
  const timestamps = new Map<string, string>();
  const identity = (host: string, path: string) => JSON.stringify([host, path]);
  const add = (host: string, path: string, at: string | null) => {
    if (!at || !Number.isFinite(Date.parse(at))) return;
    const key = identity(host, path);
    const previous = timestamps.get(key);
    if (!previous || Date.parse(at) > Date.parse(previous)) timestamps.set(key, at);
  };
  for (const row of db.query<{ host: string; path: string; last_started_at: string }, []>(
    "SELECT host, path, last_started_at FROM recent_projects",
  ).all()) add(row.host, row.path, row.last_started_at);
  for (const session of sessions) add(session.host, session.cwd, session.startedAt);

  return projects.flatMap((project) => {
    const lastStartedAt = timestamps.get(identity(project.host, project.path));
    return lastStartedAt ? [{ ...project, lastStartedAt }] : [];
  }).sort((a, b) => Date.parse(b.lastStartedAt) - Date.parse(a.lastStartedAt) || a.path.localeCompare(b.path));
}
