import {
  readFileSync,
  renameSync,
  writeFileSync,
  existsSync,
  realpathSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RemoteHost } from "../../config";
import { runScript, shPath } from "../../hosts";

// ---------------------------------------------------------------------------
// Claude's folder trust prompt
// ---------------------------------------------------------------------------

const TRUST_PY = `import json, os, sys
path = os.path.expanduser('~/.claude.json')
try:
    data = json.load(open(path))
except Exception:
    data = {}
entry = data.setdefault('projects', {}).setdefault(sys.argv[1], {})
if not entry.get('hasTrustDialogAccepted'):
    entry['hasTrustDialogAccepted'] = True
    tmp = path + '.rcm-tmp'
    with open(tmp, 'w') as fh:
        json.dump(data, fh, indent=2)
    os.replace(tmp, path)
`;

/**
 * Mark *projectPath* trusted in the host's ~/.claude.json. Otherwise a
 * remote-control session blocks on a "Do you trust this folder?" prompt that
 * nobody is there to answer.
 */
export async function acceptClaudeTrust(
  host: RemoteHost | null,
  projectPath: string,
): Promise<void> {
  if (host) {
    try {
      const res = await runScript(
        host,
        `python3 - ${shPath(projectPath)} <<'RCM_PY'\n${TRUST_PY}RCM_PY\n`,
        15_000,
      );
      if (res.code !== 0)
        console.warn(
          `trust for ${projectPath} on ${host.name}: ${res.stderr.trim()}`,
        );
    } catch (e) {
      console.warn(`trust on ${host.name}: ${(e as Error).message}`);
    }
    return;
  }
  const file = join(homedir(), ".claude.json");
  let data: { projects?: Record<string, Record<string, unknown>> } = {};
  try {
    if (existsSync(file)) data = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    // An unreadable file is rewritten below rather than left blocking sessions.
  }
  const key = realpathSync(projectPath);
  const entry = ((data.projects ??= {})[key] ??= {});
  if (entry.hasTrustDialogAccepted) return;
  entry.hasTrustDialogAccepted = true;
  try {
    const tmp = `${file}.rcm-tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, file);
  } catch (e) {
    console.warn(
      `could not write trust entry to ~/.claude.json: ${(e as Error).message}`,
    );
  }
}
