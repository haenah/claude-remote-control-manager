import { ChevronDown, Play } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { Button } from "@/components/animate-ui/components/buttons/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/animate-ui/components/radix/sheet";
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering";
import {
  sessionKey,
  useHistory,
  useResume,
  useStartSession,
} from "@/hooks/queries";
import { useIsDesktop } from "@/hooks/use-is-desktop";
import { ago } from "@/lib/format";
import type {
  LiveSession,
  PastConversation,
  Project,
  StartResult,
  ProviderId,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { useProviders } from "@/hooks/queries";
import { useLocalStorage } from "@/hooks/use-local-storage";
import {
  ProviderLogo,
  ProviderPicker,
  SessionResultPanel,
  SessionResultDialog,
} from "./session-controls";
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
          desktop
            ? "w-[440px] max-w-full"
            : "safe-bottom h-auto max-h-[92dvh] rounded-t-3xl",
        )}
      >
        {!desktop && (
          <div className="bg-muted-foreground/30 mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full" />
        )}
        {shown && (
          <ProjectBody
            key={shown.key}
            project={shown}
            sessions={sessions}
            yolo={yolo}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function ProjectBody({
  project,
  sessions,
  yolo,
}: {
  project: Project;
  sessions: LiveSession[];
  yolo: boolean;
}) {
  const [provider, setProvider] = useLocalStorage<ProviderId>(
    "rcm.provider",
    "claude",
  );
  return (
    <>
      <SheetHeader className="px-5 pt-4 pb-3">
        <SheetTitle className="flex items-center gap-2 pr-8 font-mono text-lg">
          <span className="text-clay">$</span>
          <span className="truncate">{project.label}</span>
          {project.host && <Badge tone="clay">{project.host}</Badge>}
        </SheetTitle>
        <SheetDescription className="truncate font-mono text-xs">
          {project.path}
        </SheetDescription>
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

        <ProviderPicker
          host={project.host}
          value={provider}
          onChange={setProvider}
        />
        <StartPanel project={project} yolo={yolo} provider={provider} />
        <HistorySection project={project} yolo={yolo} provider={provider} />
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

function StartPanel({
  project,
  yolo,
  provider,
}: {
  project: Project;
  yolo: boolean;
  provider: ProviderId;
}) {
  const [name, setName] = useState("");
  const start = useStartSession(project.key);
  const providers = useProviders(project.host);
  const definition = providers.data?.find((p) => p.id === provider);
  const [result, setResult] = useState<StartResult | null>(null);
  const elapsed = useElapsed(start.isPending);
  const go = () => {
    setResult(null);
    start.mutate(
      { provider, name: name.trim() || undefined, yolo },
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
      {definition && !definition.available && (
        <p className="text-warning text-xs">{definition.error}</p>
      )}
      <Input
        placeholder="Session name (optional)"
        value={name}
        disabled={start.isPending}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) =>
          e.key === "Enter" && definition?.available && !start.isPending && go()
        }
      />
      <Button
        type="button"
        size="lg"
        hoverScale={1.01}
        className={cn(
          "h-14 w-full text-base",
          yolo && "bg-destructive hover:bg-destructive/90 text-white",
        )}
        disabled={start.isPending || !definition?.available}
        onClick={go}
      >
        {start.isPending ? (
          <>
            <Spinner />
            <ShimmeringText
              text={`Starting ${start.variables?.provider ?? provider}…`}
              color="currentColor"
              shimmeringColor="oklch(1 0 0 / 0.9)"
            />
            <span className="font-mono text-sm opacity-70">{elapsed}s</span>
          </>
        ) : (
          <>
            <ProviderLogo provider={provider} />
            New {definition?.label ?? provider} session
            {yolo && <span className="font-mono text-xs">YOLO</span>}
          </>
        )}
      </Button>
      {result && (
        <div className="rounded-xl border p-3 text-sm">
          <SessionResultPanel
            key={result.conversationId + result.status}
            result={result}
            host={project.host}
          />
        </div>
      )}
    </section>
  );
}

// ── History ────────────────────────────────────────────────────────────

function HistorySection({
  project,
  yolo,
  provider,
}: {
  project: Project;
  yolo: boolean;
  provider: ProviderId;
}) {
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState(15);
  const history = useHistory(open ? project.key : null, provider);
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
            ) : history.isError ? (
              <p className="text-destructive py-3 text-sm">
                {history.error.message}
              </p>
            ) : entries.length === 0 ? (
              <p className="text-muted-foreground py-3 text-center text-sm">
                No conversations in this folder yet.
              </p>
            ) : (
              <>
                <ul className="divide-border/60 divide-y">
                  {entries.slice(0, limit).map((e) => (
                    <HistoryRow
                      key={e.id}
                      entry={e}
                      project={project}
                      yolo={yolo}
                    />
                  ))}
                </ul>
                {entries.length > limit && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-1"
                    onClick={() => setLimit(limit + 25)}
                  >
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

const kb = (n: number) =>
  n < 1024 * 1024
    ? `${Math.max(1, Math.round(n / 1024))} KB`
    : `${(n / 1024 / 1024).toFixed(1)} MB`;

function HistoryRow({
  entry,
  project,
  yolo,
}: {
  entry: PastConversation;
  project: Project;
  yolo: boolean;
}) {
  const resume = useResume(project.key);
  const [result, setResult] = useState<StartResult | null>(null);
  return (
    <li className="flex items-center gap-2 py-2.5">
      <ProviderLogo provider={entry.provider} className="size-4" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">
          {entry.title ?? entry.firstPrompt ?? (
            <span className="text-muted-foreground">untitled</span>
          )}
        </p>
        {entry.title && entry.firstPrompt && (
          <p className="text-muted-foreground truncate text-xs">
            “{entry.firstPrompt}”
          </p>
        )}
        <p className="text-muted-foreground mt-0.5 font-mono text-[11px]">
          {ago(entry.updatedAt)}
          {entry.bytes !== null && ` · ${kb(entry.bytes)}`}
          {entry.archived && " · archived"}
        </p>
      </div>
      {entry.live ? (
        <Badge tone="success">running</Badge>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={resume.isPending}
          onClick={() =>
            resume.mutate(
              { provider: entry.provider, conversationId: entry.id, yolo },
              { onSuccess: setResult },
            )
          }
        >
          {resume.isPending ? <Spinner /> : <Play />}resume
        </Button>
      )}
      <SessionResultDialog
        value={result ? { result, project } : null}
        onClose={() => setResult(null)}
      />
    </li>
  );
}
