/**
 * Project discovery — every immediate subdirectory of a projects dir is a
 * project. Local dirs are read directly; remote hosts get the same scan run
 * on the far end in a single ssh round trip.
 */

import { mkdir, readdir, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import { config, expandHome, type RemoteHost } from "./config";
import { HostUnreachable, findHost, makeKey, runScript, shPath, shQuote, splitKey } from "./hosts";
import { HttpError } from "./http";

export interface Project {
  /** 'myrepo' locally, 'stardust:myrepo' on a remote host. */
  key: string;
  /** Bare directory name, for display. */
  label: string;
  /** Host name, or '' for this machine. */
  host: string;
  /** Absolute physical path on its own host — what a process's cwd reads as. */
  path: string;
  /** Directory mtime in epoch seconds, for "recent" sorting. */
  mtime: number;
}

export interface HostStatus {
  name: string;
  ssh: string;
  projectsDirs: string[];
  online: boolean;
  error: string | null;
}

async function scanLocalDir(dir: string): Promise<Project[]> {
  const root = expandHome(dir);
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: Project[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith(".")) continue;
    const path = join(root, e.name);
    try {
      out.push({
        key: e.name,
        label: e.name,
        host: "",
        path: await realpath(path),
        mtime: (await stat(path)).mtimeMs / 1000,
      });
    } catch {
      // Vanished between readdir and stat.
    }
  }
  return out;
}

