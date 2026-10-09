import { ArrowUpRight, Copy, MessageSquarePlus, MoreHorizontal, Power } from "lucide-react";
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
import type { Conversation, LiveSession } from "@/lib/types";
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

/** A running session (or a bridge and its conversations): attach, stop. */
export function SessionRow({ session, projectLabel }: { session: LiveSession; projectLabel?: string }) {
  const stop = useStopSession();
  const [confirmStop, setConfirmStop] = useState(false);
  const bridge = session.kind === "bridge";
  // Claude's own title once the conversation has one, else the name it started with.
  const label = session.title ?? session.name ?? (bridge ? "bridge" : "session");
  const busy = session.conversations.some((c) => c.status === "busy");
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
        <StatusDot tone={busy ? "clay" : "success"} live className="ml-1" />
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-baseline gap-2 text-sm">
            {projectLabel && <span className="text-muted-foreground shrink-0 font-mono text-xs">{projectLabel}</span>}
            <span className="truncate font-medium">{label}</span>
          </p>
          <p className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
            {active && <span>{session.lastActivity ? "active" : "started"} {ago(active)}</span>}
            {session.permissionMode === "bypassPermissions" && <Badge tone="danger">yolo</Badge>}
            {bridge && <Badge>bridge</Badge>}
            {!session.managed && <Badge>external</Badge>}
          </p>
        </div>

        {session.url && !bridge && <AttachButton url={session.url} />}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost" className="text-muted-foreground shrink-0" aria-label="More">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {session.envUrl && (
              <DropdownMenuItem onSelect={() => window.open(session.envUrl!, "_blank", "noopener,noreferrer")}>
                <MessageSquarePlus /> New chat on this bridge
              </DropdownMenuItem>
            )}
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
              <Power /> Stop {bridge ? "bridge" : "session"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {bridge && (
        <ul className="border-border/60 mt-2 ml-[1.1rem] space-y-1.5 border-l pl-3">
          {session.conversations.length === 0 && session.url && (
            <ConversationRow conversation={{ pid: 0, id: "", url: session.url, status: null, title: null, updatedAt: null }} />
          )}
          {session.conversations.map((c) => (
            <ConversationRow key={c.pid} conversation={c} />
          ))}
        </ul>
      )}

      <Confirm
        open={confirmStop}
        onOpenChange={setConfirmStop}
        title={`Stop “${label}”?`}
        description={
          bridge
            ? "The bridge and its conversations disconnect. Transcripts stay, so each can be resumed later from history."
            : "The session disconnects. Its transcript stays, so it can be resumed later from history."
        }
        action="Stop"
        onConfirm={() => stop.mutate(session)}
      />
    </motion.li>
  );
}

function ConversationRow({ conversation: c }: { conversation: Conversation }) {
  return (
    <li className="flex items-center gap-2 text-xs">
      <span className="text-muted-foreground min-w-0 flex-1 truncate">
        {c.title ?? "conversation"}
        {c.status && <span className={c.status === "busy" ? "text-clay" : ""}> · {c.status}</span>}
      </span>
      <AttachButton url={c.url} />
    </li>
  );
}
