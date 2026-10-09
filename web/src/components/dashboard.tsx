import { FolderPlus, Search, Settings2, Zap } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/animate-ui/components/buttons/button";
import { Switch } from "@/components/animate-ui/components/radix/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/animate-ui/components/animate/tabs";
import { SlidingNumber } from "@/components/animate-ui/primitives/texts/sliding-number";
import { sessionKey, useInfo, useOverview, useStartSession } from "@/hooks/queries";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { ago } from "@/lib/format";
import type { LiveSession, Project, StartResult } from "@/lib/types";
import { cn } from "@/lib/utils";
import { NewProjectDialog } from "./new-project-dialog";
import { ProjectSheet } from "./project-sheet";
import { SessionRow } from "./session-row";
import { SettingsSheet } from "./settings-sheet";
import { Badge, Input, Logo, SectionTitle, Spinner, StatusDot } from "./ui";

type Sort = "recent" | "alpha";

/** Toast the outcome of a start, with an attach action when it worked. */
export function announceStart(res: StartResult, label: string) {
  if (res.status === "running" && res.url) {
    const url = res.url;
    toast.success(res.name, {
      description: `${label} — session is ready`,
      action: { label: "Attach", onClick: () => window.open(url, "_blank", "noopener,noreferrer") },
      duration: 20_000,
    });
  } else {
    toast.error(`Could not start ${label}`, { description: res.error ?? "Unknown error", duration: 12_000 });
  }
}

export function Dashboard() {
  const overview = useOverview();
  const info = useInfo();
  const [yolo, setYolo] = useLocalStorage("rcm.yolo", false);
  const [sort, setSort] = useLocalStorage<Sort>("rcm.sort", "recent");
  const [query, setQuery] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);

  const data = overview.data;
  const sessionsByProject = useMemo(() => {
    const m = new Map<string, LiveSession[]>();
    for (const s of data?.sessions ?? []) if (s.project) m.set(s.project, [...(m.get(s.project) ?? []), s]);
    return m;
  }, [data?.sessions]);
  const labels = useMemo(() => new Map((data?.projects ?? []).map((p) => [p.key, p])), [data?.projects]);

  const projects = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (data?.projects ?? []).filter((p) => !q || p.label.toLowerCase().includes(q) || p.host.toLowerCase().includes(q));
    return list.sort((a, b) => {
      // Projects with live sessions float to the top either way.
      const live = Number(sessionsByProject.has(b.key)) - Number(sessionsByProject.has(a.key));
      if (live) return live;
      return sort === "alpha" ? a.label.localeCompare(b.label) : b.mtime - a.mtime;
    });
  }, [data?.projects, query, sort, sessionsByProject]);

  const openProject = openKey ? (labels.get(openKey) ?? null) : null;
  // Sessions outside the listed projects (started from a terminal anywhere) still show, by folder.
  const sessionLabel = (s: LiveSession) => {
    const p = s.project ? labels.get(s.project) : undefined;
    const label = p?.label ?? s.cwd.split("/").filter(Boolean).at(-1) ?? s.cwd;
    return s.host ? `${s.host}:${label}` : label;
  };

  return (
    <div className="app-glow min-h-dvh">
      <header className="safe-top bg-background/70 sticky top-0 z-30 border-b backdrop-blur-xl">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 pb-3">
          <Logo />
          <div className="min-w-0 flex-1 leading-tight">
            <h1 className="font-semibold tracking-tight">rc manager</h1>
            <p className="text-muted-foreground truncate font-mono text-[11px]">
              {info.data ? `v${info.data.version} · claude ${info.data.claudeVersion ?? "?"}` : " "}
            </p>
          </div>
          <div className="hidden items-center gap-1.5 sm:flex">
            {info.data && <HostChip name={info.data.hostname} online />}
            {data?.hosts.map((h) => (
              <HostChip key={h.name} name={h.name} online={h.online} error={h.error} />
            ))}
          </div>
          <Button size="icon" variant="ghost" aria-label="Settings" onClick={() => setSettingsOpen(true)}>
            <Settings2 className="size-5" />
          </Button>
        </div>
      </header>

      <main className="safe-bottom mx-auto max-w-3xl space-y-6 px-4 pt-5">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3">
          <label
            className={cn(
              "flex h-9 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors select-none",
              yolo ? "border-destructive/40 bg-destructive/10 text-destructive" : "text-muted-foreground",
            )}
          >
            <Zap className={cn("size-4", yolo && "fill-current")} />
            YOLO
            <Switch checked={yolo} onCheckedChange={setYolo} className="data-[state=checked]:bg-destructive" />
          </label>
          <Tabs value={sort} onValueChange={(v) => setSort(v as Sort)}>
            <TabsList>
              <TabsTrigger value="recent" className="px-3">
                recent
              </TabsTrigger>
              <TabsTrigger value="alpha" className="px-3">
                a–z
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex-1" />
          <Button variant="outline" size="sm" onClick={() => setNewProjectOpen(true)}>
            <FolderPlus /> New
          </Button>
        </div>

        {/* Active sessions */}
        <AnimatePresence initial={false}>
          {!!data?.sessions.length && (
            <motion.section
              key="active"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="border-success/25 from-success/[0.07] rounded-2xl border bg-gradient-to-b to-transparent p-3 pb-1.5">
                <SectionTitle
                  right={
                    <span className="text-success font-mono text-sm">
                      <SlidingNumber number={data.sessions.length} />
                    </span>
                  }
                >
                  <StatusDot tone="success" live /> active sessions
                </SectionTitle>
                <ul className="divide-border/60 mt-1 divide-y divide-dashed">
                  <AnimatePresence initial={false}>
                    {data.sessions.map((s) => (
                      <SessionRow key={sessionKey(s)} session={s} projectLabel={sessionLabel(s)} />
                    ))}
                  </AnimatePresence>
                </ul>
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        {/* Projects */}
        <section className="space-y-3">
          <SectionTitle
            right={
              <span className="text-muted-foreground font-mono text-xs">
                <SlidingNumber number={projects.length} /> repos
              </span>
            }
          >
            projects
          </SectionTitle>
          {(data?.projects.length ?? 0) > 6 && (
            <div className="relative">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
              <Input placeholder="Filter projects" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-9" />
            </div>
          )}

          {overview.isPending ? (
            <ProjectSkeleton />
          ) : overview.isError ? (
            <p className="text-destructive rounded-xl border p-4 text-sm">{overview.error.message}</p>
          ) : projects.length === 0 ? (
            <p className="text-muted-foreground rounded-xl border border-dashed p-6 text-center text-sm">
              {query ? "No match." : "No projects yet — add a projects directory in settings, or create one."}
            </p>
          ) : (
            <motion.ul layout className="grid gap-2">
              <AnimatePresence initial={false}>
                {projects.map((p, i) => (
                  <ProjectCard
                    key={p.key}
                    project={p}
                    index={i}
                    live={sessionsByProject.get(p.key)?.length ?? 0}
                    yolo={yolo}
                    onOpen={() => setOpenKey(p.key)}
                  />
                ))}
              </AnimatePresence>
            </motion.ul>
          )}
        </section>

        {/* Remote host status on small screens, where the header has no room. */}
        {!!data?.hosts.length && (
          <div className="flex flex-wrap gap-1.5 sm:hidden">
            {info.data && <HostChip name={info.data.hostname} online />}
            {data.hosts.map((h) => (
              <HostChip key={h.name} name={h.name} online={h.online} error={h.error} />
            ))}
          </div>
        )}
      </main>

      <ProjectSheet
        project={openProject}
        sessions={openKey ? (sessionsByProject.get(openKey) ?? []) : []}
        yolo={yolo}
        onClose={() => setOpenKey(null)}
      />
      <SettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} />
      <NewProjectDialog
        open={newProjectOpen}
        onOpenChange={setNewProjectOpen}
        hosts={data?.hosts ?? []}
        localName={info.data?.hostname ?? "local"}
        onCreated={(key) => setOpenKey(key)}
      />
    </div>
  );
}

