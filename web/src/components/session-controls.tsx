import { useMutation } from "@tanstack/react-query";
import { ArrowUpRight, Copy, OctagonX } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/animate-ui/components/buttons/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/animate-ui/components/radix/dialog";
import { useProviders, useStartSession } from "@/hooks/queries";
import { api } from "@/lib/api";
import type {
  PairingResult,
  Project,
  ProviderId,
  SessionAccess,
  StartResult,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { Spinner } from "./ui";

const icons: Record<ProviderId, string> = {
  claude: "anthropic",
  codex: "chatgpt",
};
export function ProviderLogo({
  provider,
  className,
}: {
  provider: ProviderId;
  className?: string;
}) {
  return (
    <img
      src={`/providers/${icons[provider]}.svg`}
      alt=""
      aria-hidden="true"
      className={cn("size-5 shrink-0 brightness-0 invert", className)}
    />
  );
}

export function ProviderPicker({
  host,
  value,
  onChange,
  disabled,
}: {
  host: string;
  value: ProviderId;
  onChange: (id: ProviderId) => void;
  disabled?: boolean;
}) {
  const providers = useProviders(host);
  return (
    <div
      className="grid grid-cols-2 gap-2"
      role="group"
      aria-label="Session provider"
    >
      {providers.data?.map((p) => (
        <Button
          key={p.id}
          type="button"
          variant="outline"
          aria-pressed={value === p.id}
          onClick={() => onChange(p.id)}
          disabled={disabled}
          className={cn(
            "h-11",
            value === p.id && "border-primary bg-primary/10 text-primary",
          )}
        >
          <ProviderLogo provider={p.id} />
          {p.label}
        </Button>
      ))}
      {providers.isPending && <Spinner />}
      {providers.isError && (
        <p className="text-destructive col-span-2 text-xs">
          {providers.error.message}
        </p>
      )}
    </div>
  );
}

/** The same launch buttons serve both the directory tree and recent list. */
export function SessionLaunchActions({
  project,
  yolo,
  onResult,
}: {
  project: Project;
  yolo: boolean;
  onResult: (result: StartResult, project: Project) => void;
}) {
  const providers = useProviders(project.host);
  const start = useStartSession(project.key);
  return (
    <div
      className="flex shrink-0 items-center gap-1"
      role="group"
      aria-label={`Start a session in ${project.path}`}
    >
      {providers.data?.map((p) => (
        <Button
          key={p.id}
          type="button"
          size="icon-sm"
          variant="ghost"
          title={
            p.available
              ? `Start ${p.label}`
              : (p.error ?? `${p.label} is unavailable`)
          }
          aria-label={`Start ${p.label} in ${project.path}`}
          disabled={start.isPending}
          className={yolo ? "text-destructive" : "text-clay"}
          onClick={(e) => {
            e.stopPropagation();
            if (!p.available) {
              toast.error(`${p.label} is unavailable`, {
                description: p.error ?? undefined,
              });
              return;
            }
            start.mutate(
              { provider: p.id, yolo },
              { onSuccess: (result) => onResult(result, project) },
            );
          }}
        >
          {start.isPending && start.variables?.provider === p.id ? (
            <Spinner />
          ) : (
            <ProviderLogo provider={p.id} />
          )}
        </Button>
      ))}
      {providers.isPending && <Spinner />}
      {providers.isError && (
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          title={providers.error.message}
          aria-label="Retry session providers"
          onClick={() => providers.refetch()}
        >
          <OctagonX />
        </Button>
      )}
    </div>
  );
}

/** Attach via the access mechanism the provider returned, without assuming URLs. */
export function SessionAccessPanel({
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
  const providers = useProviders(host);
  const definition = providers.data?.find((p) => p.id === provider);
  const pair = useMutation({
    mutationFn: () =>
      api<PairingResult>(`/providers/${provider}/pair`, { body: { host } }),
    onError: (e) => toast.error(e.message),
  });
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!pair.data) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pair.data]);
  if (access.kind === "url")
    return (
      <Button asChild className="w-full">
        <a href={access.url} target="_blank" rel="noopener noreferrer">
          Open {access.label}
          <ArrowUpRight />
        </a>
      </Button>
    );
  const expired = pair.data && pair.data.expiresAt * 1000 <= now;
  return (
    <div className="space-y-3 text-sm">
      <p>
        In {definition?.connectionLabel ?? provider}, open Codex / Remote,
        select <strong>{access.connectionName}</strong>, then open{" "}
        <strong>{name}</strong>.
      </p>
      {access.supportsPairing && (
        <>
          <p className="text-muted-foreground text-xs">
            If this host is not connected to your device yet, create a pairing
            code and enter it in the app’s connection setup.
          </p>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={pair.isPending}
            onClick={() => {
              setNow(Date.now());
              pair.mutate();
            }}
          >
            {pair.isPending ? (
              <Spinner />
            ) : (
              <ProviderLogo provider={provider} />
            )}{" "}
            {pair.data ? "Refresh pairing code" : "Connect a device"}
          </Button>
          {pair.data && !expired && (
            <div className="flex items-center justify-between gap-2 rounded-lg border p-3">
              <div>
                <p className="font-mono text-lg">
                  {pair.data.manualPairingCode}
                </p>
                <p className="text-muted-foreground text-xs">
                  Expires{" "}
                  {new Date(pair.data.expiresAt * 1000).toLocaleTimeString()}
                </p>
              </div>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label="Copy pairing code"
                onClick={() => {
                  navigator.clipboard.writeText(pair.data!.manualPairingCode);
                  toast.success("Pairing code copied");
                }}
              >
                <Copy />
              </Button>
            </div>
          )}
          {expired && (
            <p className="text-warning text-xs">
              This pairing code expired. Create a fresh code to connect.
            </p>
          )}
        </>
      )}
    </div>
  );
}

export function SessionResultPanel({
  result,
  host,
}: {
  result: StartResult;
  host: string;
}) {
  return (
    <div className="space-y-3">
      <p
        className={cn(
          "flex items-center gap-2 font-medium",
          result.status === "running" ? "text-success" : "text-destructive",
        )}
      >
        <ProviderLogo provider={result.provider} />
        {result.status === "running"
          ? `“${result.name}” is ready`
          : (result.error ?? "Could not start the session")}
      </p>
      {result.status === "running" && result.access && (
        <SessionAccessPanel
          key={result.provider + result.conversationId}
          access={result.access}
          provider={result.provider}
          host={host}
          name={result.name}
        />
      )}
    </div>
  );
}

export function SessionResultDialog({
  value,
  onClose,
}: {
  value: { result: StartResult; project: Project } | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!value} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-card max-w-md">
        <DialogHeader>
          <DialogTitle>Session</DialogTitle>
          <DialogDescription>{value?.project.path}</DialogDescription>
        </DialogHeader>
        {value && (
          <SessionResultPanel result={value.result} host={value.project.host} />
        )}
      </DialogContent>
    </Dialog>
  );
}
