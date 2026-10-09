import { expect, test } from "bun:test";
import { exitReason, extractSessionUrl, stripAnsi } from "../src/sessions";

test("extractSessionUrl takes the newest link, including OSC-8 hyperlink targets", () => {
  const log = [
    "\x1b]8;;https://claude.ai/code/session_OLD?from=cli\x07old\x1b]8;;\x07",
    "Continue in https://claude.ai/code/session_NEW_1-x",
  ].join("\n");
  expect(extractSessionUrl(log)).toBe("https://claude.ai/code/session_NEW_1-x");
  expect(extractSessionUrl("starting…")).toBeNull();
});

test("stripAnsi removes CSI and OSC-8 sequences", () => {
  expect(stripAnsi("\x1b[32mok\x1b[0m \x1b]8;;https://x\x07link\x1b]8;;\x07")).toBe("ok link");
});

test("exitReason picks the last Error: line", () => {
  expect(exitReason("Error: first\nnoise\nError: Workspace not trusted.\n")).toBe("Workspace not trusted.");
  expect(exitReason("nothing")).toContain("exited before");
});
