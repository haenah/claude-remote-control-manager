import { expect, test } from "bun:test";
import { makeKey, runScript, shPath, shQuote, splitKey } from "../src/hosts";

test("project keys round-trip", () => {
  expect(splitKey("myrepo")).toEqual(["", "myrepo"]);
  expect(splitKey("stardust:my:repo")).toEqual(["stardust", "my:repo"]);
  expect(makeKey("", "a")).toBe("a");
  expect(makeKey("h", "a")).toBe("h:a");
});

test("shQuote quotes like shlex", () => {
  expect(shQuote("plain/path-1.0")).toBe("plain/path-1.0");
  expect(shQuote("")).toBe("''");
  expect(shQuote("it's here")).toBe(`'it'"'"'s here'`);
});

test("shPath keeps a leading tilde expandable", () => {
  expect(shPath("~")).toBe("~");
  expect(shPath("~/my projects")).toBe("~/'my projects'");
  expect(shPath("/abs/path")).toBe("/abs/path");
});

test("runScript strips login-shell noise before the marker", async () => {
  const res = await runScript(null, "printf hello\n");
  expect(res.code).toBe(0);
  expect(res.stdout).toBe("hello");
});

test("shQuote output survives a real shell", async () => {
  const nasty = `a 'b' "c" $HOME \`x\` ; rm -rf /`;
  const res = await runScript(null, `printf '%s' ${shQuote(nasty)}\n`);
  expect(res.stdout).toBe(nasty);
});
