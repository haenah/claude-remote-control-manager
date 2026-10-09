/**
 * Project discovery — directories under each configured root are scanned
 * recursively. Local dirs are read directly; remote hosts get the same scan run
 * on the far end in a single ssh round trip.
 */

import { mkdir, readdir, realpath, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { config, expandHome, type RemoteHost } from "./config";
import { HostUnreachable, findHost, makeKey, runScript, shPath, shQuote, splitKey } from "./hosts";
import { HttpError } from "./http";

export interface Project {
  /** Relative directory path, prefixed by the host for remote projects. */
  key: string;
  /** Bare directory name, for display. */
  label: string;
  /** Host name, or '' for this machine. */
  host: string;
  /** Absolute physical path on its own host — what a process's cwd reads as. */
  path: string;
  /** Directory mtime in epoch seconds, for "recent" sorting. */
  mtime: number;
  /** Configured scan root, for grouping the filesystem tree. */
  root: string;
  relativePath: string;
}

export interface HostStatus {
  name: string;
  ssh: string;
  projectsDirs: string[];
  online: boolean;
  error: string | null;
}

// Keep dependency trees and hidden metadata out of recursive discovery.
const SKIP_DIRS = new Set(["node_modules", "__pycache__"]);
const visibleDir = (name: string) => !name.startsWith(".") && !SKIP_DIRS.has(name);

function directoryKey(relativePath: string, rootIndex: number): string {
  // Escape separators reserved for remote keys and multiple scan roots.
  const name = relativePath.split("/").map(encodeURIComponent).join("/");
  return rootIndex === 0 ? name : `@${rootIndex}/${name}`;
}

export async function scanLocalProjects(roots: string[]): Promise<Project[]> {
  const out: Project[] = [];
  const seen = new Set<string>();
  for (const [rootIndex, dir] of roots.entries()) {
    const root = expandHome(dir);
    async function walk(parent: string, prefix = ""): Promise<void> {
      let entries;
      try {
        entries = await readdir(parent, { withFileTypes: true });
      } catch {
        return; // Missing roots or unreadable directories don't hide other projects.
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const e of entries) {
        if (!e.isDirectory() || !visibleDir(e.name)) continue;
        const directory = join(parent, e.name);
        const relativePath = prefix ? `${prefix}/${e.name}` : e.name;
        try {
          const path = await realpath(directory);
          if (seen.has(path)) continue;
          seen.add(path);
          out.push({
            key: directoryKey(relativePath, rootIndex), label: e.name, host: "", path,
            mtime: (await stat(path)).mtimeMs / 1000, root: dir, relativePath,
          });
          await walk(directory, relativePath);
        } catch {
          // Vanished between readdir and stat.
        }
      }
    }
    await walk(root);
  }
  return out;
}

let localScan: { roots: string; at: number; projects: Promise<Project[]> } | undefined;

export function listLocalProjects(): Promise<Project[]> {
  const roots = JSON.stringify(config.projectsDirs);
  if (!localScan || localScan.roots !== roots || Date.now() - localScan.at >= SCAN_TTL_MS) {
    localScan = { roots, at: Date.now(), projects: scanLocalProjects(config.projectsDirs) };
  }
  return localScan.projects;
}

// ---------------------------------------------------------------------------
// Remote hosts
// ---------------------------------------------------------------------------

// NUL framing preserves spaces, tabs and newlines in directory names.
export const REMOTE_SCAN = `scan() (
  cd "$1" 2>/dev/null || return 0
  find . -mindepth 1 -type d \\( -name '.*' -o -name node_modules -o -name __pycache__ \\) -prune -o -type d -print0 2>/dev/null |
  while IFS= read -r -d '' d; do
    relative=\${d#./}
    physical=$(cd "$d" && pwd -P) || continue
    mtime=$(stat -c %Y "$d" 2>/dev/null || stat -f %m "$d" 2>/dev/null || echo 0)
    printf '%s\\0%s\\0%s\\0%s\\0' "$relative" "$physical" "$mtime" "$2"
  done
)
`;

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
  const script = REMOTE_SCAN + host.projectsDirs.map((d, i) => `scan ${shPath(d)} ${i}\n`).join("");
  const res = await runScript(host, script, 25_000);
  if (res.code !== 0) {
    throw new HostUnreachable(
      `scanning ${host.projectsDirs.join(", ")} on ${host.name} failed: ${res.stderr.trim() || `exit ${res.code}`}`,
    );
  }
  const seen = new Set<string>();
  const out: Project[] = [];
  const fields = res.stdout.split("\0");
  for (let i = 0; i + 3 < fields.length; i += 4) {
    const relativePath = fields[i]!;
    const path = fields[i + 1]!;
    const rootIndex = Number(fields[i + 3]);
    if (!relativePath || !path || seen.has(path)) continue;
    seen.add(path);
    out.push({
      key: makeKey(host.name, directoryKey(relativePath, rootIndex)),
      label: basename(relativePath), host: host.name, path,
      mtime: Number(fields[i + 2]) || 0,
      root: host.projectsDirs[rootIndex]!, relativePath,
    });
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
  if (!name) localScan = undefined;
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
  const p = projects.find((x) => x.key === key);
  if (!p) throw new HttpError(404, `Project '${key}' not found on ${host.name}`);
  return { host, path: p.path, label: p.label };
}

export interface ProjectFile {
  name: string;
}

/** Read file names only, when a directory is expanded in the tree. */
export async function listProjectFiles(key: string): Promise<ProjectFile[]> {
  const { host, path } = await resolveProject(key);
  let names: string[];
  if (host) {
    const res = await runScript(host, `cd ${shQuote(path)} || exit 1
shopt -s nullglob dotglob
for f in *; do
  if [ -f "$f" ] && [ ! -L "$f" ]; then printf '%s\\0' "$f"; fi
done
`).catch((e) => { throw new HttpError(502, (e as Error).message); });
    if (res.code !== 0) throw new HttpError(502, `Could not read files on ${host.name}`);
    names = res.stdout.split("\0").filter(Boolean);
  } else {
    try {
      names = (await readdir(path, { withFileTypes: true })).filter((e) => e.isFile()).map((e) => e.name);
    } catch {
      throw new HttpError(404, "Directory is no longer readable");
    }
  }
  return names.sort((a, b) => a.localeCompare(b)).map((name) => ({ name }));
}

const PROJECT_NAME = /^[A-Za-z0-9_.-]+$/;

/** Create an empty project directory in the first projects dir of *host*. */
export async function createProject(name: string, host: RemoteHost | null): Promise<Project> {
  if (!PROJECT_NAME.test(name) || !visibleDir(name)) throw new HttpError(422, "Invalid project name");
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
    return { key: makeKey(host.name, directoryKey(name, 0)), label: name, host: host.name, path: out.slice(7), mtime: Date.now() / 1000, root: base, relativePath: name };
  }
  const root = expandHome(base);
  await mkdir(root, { recursive: true });
  const path = join(root, name);
  try {
    await mkdir(path);
  } catch {
    throw new HttpError(409, `Project '${name}' already exists`);
  }
  localScan = undefined;
  return { key: name, label: name, host: "", path: await realpath(path), mtime: Date.now() / 1000, root: base, relativePath: name };
}
