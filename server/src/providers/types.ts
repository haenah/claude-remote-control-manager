import type { PermissionMode, RemoteHost } from "../config";
import type {
  LiveSession,
  PairingResult,
  PastConversation,
  ProviderDefinition,
  ProviderStatus,
  StartResult,
} from "../../../shared/sessions";

export interface LaunchContext {
  host: RemoteHost | null;
  projectPath: string;
  name: string;
  permissionMode: PermissionMode;
  resume?: string;
  resumeArchived?: boolean;
}

/** Every provider owns its native lifecycle and converts it at this boundary. */
export interface SessionProvider {
  definition: ProviderDefinition;
  status(host: RemoteHost | null): Promise<ProviderStatus>;
  launch(context: LaunchContext): Promise<StartResult>;
  list(host: RemoteHost | null): Promise<LiveSession[]>;
  history(host: RemoteHost | null, path: string): Promise<PastConversation[]>;
  stop(host: RemoteHost | null, sessionId: string): Promise<void>;
  pair?(host: RemoteHost | null): Promise<PairingResult>;
  maintain?(): Promise<unknown>;
}
