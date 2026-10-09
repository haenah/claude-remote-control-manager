import type { RemoteHost } from "../config";
import { runScript } from "../hosts";
import type {
  ProviderDefinition,
  ProviderStatus,
} from "../../../shared/sessions";

const cache = new Map<
  string,
  { at: number; pending: Promise<ProviderStatus> }
>();
export function providerStatus(
  definition: ProviderDefinition,
  host: RemoteHost | null,
  command: string,
): Promise<ProviderStatus> {
  const key = JSON.stringify([definition.id, host?.ssh ?? "local"]);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 30_000) return hit.pending;
  const pending = (async () => {
    try {
      const result = await runScript(host, command, 10_000);
      const version =
        result.code === 0 ? result.stdout.trim().split("\n")[0] || null : null;
      return {
        ...definition,
        version,
        available: !!version,
        error: version
          ? null
          : `Install the current ${definition.label} CLI and sign in on ${host?.name ?? "this host"}.`,
      };
    } catch (e) {
      return {
        ...definition,
        version: null,
        available: false,
        error: (e as Error).message,
      };
    }
  })();
  cache.set(key, { at: Date.now(), pending });
  return pending;
}
