import type { SessionProvider } from "../types";
import { providerStatus } from "../status";
import { HttpError } from "../../http";
import { createCodexLifecycle } from "./lifecycle";

const lifecycle = createCodexLifecycle();

export const codexProvider: SessionProvider = {
  definition: {
    id: "codex",
    label: "Codex",
    icon: "chatgpt",
    connectionLabel: "ChatGPT",
    supportsPairing: true,
    stopLabel: "Stop & archive",
    stopDescription:
      "Interrupts current work and archives this conversation. You can reopen it from ChatGPT. Other conversations on this host keep running.",
  },
  status(host) {
    return providerStatus(
      this.definition,
      host,
      "codex --version && codex remote-control --help >/dev/null 2>&1\n",
    );
  },
  launch: lifecycle.launch,
  list: lifecycle.list,
  history: lifecycle.history,
  async stop(host, id) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)
    )
      throw new HttpError(422, "Invalid Codex session id");
    await lifecycle.stop(host, id);
  },
  pair: lifecycle.pair,
};
