// Point config and data at a throwaway directory before any module loads them.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "rcm-test-"));
writeFileSync(
  join(dir, "config.json"),
  JSON.stringify({ dataDir: dir, projectsDirs: [join(dir, "projects")] }),
);
process.env.RCM_CONFIG = join(dir, "config.json");
