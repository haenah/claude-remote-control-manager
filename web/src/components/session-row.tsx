import {
  ArrowUpRight,
  Copy,
  MessageSquarePlus,
  MoreHorizontal,
  Power,
} from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/animate-ui/components/buttons/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/animate-ui/components/radix/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/animate-ui/components/radix/dropdown-menu";
import { useProviders, useStopSession } from "@/hooks/queries";
import { ago } from "@/lib/format";
import type {
  ChildSession,
  LiveSession,
  ProviderId,
  SessionAccess,
} from "@/lib/types";
import { Confirm } from "./dialogs";
import { ProviderLogo, SessionAccessPanel } from "./session-controls";
import { Badge, StatusDot } from "./ui";

function AccessButton({
  access,
  provider,
  host,
  name,
}: {
  access: SessionAccess;
  provider: ProviderId;
  host: string;
  name: string;
}) {
  const [open, setOpen] = useState(false);
  if (access.kind === "url")
    return (
      <Button asChild size="sm" variant="secondary" className="shrink-0">
        <a href={access.url} target="_blank" rel="noopener noreferrer">
          attach
          <ArrowUpRight />
        </a>
      </Button>
    );
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={() => setOpen(true)}
      >
        connect
        <ArrowUpRight />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-card max-w-md">
          <DialogHeader>
            <DialogTitle>{name}</DialogTitle>
            <DialogDescription>
              Continue this session on your connected device.
            </DialogDescription>
          </DialogHeader>
          <SessionAccessPanel
            access={access}
            provider={provider}
            host={host}
            name={name}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Both engines share the row; access and stop semantics come from the provider. */
export function SessionRow({
  session: s,
  projectLabel,
}: {
  session: LiveSession;
  projectLabel?: string;
}) {
  const stop = useStopSession();
  const providers = useProviders(s.host);
  const definition = providers.data?.find((p) => p.id === s.provider);
  const [confirmStop, setConfirmStop] = useState(false);
  const label = s.title ?? s.name ?? s.kind;
  const active = s.lastActivity ?? s.startedAt;
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -24 }}
      className="py-2.5"
    >
      <div className="flex items-center gap-3">
        <ProviderLogo provider={s.provider} />
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-baseline gap-2 text-sm">
            {projectLabel && (
              <span className="text-muted-foreground shrink-0 font-mono text-xs">
                {projectLabel}
              </span>
            )}
            <span className="truncate font-medium">{label}</span>
          </p>
          <p className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
            <StatusDot
              tone={
                s.state === "busy"
                  ? "clay"
                  : s.state === "error"
                    ? "danger"
                    : "success"
              }
              live
            />
            <span>{definition?.label ?? s.provider}</span>
            {active && (
              <span>
                {s.lastActivity ? "active" : "started"} {ago(active)}
              </span>
            )}
            {s.permissionMode === "bypassPermissions" && (
              <Badge tone="danger">yolo</Badge>
            )}
            {s.kind === "bridge" && <Badge>bridge</Badge>}
            {!s.managed && <Badge>external</Badge>}
          </p>
        </div>
        {s.access && s.kind === "session" && (
          <AccessButton
            access={s.access}
            provider={s.provider}
            host={s.host}
            name={label}
          />
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost" aria-label="More">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {s.newConversationAccess?.kind === "url" && (
              <DropdownMenuItem
                onSelect={() => {
                  if (s.newConversationAccess?.kind === "url")
                    window.open(
                      s.newConversationAccess.url,
                      "_blank",
                      "noopener,noreferrer",
                    );
                }}
              >
                <MessageSquarePlus />
                New chat on this bridge
              </DropdownMenuItem>
            )}
            {s.access?.kind === "url" && (
              <DropdownMenuItem
                onSelect={() => {
                  if (s.access?.kind === "url") {
                    navigator.clipboard.writeText(s.access.url);
                    toast.success("Link copied");
                  }
                }}
              >
                <Copy />
                Copy link
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => setConfirmStop(true)}
            >
              <Power />
              {definition?.stopLabel ?? "Stop"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {s.kind === "bridge" && (
        <ul className="border-border/60 mt-2 ml-7 space-y-1.5 border-l pl-3">
          {s.conversations.map((c) => (
            <ConversationRow key={c.id} conversation={c} session={s} />
          ))}
          {!s.conversations.length && s.access && (
            <li>
              <AccessButton
                access={s.access}
                provider={s.provider}
                host={s.host}
                name={label}
              />
            </li>
          )}
        </ul>
      )}
      <Confirm
        open={confirmStop}
        onOpenChange={setConfirmStop}
        title={`${definition?.stopLabel ?? "Stop"} “${label}”?`}
        description={definition?.stopDescription ?? "This session will stop."}
        action={definition?.stopLabel ?? "Stop"}
        onConfirm={() => stop.mutate(s)}
      />
    </motion.li>
  );
}

function ConversationRow({
  conversation: c,
  session: s,
}: {
  conversation: ChildSession;
  session: LiveSession;
}) {
  return (
    <li className="flex items-center gap-2 text-xs">
      <span className="text-muted-foreground min-w-0 flex-1 truncate">
        {c.title ?? "conversation"}
        {c.status && ` · ${c.status}`}
      </span>
      <AccessButton
        access={c.access}
        provider={s.provider}
        host={s.host}
        name={c.title ?? "conversation"}
      />
    </li>
  );
}