export async function listLocalProjects(): Promise<Project[]> {
  const seen = new Set<string>();
  const out: Project[] = [];
  for (const dir of config.projectsDirs) {
    for (const p of await scanLocalDir(dir)) {
      // Two roots holding the same name: the key can only point at one, so the
      // earlier root wins.
      if (seen.has(p.key)) continue;
      seen.add(p.key);
      out.push(p);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Remote hosts
// ---------------------------------------------------------------------------

// A plain string, not a template: the shell's ${d%/} must reach bash untouched.
const REMOTE_SCAN = [
  "scan() (",
  '  cd "$1" 2>/dev/null || return 0',
  "  for d in */; do",
  "    d=${d%/}",
  '    case "$d" in .*) continue;; esac',
  '    [ -d "$d" ] || continue',
  `    printf '%s\\t%s\\t%s\\n' "$d" "$(cd "$d" && pwd -P)" "$(stat -c %Y "$d" 2>/dev/null || echo 0)"`,
  "  done",
  ")",
  "",
].join("\n");

/**
 * Remote scans are re-run at most this often. The UI refreshes the project
 * list after most actions, and a few seconds of staleness is invisible.
 */
const SCAN_TTL_MS = 15_000;
const scanCache = new Map<string, { at: number; projects: Project[] }>();
/**
 * One in-flight scan per host: a burst of requests right after the cache
 * expires shares one ssh call instead of each paying for its own.
 */
const inflight = new Map<string, Promise<Project[]>>();

async function scanHost(host: RemoteHost): Promise<Project[]> {
  const script = REMOTE_SCAN + host.projectsDirs.map((d) => `scan ${shPath(d)}\n`).join("");
  const res = await runScript(host, script, 25_000);
  if (res.code !== 0) {
    throw new HostUnreachable(
      `scanning ${host.projectsDirs.join(", ")} on ${host.name} failed: ${res.stderr.trim() || `exit ${res.code}`}`,
    );
  }
  const seen = new Set<string>();
  const out: Project[] = [];
  for (const line of res.stdout.split("\n")) {
    const [label, path, mtime] = line.split("\t");
    if (!label || !path || seen.has(label)) continue;
    seen.add(label);
    out.push({ key: makeKey(host.name, label), label, host: host.name, path, mtime: Number(mtime) || 0 });
  }
  scanCache.set(host.name, { at: Date.now(), projects: out });
  return out;
}

/** Projects on *host*. Throws HostUnreachable if ssh fails. */
export function listHostProjects(host: RemoteHost, useCache = true): Promise<Project[]> {
  const hit = scanCache.get(host.name);
  if (useCache && hit && Date.now() - hit.at < SCAN_TTL_MS) return Promise.resolve(hit.projects);
  let p = inflight.get(host.name);
  if (!p) {
    p = scanHost(host).finally(() => inflight.delete(host.name));
    inflight.set(host.name, p);
  }
  return p;
}

export function invalidateHostCache(name?: string): void {
  if (name) scanCache.delete(name);
  else scanCache.clear();
}

/**
 * Local projects plus every configured host's, along with each host's status.
 * An unreachable host contributes no projects rather than failing the list —
 * local projects and every other host stay usable.
 */
export async function listAllProjects(): Promise<{ projects: Project[]; hosts: HostStatus[] }> {
  const [local, ...remote] = await Promise.allSettled([
    listLocalProjects(),
    ...config.hosts.map((h) => listHostProjects(h)),
  ]);
  const projects = local.status === "fulfilled" ? [...local.value] : [];
  const hosts: HostStatus[] = config.hosts.map((h, i) => {
    const r = remote[i]!;
    if (r.status === "fulfilled") projects.push(...r.value);
    return {
      name: h.name,
      ssh: h.ssh,
      projectsDirs: h.projectsDirs,
      online: r.status === "fulfilled",
      error: r.status === "rejected" ? String((r.reason as Error).message ?? r.reason) : null,
    };
  });
  return { projects, hosts };
}

/**
 * Resolve a project key to its host and path. 404 for an unknown project, 502
 * when its host is unreachable — acting on a stale path, or silently on the
 * wrong machine, would be worse than failing.
 */
export async function resolveProject(key: string): Promise<{ host: RemoteHost | null; path: string; label: string }> {
  const [hostName, name] = splitKey(key);
  if (!hostName) {
    const p = (await listLocalProjects()).find((x) => x.key === name);
    if (!p) throw new HttpError(404, `Project '${key}' not found`);
    return { host: null, path: p.path, label: p.label };
  }
  const host = findHost(hostName);
  if (!host) throw new HttpError(404, `Host '${hostName}' is not configured`);
  let projects: Project[];
  try {
    projects = await listHostProjects(host);
  } catch (e) {
    throw new HttpError(502, `Host '${host.name}' is unreachable: ${(e as Error).message}`);
  }
  const p = projects.find((x) => x.label === name);
  if (!p) throw new HttpError(404, `Project '${key}' not found on ${host.name}`);
  return { host, path: p.path, label: p.label };
}

const PROJECT_NAME = /^[A-Za-z0-9_.-]+$/;

/** Create an empty project directory in the first projects dir of *host*. */
export async function createProject(name: string, host: RemoteHost | null): Promise<Project> {
  if (!PROJECT_NAME.test(name) || name.startsWith(".")) throw new HttpError(422, "Invalid project name");
  const base = host ? host.projectsDirs[0]! : config.projectsDirs[0]!;
  if (host) {
    const target = `${shPath(base)}/${shQuote(name)}`;
    const res = await runScript(
      host,
      `mkdir -p ${shPath(base)} || exit 1
if [ -e ${target} ]; then printf 'RCM_EXISTS\\n'; exit 0; fi
mkdir ${target} || exit 1
printf 'RCM_OK %s\\n' "$(cd ${target} && pwd)"
`,
    ).catch((e) => {
      throw new HttpError(502, (e as Error).message);
    });
    const out = res.stdout.trim();
    if (out.startsWith("RCM_EXISTS")) throw new HttpError(409, `Project '${name}' already exists on ${host.name}`);
    if (!out.startsWith("RCM_OK")) {
      throw new HttpError(500, `Could not create '${name}' on ${host.name}: ${res.stderr.trim() || "unknown error"}`);
    }
    invalidateHostCache(host.name);
    return { key: makeKey(host.name, name), label: name, host: host.name, path: out.slice(7), mtime: Date.now() / 1000 };
  }
  const root = expandHome(base);
  await mkdir(root, { recursive: true });
  const path = join(root, name);
  try {
    await mkdir(path);
  } catch {
    throw new HttpError(409, `Project '${name}' already exists`);
  }
  return { key: name, label: name, host: "", path: await realpath(path), mtime: Date.now() / 1000 };
}
