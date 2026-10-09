import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { stat } from "node:fs/promises";
import { hostname } from "node:os";
import { join, resolve, sep } from "node:path";
import {
  DEFAULT_PROJECTS_DIR,
  config,
  hostError,
  updateConfig,
  type PermissionMode,
  type RemoteHost,
} from "./config";
import { checkOnline, findHost, runScript } from "./hosts";
import { HttpError } from "./http";
import {
  createProject,
  invalidateHostCache,
  listAllProjects,
  listProjectFiles,
  resolveProject,
} from "./projects";
import { sessionService } from "./sessions";
import { listRecentProjects } from "./recent-projects";
import type { LiveSession, PermissionValues } from "../../shared/sessions";
import {
  allowedOrigin,
  auth,
  loadAuth,
  requireAuth,
  type AuthEnv,
} from "./auth/routes";

const ROOT = resolve(import.meta.dir, "../..");
const WEB_DIST = join(ROOT, "web", "dist");
const VERSION: string = (await Bun.file(join(ROOT, "package.json")).json())
  .version;

export const app = new Hono<AuthEnv>();

app.onError((err, c) => {
  if (err instanceof HttpError)
    return c.json({ error: err.message, ...err.extra }, err.status);
  console.error(`${c.req.method} ${c.req.path}`, err);
  return c.json({ error: err.message || "Internal error" }, 500);
});

app.use(
  "*",
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      // motion animates through inline style attributes.
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "data:"],
      frameAncestors: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'self'"],
    },
    referrerPolicy: "no-referrer",
    // Same-origin by default; this keeps the window.open'd claude.ai tab working.
    crossOriginOpenerPolicy: false,
  }),
);

// ── API guard ────────────────────────────────────────────────────────────

app.use("/api/*", async (c, next) => {
  // CSRF: every state-changing call must come from a page we served. The
  // session cookie is SameSite=Strict too; this is the second lock.
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method) && !allowedOrigin(c)) {
    throw new HttpError(403, "Origin not allowed");
  }
  c.header("Cache-Control", "no-store");
  await next();
});
app.use("/api/*", loadAuth);
app.route("/api/auth", auth);
app.use("/api/*", requireAuth);

// ── Info / overview ──────────────────────────────────────────────────────

app.get("/api/info", (c) =>
  c.json({ version: VERSION, hostname: hostname().replace(/\.local$/, "") }),
);

function requestedHost(name: string): RemoteHost | null {
  if (!name) return null;
  const host = findHost(name);
  if (!host) throw new HttpError(404, `Host '${name}' is not configured`);
  return host;
}

app.get("/api/providers", async (c) =>
  c.json(await sessionService.status(requestedHost(c.req.query("host") ?? ""))),
);

app.post("/api/providers/:provider/pair", async (c) => {
  const body = await c.req.json<{ host?: string }>();
  return c.json(
    await sessionService.pair(
      c.req.param("provider"),
      requestedHost(body.host ?? ""),
    ),
  );
});

/** Everything the main screen needs, in one round trip. */
app.get("/api/overview", async (c) => {
  const [{ projects, hosts }, local, ...remote] = await Promise.all([
    listAllProjects(),
    sessionService.list(null),
    ...config.hosts.map((h) =>
      sessionService.list(h).catch((e) => {
        // Unreachable: its sessions are unknown, not gone — just not listed.
        console.warn(`reading sessions on ${h.name}: ${(e as Error).message}`);
        return [] as LiveSession[];
      }),
    ),
  ]);
  const byPath = new Map(projects.map((p) => [`${p.host}\0${p.path}`, p.key]));
  const sessions = [...local, ...remote.flat()]
    .map((s) => ({ ...s, project: byPath.get(`${s.host}\0${s.cwd}`) ?? null }))
    .sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
  return c.json({
    projects,
    recentProjects: listRecentProjects(projects, sessions),
    hosts,
    sessions,
  });
});

// ── Projects ─────────────────────────────────────────────────────────────

app.get("/api/projects/:key/files", async (c) =>
  c.json(await listProjectFiles(c.req.param("key"))),
);

app.post("/api/projects", async (c) => {
  const body = await c.req.json<{ name: string; host?: string }>();
  const host = body.host ? findHost(body.host) : null;
  if (body.host && !host)
    throw new HttpError(404, `Host '${body.host}' is not configured`);
  const project = await createProject(
    String(body.name ?? "").trim(),
    host ?? null,
  );
  return c.json(project);
});

const effectivePermissions = (provider: unknown) =>
  sessionService.permissionValues(
    provider,
    config.providerPermissions[String(provider)],
  );

