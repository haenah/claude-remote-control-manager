import { ArrowUpRight, Copy, MoreHorizontal, Power } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/animate-ui/components/buttons/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/animate-ui/components/radix/dropdown-menu";
import { useStopSession } from "@/hooks/queries";
import { ago } from "@/lib/format";
import type { LiveSession } from "@/lib/types";
import { Confirm } from "./dialogs";
import { Badge, StatusDot } from "./ui";

function AttachButton({ url }: { url: string }) {
  return (
    <Button asChild size="sm" variant="secondary" className="bg-success/12 text-success hover:bg-success/20 shrink-0">
      <a href={url} target="_blank" rel="noopener noreferrer">
        attach <ArrowUpRight />
      </a>
    </Button>
  );
}

/** A running session: attach, stop. */
export function SessionRow({ session, projectLabel }: { session: LiveSession; projectLabel?: string }) {
  const stop = useStopSession();
  const [confirmStop, setConfirmStop] = useState(false);
  // Claude's own title once the conversation has one, else the name it started with.
  const label = session.title ?? session.name ?? "session";
  const active = session.lastActivity ?? session.startedAt;

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -24, transition: { duration: 0.2 } }}
      transition={{ type: "spring", stiffness: 260, damping: 26 }}
      className="py-2.5"
    >
      <div className="flex items-center gap-3">
        <StatusDot tone="success" live className="ml-1" />
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-baseline gap-2 text-sm">
            {projectLabel && <span className="text-muted-foreground shrink-0 font-mono text-xs">{projectLabel}</span>}
            <span className="truncate font-medium">{label}</span>
          </p>
          <p className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
            {active && <span>{session.lastActivity ? "active" : "started"} {ago(active)}</span>}
            {session.permissionMode === "bypassPermissions" && <Badge tone="danger">yolo</Badge>}
            {!session.managed && <Badge>external</Badge>}
          </p>
        </div>

        {session.url && <AttachButton url={session.url} />}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost" className="text-muted-foreground shrink-0" aria-label="More">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {session.url && (
              <DropdownMenuItem
                onSelect={() => {
                  navigator.clipboard.writeText(session.url!);
                  toast.success("Link copied");
                }}
              >
                <Copy /> Copy link
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => setConfirmStop(true)}>
              <Power /> Stop session
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Confirm
        open={confirmStop}
        onOpenChange={setConfirmStop}
        title={`Stop “${label}”?`}
        description="The session disconnects. Its transcript stays, so it can be resumed later from history."
        action="Stop"
        onConfirm={() => stop.mutate(session)}
      />
    </motion.li>
  );
}
