export interface Project {
  key: string;
  label: string;
  host: string;
  path: string;
  mtime: number;
  root: string;
  relativePath: string;
}

export interface ProjectFile {
  name: string;
}

export interface RecentProject extends Project {
  lastStartedAt: string;
}

export interface HostStatus {
  name: string;
  ssh: string;
  projectsDirs: string[];
  online: boolean;
  error: string | null;
}

/** A running Remote Control process, read from the host — rcm stores none of this. */
export interface LiveSession {
  host: string;
  pid: number;
  cwd: string;
  /** Project key, when cwd is one of the listed projects. */
  project: string | null;
  name: string | null;
  title: string | null;
  conversationId: string | null;
  url: string | null;
  permissionMode: string | null;
  startedAt: string | null;
  lastActivity: string | null;
  /** Started from rcm (vs. a terminal elsewhere). */
  managed: boolean;
}

export interface Overview {
  projects: Project[];
  recentProjects: RecentProject[];
  hosts: HostStatus[];
  sessions: LiveSession[];
  permissionMode: string;
}

/** A past conversation, from its transcript. */
export interface PastConversation {
  id: string;
  title: string | null;
  firstPrompt: string | null;
  startedAt: string | null;
  updatedAt: string;
  bytes: number;
  live: boolean;
}

export interface StartResult {
  status: "running" | "failed";
  url: string | null;
  name: string;
  conversationId: string;
  error?: string;
}

export interface Info {
  version: string;
  hostname: string;
  claudeVersion: string | null;
}

export interface Settings {
  projectsDirs: string[];
  permissionMode: string;
  permissionModes: string[];
}

export interface Passkey {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  backedUp: boolean;
  current: boolean;
}
