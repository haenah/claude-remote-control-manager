/**
 * Config for rcm, stored as JSON at ~/.config/rcm/config.json (or $RCM_CONFIG).
 *
 * The file is created with defaults on first run. Settings edited from the UI
 * (permission mode, project dirs, hosts) are written back here and applied to
 * the live `config` object immediately — no restart.
 */

import { mkdirSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const PERMISSION_MODES = [
  "default",
  "auto",
  "acceptEdits",
  "dontAsk",
  "plan",
  "bypassPermissions",
] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

/** A machine reachable over ssh whose projects rcm also manages. */
export interface RemoteHost {
  /** Label in the UI; also the prefix in project keys ("stardust:myrepo"). */
  name: string;
  /** ssh destination — user@host, or an alias from ~/.ssh/config. */
  ssh: string;
  /** Directories scanned on that machine. Kept verbatim so `~` expands over there. */
  projectsDirs: string[];
}

export interface AuthConfig {
  /** Shown by the OS passkey prompt. */
  rpName: string;
  /**
   * Origins the UI may be served from. The WebAuthn RP ID is the hostname of
   * whichever one a request comes from, and every state-changing request must
   * carry one of these as its Origin header.
   */
  origins: string[];
  /** Login lifetime; refreshed while in use. */
  sessionDays: number;
}

export interface Config {
  /** Local roots scanned recursively for project directories. */
  projectsDirs: string[];
  /** Bind address. Loopback by default: a reverse proxy terminates TLS in front. */
  host: string;
  port: number;
  /** Holds the SQLite db and session logs. */
  dataDir: string;
  permissionMode: PermissionMode;
  hosts: RemoteHost[];
  auth: AuthConfig;
}

export const DEFAULT_PORT = 8742;
export const DEFAULT_PROJECTS_DIR = "/home/Developer";

export const CONFIG_PATH = process.env.RCM_CONFIG
  ? resolve(process.env.RCM_CONFIG)
  : join(homedir(), ".config", "rcm", "config.json");

function defaults(): Config {
  return {
    projectsDirs: [DEFAULT_PROJECTS_DIR],
    host: "127.0.0.1",
    port: DEFAULT_PORT,
    dataDir: "~/.config/rcm",
    permissionMode: "auto",
    hosts: [],
    auth: {
      rpName: "rc manager",
      origins: [
        "https://claude.haenah.com",
        `http://localhost:${DEFAULT_PORT}`,
        "http://localhost:5743",
      ],
      sessionDays: 30,
    },
  };
}

export function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

/** Validate a host entry; returns an error message, or null when it is usable. */
export function hostError(h: RemoteHost): string | null {
  if (!h.name || !h.ssh) return "host needs both a name and an ssh destination";
  // ':' separates host from project in a key, and '/' would break the URL
  // path segment that keys travel in.
  if (/[:/]/.test(h.name)) return "host name may not contain ':' or '/'";
  if (!h.projectsDirs.length) return "at least one projects directory is required";
  return null;
}

function normalize(raw: Partial<Config>): Config {
  const d = defaults();
  const mode = PERMISSION_MODES.includes(raw.permissionMode as PermissionMode)
    ? (raw.permissionMode as PermissionMode)
    : d.permissionMode;
  const seen = new Set<string>();
  const hosts: RemoteHost[] = [];
  for (const h of raw.hosts ?? []) {
    const host = {
      name: String(h?.name ?? "").trim(),
      ssh: String(h?.ssh ?? "").trim(),
      projectsDirs: (h?.projectsDirs ?? []).map((x) => String(x).trim()).filter(Boolean),
    };
    const err = hostError(host) ?? (seen.has(host.name) ? "duplicate host name" : null);
    if (err) {
      // A typo in one host must not take the app down for every other project.
      console.warn(`config: ignoring host ${JSON.stringify(h)}: ${err}`);
      continue;
    }
    seen.add(host.name);
    hosts.push(host);
  }
  return {
    projectsDirs: raw.projectsDirs?.length ? raw.projectsDirs.map(String) : d.projectsDirs,
    host: raw.host ?? d.host,
    port: Number(raw.port ?? d.port),
    dataDir: raw.dataDir ?? d.dataDir,
    permissionMode: mode,
    hosts,
    auth: {
      rpName: raw.auth?.rpName ?? d.auth.rpName,
      origins: raw.auth?.origins?.length ? raw.auth.origins : d.auth.origins,
      sessionDays: Number(raw.auth?.sessionDays ?? d.auth.sessionDays),
    },
  };
}

function load(): Config {
  if (!existsSync(CONFIG_PATH)) {
    const cfg = defaults();
    write(cfg);
    console.info(`created config at ${CONFIG_PATH}`);
    return cfg;
  }
  const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Partial<Config>;
  // Move the former default on existing installs as well as on first run.
  const legacy = raw.projectsDirs?.length === 1 &&
    ["~/projects", expandHome("~/projects"), "/home/haenah/projects", "/home/Developers"].includes(raw.projectsDirs[0]!);
  if (legacy) raw.projectsDirs = [DEFAULT_PROJECTS_DIR];
  const cfg = normalize(raw);
  if (legacy) write(cfg);
  return cfg;
}

function write(cfg: Config): void {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  const tmp = `${CONFIG_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, CONFIG_PATH);
}

/** The live config. Routes, the watchdog and session code all read this object. */
export const config: Config = load();

/** Apply *patch* to the live config and persist it. */
export function updateConfig(patch: Partial<Config>): void {
  Object.assign(config, patch);
  write(config);
}

export const dataDir = () => expandHome(config.dataDir);
export const sessionLogDir = () => join(dataDir(), "sessions");
export const dbPath = () => join(dataDir(), "rcm.db");
