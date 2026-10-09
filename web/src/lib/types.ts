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

export type { ChildSession, LiveSession, PastConversation, StartResult, SessionAccess, ProviderId, ProviderDefinition, ProviderStatus, PairingResult } from "../../../shared/sessions";
import type { LiveSession } from "../../../shared/sessions";

export interface Overview {
  projects: Project[];
  recentProjects: RecentProject[];
  hosts: HostStatus[];
  sessions: LiveSession[];
  permissionMode: string;
}

export interface Info {
  version: string;
  hostname: string;
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