function defaultName(label: string): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${label} · ${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

app.post("/api/projects/:key/sessions", async (c) => {
  const body = await c.req.json<{
    provider?: string;
    name?: string;
    yolo?: boolean;
  }>();
  const { host, path, label } = await resolveProject(c.req.param("key"));
  return c.json(
    await sessionService.launch(body.provider, {
      host,
      projectPath: path,
      name: body.name?.trim().slice(0, 100) || defaultName(label),
      permissions: effectivePermissions(body.provider),
      yolo: body.yolo === true,
    }),
  );
});

app.post("/api/projects/:key/resume", async (c) => {
  const body = await c.req.json<{
    provider?: string;
    conversationId: string;
    name?: string;
    yolo?: boolean;
  }>();
  if (!body.conversationId)
    throw new HttpError(422, "Conversation id is required");
  const { host, path, label } = await resolveProject(c.req.param("key"));
  return c.json(
    await sessionService.launch(body.provider, {
      host,
      projectPath: path,
      name: body.name?.trim().slice(0, 100) || "",
      permissions: effectivePermissions(body.provider),
      yolo: body.yolo === true,
      resume: body.conversationId,
    }),
  );
});

app.get("/api/projects/:key/history", async (c) => {
  const { host, path } = await resolveProject(c.req.param("key"));
  return c.json(
    await sessionService.history(c.req.query("provider"), host, path),
  );
});

app.delete("/api/providers/:provider/sessions/:id", async (c) => {
  await sessionService.stop(
    c.req.param("provider"),
    requestedHost(c.req.query("host") ?? ""),
    c.req.param("id"),
  );
  return c.json({ ok: true });
});

// ── Settings ─────────────────────────────────────────────────────────────

app.get("/api/settings", (c) =>
  c.json({
    projectsDirs: config.projectsDirs,
    providerPermissions: sessionService.permissionSettings(
      config.providerPermissions,
    ),
  }),
);

app.put("/api/settings", async (c) => {
  const body = await c.req.json<{
    projectsDirs?: string[];
    providerPermissions?: Record<string, PermissionValues>;
  }>();
  const patch: Partial<typeof config> = {};
  if (body.providerPermissions !== undefined) {
    patch.providerPermissions = { ...config.providerPermissions };
    for (const [id, values] of Object.entries(body.providerPermissions)) {
      patch.providerPermissions[id] = sessionService.permissionValues(
        id,
        values,
        true,
      );
    }
    if (patch.providerPermissions.claude?.mode)
      patch.permissionMode = patch.providerPermissions.claude
        .mode as PermissionMode;
  }
  if (body.projectsDirs !== undefined) {
    const dirs = body.projectsDirs.map((d) => String(d).trim()).filter(Boolean);
    if (!dirs.length)
      throw new HttpError(422, "At least one projects directory is required");
    patch.projectsDirs = dirs;
  }
  updateConfig(patch);
  return c.json({ ok: true });
});

// ── Remote hosts ─────────────────────────────────────────────────────────

function hostFromBody(
  body: Partial<RemoteHost>,
  fallbackName?: string,
): RemoteHost {
  const ssh = String(body.ssh ?? "").trim();
  if (!ssh) throw new HttpError(422, "ssh destination is required");
  // 'me@stardust' connects as that user but is labelled 'stardust'.
  const name =
    String(body.name ?? "").trim() || fallbackName || ssh.split("@").at(-1)!;
  const dirs = (body.projectsDirs ?? [DEFAULT_PROJECTS_DIR])
    .map((d) => String(d).trim())
    .filter(Boolean);
  const host = { name, ssh, projectsDirs: dirs };
  const err = hostError(host);
  if (err) throw new HttpError(422, err);
  return host;
}

/** A host that fails to connect would only ever show as an offline chip — refuse it up front. */
async function assertReachable(host: RemoteHost): Promise<void> {
  const err = await checkOnline(host);
  if (err) {
    throw new HttpError(
      422,
      `Cannot reach ${host.ssh} over ssh: ${err}. Check the hostname and that key-based ssh works from this machine.`,
    );
  }
}

function applyHosts(hosts: RemoteHost[]): void {
  updateConfig({ hosts });
  invalidateHostCache();
}

app.get("/api/hosts", async (c) =>
  c.json(
    await Promise.all(
      config.hosts.map(async (h) => {
        const error = await checkOnline(h);
        return { ...h, online: !error, error };
      }),
    ),
  ),
);

app.post("/api/hosts", async (c) => {
  const host = hostFromBody(await c.req.json());
  if (findHost(host.name))
    throw new HttpError(
      409,
      `Host '${host.name}' already exists — edit it instead`,
    );
  await assertReachable(host);
  applyHosts([...config.hosts, host]);
  return c.json(host);
});

app.put("/api/hosts/:name", async (c) => {
  const name = c.req.param("name");
  if (!findHost(name)) throw new HttpError(404, `Host '${name}' not found`);
  const host = hostFromBody(await c.req.json(), name);
  if (host.name !== name && findHost(host.name))
    throw new HttpError(409, `Host '${host.name}' already exists`);
  await assertReachable(host);
  applyHosts(config.hosts.map((h) => (h.name === name ? host : h)));
  return c.json(host);
});

app.delete("/api/hosts/:name", (c) => {
  const name = c.req.param("name");
  if (!findHost(name)) throw new HttpError(404, `Host '${name}' not found`);
  // Sessions running there are left alone; they just leave the list.
  applyHosts(config.hosts.filter((h) => h.name !== name));
  return c.json({ ok: true });
});

app.all("/api/*", () => {
  throw new HttpError(404, "Not found");
});

// ── Web UI ───────────────────────────────────────────────────────────────

app.get("*", async (c) => {
  const path = resolve(WEB_DIST, `.${c.req.path}`);
  const isFile =
    path.startsWith(WEB_DIST + sep) &&
    (await stat(path).catch(() => null))?.isFile();
  if (isFile) {
    // Vite fingerprints everything under /assets.
    c.header(
      "Cache-Control",
      c.req.path.startsWith("/assets/")
        ? "public, max-age=31536000, immutable"
        : "no-cache",
    );
    return new Response(Bun.file(path), { headers: c.res.headers });
  }
  const index = Bun.file(join(WEB_DIST, "index.html"));
  if (!(await index.exists()))
    return c.text("Web UI not built — run `bun run build`.", 503);
  c.header("Cache-Control", "no-cache");
  return c.html(await index.text());
});
