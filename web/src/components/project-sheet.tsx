import { ArrowUpRight, ChevronDown, OctagonX, Play, Sparkles, Zap } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/animate-ui/components/buttons/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/animate-ui/components/radix/sheet";
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering";
import { sessionKey, useHistory, useResume, useStartSession } from "@/hooks/queries";
import { useIsDesktop } from "@/hooks/use-is-desktop";
import { ago } from "@/lib/format";
import type { LiveSession, PastConversation, Project, StartResult } from "@/lib/types";
import { cn } from "@/lib/utils";
import { SessionRow } from "./session-row";
import { Badge, Input, SectionTitle, Spinner } from "./ui";

export function ProjectSheet({
  project,
  sessions,
  yolo,
  onClose,
}: {
  project: Project | null;
  sessions: LiveSession[];
  yolo: boolean;
  onClose: () => void;
}) {
  const desktop = useIsDesktop();
  // Keep the last project rendered while the sheet animates out.
  const [shown, setShown] = useState(project);
  useEffect(() => {
    if (project) setShown(project);
  }, [project]);

  return (
    <Sheet open={!!project} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side={desktop ? "right" : "bottom"}
        className={cn(
          "bg-card gap-0 overflow-y-auto",
          desktop ? "w-[440px] max-w-full" : "safe-bottom h-auto max-h-[92dvh] rounded-t-3xl",
        )}
      >
        {!desktop && <div className="bg-muted-foreground/30 mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full" />}
        {shown && <ProjectBody key={shown.key} project={shown} sessions={sessions} yolo={yolo} />}
      </SheetContent>
    </Sheet>
  );
}

function ProjectBody({ project, sessions, yolo }: { project: Project; sessions: LiveSession[]; yolo: boolean }) {
  return (
    <>
      <SheetHeader className="px-5 pt-4 pb-3">
        <SheetTitle className="flex items-center gap-2 pr-8 font-mono text-lg">
          <span className="text-clay">$</span>
          <span className="truncate">{project.label}</span>
          {project.host && <Badge tone="clay">{project.host}</Badge>}
        </SheetTitle>
        <SheetDescription className="truncate font-mono text-xs">{project.path}</SheetDescription>
      </SheetHeader>

      <div className="space-y-5 px-5 pb-6">
        <AnimatePresence initial={false}>
          {sessions.length > 0 && (
            <motion.section
              key="running"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <SectionTitle>running</SectionTitle>
              <ul className="divide-border/60 divide-y divide-dashed">
                <AnimatePresence initial={false}>
                  {sessions.map((s) => (
                    <SessionRow key={sessionKey(s)} session={s} />
                  ))}
                </AnimatePresence>
              </ul>
            </motion.section>
          )}
        </AnimatePresence>

        <StartPanel project={project} yolo={yolo} />
        <HistorySection project={project} yolo={yolo} />
      </div>
    </>
  );
}

// ── Start ──────────────────────────────────────────────────────────────

