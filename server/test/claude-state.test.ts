import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HISTORY_SCRIPT, parseHistory, parseState } from "../src/providers/claude/state";
import { runScript, shQuote } from "../src/hosts";

const ID = "d93a0993-f739-4543-909e-ee5a7321f390";

test("interactive session from a macOS ps line", () => {
  const [s] = parseState(
    [
      `R\t22686\t/p/epsilon\tclaude --remote-control=epsilon · 10-09 09:40 --session-id ${ID} --permission-mode auto\t/d/session-0123456789ab.log\thttps://claude.ai/code/session_01AQ\t\tFri Oct  9 09:40:01 2026`,
      `T\t${ID}\t1791506000\t{"type":"ai-title","aiTitle":"Fix the parser"}`,
    ].join("\n"),
    "",
  );
  expect(s).toMatchObject({
    pid: 22686,
    kind: "interactive",
    name: "epsilon · 10-09 09:40",
    conversationId: ID,
    title: "Fix the parser",
    url: "https://claude.ai/code/session_01AQ",
    permissionMode: "auto",
    managed: true,
    lastActivity: new Date(1791506000 * 1000).toISOString(),
  });
});

test("bridge from exact Linux argv, with its pointer and live conversations", () => {
  const argv = ["claude", "remote-control", "--name", "delta · three", "--spawn", "same-dir"].join("\x1f");
  const pointer = JSON.stringify({ sessionId: "session_01Cu", environmentId: "env_01Mz", pid: 21587 });
  const child = JSON.stringify({ pid: 21601, sessionId: ID, bridgeSessionId: "session_01Cu", status: "busy", updatedAt: 1791505967743 });
  const [s] = parseState(
    [`R\t21587\t/p/delta\t${argv}\t\t\t${pointer}\t`, `C\t21587\t${child}`, `T\t${ID}\t\t`].join("\n"),
    "pi",
  );
  expect(s).toMatchObject({
    host: "pi",
    kind: "bridge",
    name: "delta · three",
    url: "https://claude.ai/code/session_01Cu",
    envUrl: "https://claude.ai/code?environment=env_01Mz",
    managed: false,
  });
  expect(s!.conversations).toEqual([
    { pid: 21601, id: ID, url: "https://claude.ai/code/session_01Cu", status: "busy", title: null, updatedAt: new Date(1791505967743).toISOString() },
  ]);
});

test("a pointer left by an earlier bridge is ignored", () => {
  const argv = ["claude", "remote-control"].join("\x1f");
  const stale = JSON.stringify({ sessionId: "session_old", environmentId: "env_old", pid: 1 });
  const [s] = parseState(`R\t500\t/p\t${argv}\t\t\t${stale}\t`, "");
  expect(s!.url).toBeNull();
  expect(s!.envUrl).toBeNull();
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
