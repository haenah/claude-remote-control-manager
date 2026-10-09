/** Serializable session contract shared by the API and web UI. */
export type ProviderId = "claude" | "codex";

export interface ProviderDefinition {
  id: ProviderId;
  label: string;
  icon: "anthropic" | "chatgpt";
  connectionLabel: string;
  supportsPairing: boolean;
  stopLabel: string;
  stopDescription: string;
}

export interface ProviderStatus extends ProviderDefinition {
  version: string | null;
  available: boolean;
  error: string | null;
}

export type SessionAccess =
  | { kind: "url"; url: string; label: string }
  | {
      kind: "remote";
      connectionName: string;
      environmentId: string | null;
      supportsPairing: boolean;
    };

export interface ChildSession {
  id: string;
  access: SessionAccess;
  status: string | null;
  title: string | null;
  updatedAt: string | null;
}

export interface LiveSession {
  id: string;
  provider: ProviderId;
  host: string;
  cwd: string;
  project?: string | null;
  kind: "session" | "bridge";
  name: string | null;
  title: string | null;
  conversationId: string | null;
  access: SessionAccess | null;
  newConversationAccess: SessionAccess | null;
  permissionMode: string | null;
  startedAt: string | null;
  lastActivity: string | null;
  managed: boolean;
  state: "idle" | "busy" | "error";
  conversations: ChildSession[];
}

export interface PastConversation {
  provider: ProviderId;
  id: string;
  title: string | null;
  firstPrompt: string | null;
  startedAt: string | null;
  updatedAt: string;
  bytes: number | null;
  live: boolean;
  archived?: boolean;
}

export interface StartResult {
  provider: ProviderId;
  status: "running" | "failed";
  access: SessionAccess | null;
  name: string;
  conversationId: string;
  error?: string;
}

export interface PairingResult {
  manualPairingCode: string;
  expiresAt: number;
}
