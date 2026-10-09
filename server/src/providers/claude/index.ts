import type { SessionProvider } from "../types";
import type { LiveSession, SessionAccess } from "../../../../shared/sessions";
import { acceptClaudeTrust } from "./trust";
import { HttpError } from "../../http";
import { providerStatus } from "../status";
import { pruneSessionLogs } from "./logs";
import { PERMISSION_MODES } from "../../config";
import { launchSession, stopSession } from "./launcher";
import {
  readHistory,
  readLiveSessions,
  type LiveSession as ClaudeSession,
} from "./state";

const access = (url: string | null): SessionAccess | null =>
  url ? { kind: "url", url, label: "Claude" } : null;
const descriptions: Record<string, string> = {
  default: "Ask before edits and commands",
  auto: "Claude decides, with safety checks for risky actions",
  acceptEdits: "Accept file edits automatically, ask for commands",
  dontAsk: "Deny actions that would require an approval prompt",
  plan: "Plan without making changes",
  bypassPermissions: "Skip Claude permission checks",
};
export function claudeLiveSession(s: ClaudeSession): LiveSession {
  return {
    id: String(s.pid),
    provider: "claude",
    host: s.host,
    cwd: s.cwd,
    kind: s.kind === "bridge" ? "bridge" : "session",
    name: s.name,
    title: s.title,
    conversationId: s.conversationId,
    access: access(s.url),
    newConversationAccess: access(s.envUrl),
    permissionMode: s.permissionMode,
    startedAt: s.startedAt,
    lastActivity: s.lastActivity,
    managed: s.managed,
    state: s.conversations.some((c) => c.status === "busy") ? "busy" : "idle",
    conversations: s.conversations.map((c) => ({
      id: c.id,
      access: access(c.url)!,
      status: c.status,
      title: c.title,
      updatedAt: c.updatedAt,
    })),
  };
}
export const claudeProvider: SessionProvider = {
  maintain: pruneSessionLogs,
  definition: {
    id: "claude",
    label: "Claude",
    icon: "anthropic",
    connectionLabel: "Claude",
    supportsPairing: false,
    stopLabel: "Stop",
    stopDescription:
      "The session disconnects. Its transcript stays, so it can be resumed later.",
    permissionFields: [
      {
        key: "mode",
        label: "Permission mode",
        defaultValue: "auto",
        options: PERMISSION_MODES.map((value) => ({
          value,
          label: value,
          description: descriptions[value]!,
        })),
      },
    ],
  },
  status(host) {
    return providerStatus(this.definition, host, "claude --version\n");
  },
  async launch(context) {
    await acceptClaudeTrust(context.host, context.projectPath);
    const result = await launchSession(context);
    return {
      provider: "claude",
      status: result.status,
      name: result.name,
      conversationId: result.conversationId,
      access: access(result.url),
      ...(result.error ? { error: result.error } : {}),
    };
  },
  async list(host) {
    return (await readLiveSessions(host)).map(claudeLiveSession);
  },
  async history(host, path) {
    const [past, live] = await Promise.all([
      readHistory(host, path),
      readLiveSessions(host),
    ]);
    const running = new Set(
      live.flatMap((s) => [
        s.conversationId,
        ...s.conversations.map((c) => c.id),
      ]),
    );
    return past.map((p) => ({
      ...p,
      provider: "claude",
      live: running.has(p.id),
    }));
  },
  async stop(host, id) {
    if (
      !/^\d+$/.test(id) ||
      !Number.isSafeInteger(Number(id)) ||
      Number(id) <= 0
    )
      throw new HttpError(422, "Invalid Claude session id");
    await stopSession(host, Number(id));
  },
};
