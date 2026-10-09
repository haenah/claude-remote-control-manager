/** Provider-neutral session orchestration. Native behavior lives in adapters. */
import type { RemoteHost } from "./config";
import { HttpError } from "./http";
import { rememberSessionStart } from "./recent-projects";
import { providers } from "./providers";
import type { LaunchContext, SessionProvider } from "./providers/types";
import type {
  ProviderId,
  StartResult,
  PermissionValues,
  ProviderPermissionSettings,
} from "../../shared/sessions";

export function createSessionService(adapters: SessionProvider[]) {
  const registry = new Map(adapters.map((p) => [p.definition.id, p]));
  function provider(id: unknown): SessionProvider {
    const found = registry.get(id as ProviderId);
    if (!found) throw new HttpError(422, "Unknown session provider");
    return found;
  }
  function permissionValues(
    id: unknown,
    values: PermissionValues = {},
    strict = false,
  ): PermissionValues {
    const fields = provider(id).definition.permissionFields;
    if (!values || typeof values !== "object" || Array.isArray(values))
      throw new HttpError(422, "Permission settings must be an object");
    if (
      strict &&
      Object.keys(values).some((key) => !fields.some((f) => f.key === key))
    )
      throw new HttpError(422, "Unknown permission setting for this provider");
    return Object.fromEntries(
      fields.map((field) => {
        const value = values[field.key] ?? field.defaultValue;
        if (!field.options.some((option) => option.value === value)) {
          if (strict)
            throw new HttpError(
              422,
              `Unknown ${field.label} for this provider`,
            );
          return [field.key, field.defaultValue];
        }
        return [field.key, value];
      }),
    );
  }
  return {
    definitions: adapters.map((p) => p.definition),
    permissionValues,
    permissionSettings(
      values: Record<string, PermissionValues>,
    ): ProviderPermissionSettings[] {
      return adapters.map((p) => ({
        provider: p.definition.id,
        label: p.definition.label,
        fields: p.definition.permissionFields,
        values: permissionValues(p.definition.id, values[p.definition.id]),
      }));
    },
    async maintain() {
      await Promise.allSettled(
        adapters.filter((p) => p.maintain).map((p) => p.maintain!()),
      );
    },
    status(host: RemoteHost | null) {
      return Promise.all(adapters.map((p) => p.status(host)));
    },
    async list(host: RemoteHost | null) {
      const results = await Promise.allSettled(
        adapters.map((p) => p.list(host)),
      );
      return results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
    },
    history(id: unknown, host: RemoteHost | null, path: string) {
      return provider(id).history(host, path);
    },
    async launch(id: unknown, context: LaunchContext): Promise<StartResult> {
      const adapter = provider(id);
      context = {
        ...context,
        permissions: permissionValues(id, context.permissions, true),
      };
      if (context.resume) {
        if (
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
            context.resume,
          )
        )
          throw new HttpError(422, "Invalid conversation id");
        const history = await adapter.history(
          context.host,
          context.projectPath,
        );
        const conversation = history.find((c) => c.id === context.resume);
        if (!conversation)
          throw new HttpError(
            404,
            "Conversation not found in this directory for this provider",
          );
        if (conversation.live)
          throw new HttpError(409, "This conversation is already running");
        context = {
          ...context,
          resumeArchived: conversation.archived ?? false,
          name: context.name || conversation.title || "Session",
        };
      }
      const startedAt = new Date().toISOString();
      let result: StartResult;
      try {
        result = await adapter.launch(context);
      } catch (e) {
        result = {
          provider: adapter.definition.id,
          status: "failed",
          access: null,
          name: context.name,
          conversationId: context.resume ?? "",
          error: (e as Error).message,
        };
      }
      rememberSessionStart(
        context.host?.name ?? "",
        context.projectPath,
        startedAt,
        result,
      );
      return result;
    },
    stop(id: unknown, host: RemoteHost | null, sessionId: string) {
      return provider(id).stop(host, sessionId);
    },
    pair(id: unknown, host: RemoteHost | null) {
      const adapter = provider(id);
      if (!adapter.pair)
        throw new HttpError(
          422,
          `${adapter.definition.label} does not use device pairing`,
        );
      return adapter.pair(host);
    },
  };
}

export const sessionService = createSessionService(providers);