function useElapsed(running: boolean): number {
  const [s, setS] = useState(0);
  useEffect(() => {
    if (!running) return;
    setS(0);
    const t = setInterval(() => setS((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [running]);
  return s;
}

function StartPanel({ project, yolo }: { project: Project; yolo: boolean }) {
  const [name, setName] = useState("");
  const start = useStartSession(project.key);
  const [result, setResult] = useState<StartResult | null>(null);
  const elapsed = useElapsed(start.isPending);

  const go = () => {
    setResult(null);
    start.mutate(
      { name: name.trim() || undefined, yolo },
      {
        onSuccess: (res) => {
          setResult(res);
          if (res.status === "running") setName("");
        },
      },
    );
  };

  return (
    <section className="space-y-2">
      <Input
        placeholder="Session name (optional)"
        value={name}
        disabled={start.isPending}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && !start.isPending && go()}
      />
      <Button
        size="lg"
        hoverScale={1.01}
        className={cn("relative h-14 w-full overflow-hidden text-base", yolo && "bg-destructive hover:bg-destructive/90 text-white")}
        disabled={start.isPending}
        onClick={go}
      >
        {start.isPending ? (
          <span className="flex items-center gap-3">
            <Spinner />
            <ShimmeringText
              text={elapsed < 4 ? "Starting claude…" : "Waiting for claude.ai…"}
              color="currentColor"
              shimmeringColor="oklch(1 0 0 / 0.9)"
            />
            <span className="font-mono text-sm opacity-70">{elapsed}s</span>
          </span>
        ) : (
          <>
            <Zap className="size-5" />
            New session{yolo && <span className="font-mono text-xs opacity-80">--yolo</span>}
          </>
        )}
      </Button>
      <StartResultCard result={result} />
    </section>
  );
}

function StartResultCard({ result }: { result: StartResult | null }) {
  return (
    <AnimatePresence mode="popLayout">
      {result && (
        <motion.div
          key={result.conversationId + result.status}
          initial={{ opacity: 0, y: -8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, scale: 0.98 }}
          transition={{ type: "spring", stiffness: 300, damping: 24 }}
          className={cn(
            "rounded-xl border p-3 text-sm",
            result.status === "running" ? "border-success/30 bg-success/8" : "border-destructive/30 bg-destructive/8",
          )}
        >
          {result.status === "running" && result.url ? (
            <div className="space-y-2">
              <p className="text-success flex items-center gap-2 font-medium">
                <Sparkles className="size-4" /> “{result.name}” is ready
              </p>
              <Button asChild className="bg-success hover:bg-success/90 w-full text-black">
                <a href={result.url} target="_blank" rel="noopener noreferrer">
                  Attach <ArrowUpRight />
                </a>
              </Button>
            </div>
          ) : (
            <p className="text-destructive flex items-start gap-2">
              <OctagonX className="mt-0.5 size-4 shrink-0" /> {result.error ?? "Could not start"}
            </p>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── History ────────────────────────────────────────────────────────────

function HistorySection({ project, yolo }: { project: Project; yolo: boolean }) {
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState(15);
  const history = useHistory(open ? project.key : null);
  const entries = history.data ?? [];

  return (
    <section className="space-y-2">
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground flex w-full items-center justify-between px-1 text-xs font-semibold tracking-wider uppercase transition-colors"
        onClick={() => setOpen(!open)}
      >
        past conversations
        <motion.span animate={{ rotate: open ? 180 : 0 }}>
          <ChevronDown className="size-4" />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            {history.isPending ? (
              <div className="text-muted-foreground flex justify-center py-4">
                <Spinner />
              </div>
            ) : entries.length === 0 ? (
              <p className="text-muted-foreground py-3 text-center text-sm">No conversations in this folder yet.</p>
            ) : (
              <>
                <ul className="divide-border/60 divide-y">
                  {entries.slice(0, limit).map((e) => (
                    <HistoryRow key={e.id} entry={e} project={project} yolo={yolo} />
                  ))}
                </ul>
                {entries.length > limit && (
                  <Button variant="ghost" size="sm" className="mt-1" onClick={() => setLimit(limit + 25)}>
                    Show more
                  </Button>
                )}
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

const kb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

function HistoryRow({ entry, project, yolo }: { entry: PastConversation; project: Project; yolo: boolean }) {
  const resume = useResume(project.key);
  return (
    <li className="flex items-center gap-2 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{entry.title ?? entry.firstPrompt ?? <span className="text-muted-foreground">untitled</span>}</p>
        {entry.title && entry.firstPrompt && <p className="text-muted-foreground truncate text-xs">“{entry.firstPrompt}”</p>}
        <p className="text-muted-foreground mt-0.5 font-mono text-[11px]">
          {ago(entry.updatedAt)} · {kb(entry.bytes)}
        </p>
      </div>
      {entry.live ? (
        <Badge tone="success">running</Badge>
      ) : (
        <Button
          size="sm"
          variant="outline"
          disabled={resume.isPending}
          onClick={() =>
            resume.mutate(
              { conversationId: entry.id, yolo },
              {
                onSuccess: (res) =>
                  res.status === "running" && res.url
                    ? toast.success(`Resumed “${entry.title ?? res.name}”`, {
                        action: { label: "Attach", onClick: () => window.open(res.url!, "_blank", "noopener,noreferrer") },
                        duration: 20_000,
                      })
                    : toast.error("Could not resume", { description: res.error }),
              },
            )
          }
        >
          {resume.isPending ? <Spinner /> : <Play />}
          resume
        </Button>
      )}
    </li>
  );
}
