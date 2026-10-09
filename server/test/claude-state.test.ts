import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HISTORY_SCRIPT, parseHistory, parseState } from "../src/claude-state";
import { runScript, shQuote } from "../src/hosts";

const ID = "d93a0993-f739-4543-909e-ee5a7321f390";

test("interactive session from a macOS ps line", () => {
  const [s] = parseState(
    [
      `R\t22686\t/p/epsilon\tclaude --remote-control=epsilon · 10-09 09:40 --session-id ${ID} --permission-mode auto\t/d/session-0123456789ab.log\thttps://claude.ai/code/session_01AQ\tFri Oct  9 09:40:01 2026`,
      `T\t${ID}\t1791506000\t{"type":"ai-title","aiTitle":"Fix the parser"}`,
    ].join("\n"),
    "",
  );
  expect(s).toMatchObject({
    pid: 22686,
    name: "epsilon · 10-09 09:40",
    conversationId: ID,
    title: "Fix the parser",
    url: "https://claude.ai/code/session_01AQ",
    permissionMode: "auto",
    managed: true,
    lastActivity: new Date(1791506000 * 1000).toISOString(),
  });
});

test("history script reads titles and first prompts from transcripts", async () => {
  const home = mkdtempSync(join(tmpdir(), "rcm-home-"));
  const cwd = "/srv/my_proj.v2";
  const dir = join(home, ".claude", "projects", "-srv-my-proj-v2");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${ID}.jsonl`),
    [
      JSON.stringify({ type: "queue-operation" }),
      JSON.stringify({ type: "user", timestamp: "2026-10-09T00:00:00Z", message: { content: "Refactor\nthe   parser" } }),
      JSON.stringify({ type: "ai-title", aiTitle: "Parser refactor" }),
    ].join("\n") + "\n",
  );
  writeFileSync(join(dir, "empty.jsonl"), "");
  const res = await runScript(null, `HOME=${shQuote(home)}\nset -- ${shQuote(cwd)} 10\n${HISTORY_SCRIPT}`);
  expect(parseHistory(res.stdout)).toMatchObject([
    { id: ID, title: "Parser refactor", firstPrompt: "Refactor the parser", startedAt: "2026-10-09T00:00:00Z" },
  ]);
});