function HostChip({ name, online, error }: { name: string; online: boolean; error?: string | null }) {
  return (
    <button
      type="button"
      title={error ?? (online ? "online" : "offline")}
      onClick={() => error && toast.error(`${name} unreachable`, { description: error })}
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px]",
        online ? "text-muted-foreground" : "border-destructive/30 text-destructive",
      )}
    >
      <StatusDot tone={online ? "success" : "danger"} />
      {name}
    </button>
  );
}

function ProjectCard({
  project,
  index,
  live,
  yolo,
  onOpen,
}: {
  project: Project;
  index: number;
  live: number;
  yolo: boolean;
  onOpen: () => void;
}) {
  const start = useStartSession(project.key);
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0, transition: { delay: Math.min(index, 12) * 0.025 } }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className={cn(
        "bg-card/60 hover:bg-card group flex items-stretch overflow-hidden rounded-xl border transition-colors",
        live > 0 && "border-success/25",
      )}
    >
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left">
        <StatusDot tone={live ? "success" : "muted"} live={live > 0} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2">
            <span className="truncate font-mono text-[15px] font-medium">{project.label}</span>
            {project.host && <Badge tone="clay">{project.host}</Badge>}
          </p>
          <p className="text-muted-foreground mt-0.5 text-xs">touched {ago(project.mtime)}</p>
        </div>
        {live > 0 && (
          <Badge tone="success" className="shrink-0">
            {live} live
          </Badge>
        )}
      </button>
      <Button
        variant="ghost"
        hoverScale={1}
        className={cn(
          "h-auto shrink-0 rounded-none border-l px-5",
          yolo ? "text-destructive hover:bg-destructive/10" : "text-clay hover:bg-clay/10",
        )}
        aria-label={`Start a session in ${project.label}`}
        disabled={start.isPending}
        onClick={() =>
          start.mutate({ yolo }, { onSuccess: (res) => announceStart(res, project.label) })
        }
      >
        {start.isPending ? <Spinner /> : <Zap className="size-5" />}
      </Button>
    </motion.li>
  );
}

function ProjectSkeleton() {
  return (
    <div className="grid gap-2">
      {Array.from({ length: 5 }, (_, i) => (
        <motion.div
          key={i}
          className="bg-card/50 h-[62px] rounded-xl border"
          animate={{ opacity: [0.4, 0.8, 0.4] }}
          transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.1 }}
        />
      ))}
    </div>
  );
}
