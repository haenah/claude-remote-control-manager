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
    permissionFields: [
      {
        key: "sandbox",
        label: "Sandbox",
        defaultValue: "workspace-write",
        options: [
          {
            value: "default",
            label: "CLI default",
            description: "Use this host's Codex configuration",
          },
          {
            value: "read-only",
            label: "Read only",
            description:
              "Read-only filesystem sandbox; approvals are configured separately",
          },
          {
            value: "workspace-write",
            label: "Workspace write",
            description: "Allow writes in the workspace sandbox",
          },
          {
            value: "danger-full-access",
            label: "Full access",
            description:
              "Disable the filesystem sandbox; approvals are configured separately",
          },
        ],
      },
      {
        key: "approvalPolicy",
        label: "Approval policy",
        defaultValue: "on-request",
        options: [
          {
            value: "default",
            label: "CLI default",
            description: "Use this host's Codex configuration",
          },
          {
            value: "on-request",
            label: "On request",
            description:
              "Codex can request approval to run actions outside its sandbox",
          },
          {
            value: "never",
            label: "Never",
            description: "Never request approval; denied actions fail",
          },
        ],
      },
    ],
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
