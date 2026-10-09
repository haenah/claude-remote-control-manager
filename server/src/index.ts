import { app } from "./app";
import { ensureBootstrapToken } from "./auth/store";
import { CONFIG_PATH, config, dataDir } from "./config";
import { startHousekeeping } from "./watchdog";

ensureBootstrapToken();
const stopHousekeeping = startHousekeeping();

const server = Bun.serve({
  hostname: config.host,
  port: config.port,
  fetch: app.fetch,
  // Starting a session waits up to a minute for claude to print its URL.
  idleTimeout: 120,
});

console.info(`rcm listening on http://${server.hostname}:${server.port}`);
console.info(`config ${CONFIG_PATH} · data ${dataDir()} · origins ${config.auth.origins.join(", ")}`);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    // Sessions are deliberately left running — they outlive the server.
    stopHousekeeping();
    server.stop();
    process.exit(0);
  });
}
