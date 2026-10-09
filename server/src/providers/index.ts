import { claudeProvider } from "./claude";
import { codexProvider } from "./codex";

/** The only place that knows which native implementations are installed. */
export const providers = [claudeProvider, codexProvider];
