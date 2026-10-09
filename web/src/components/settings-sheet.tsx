import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Fingerprint,
  LogOut,
  MonitorSmartphone,
  Pencil,
  Plus,
  Server,
  ShieldCheck,
  Trash2,
  UserPlus,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/animate-ui/components/buttons/button";
import { CopyButton } from "@/components/animate-ui/components/buttons/copy";
import {
  Tabs,
  TabsContent,
  TabsContents,
  TabsList,
  TabsTrigger,
} from "@/components/animate-ui/components/animate/tabs";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/animate-ui/components/radix/sheet";
import { useInfo, useProviders } from "@/hooks/queries";
import { useIsDesktop } from "@/hooks/use-is-desktop";
import { api, queryClient } from "@/lib/api";
import { ago } from "@/lib/format";
import { registerPasskey } from "@/lib/passkey";
import type {
  HostStatus,
  Passkey,
  Settings,
  PermissionValues,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { Confirm, PromptDialog } from "./dialogs";
import { ProviderLogo } from "./session-controls";
import {
  Badge,
  Input,
  Label,
  SectionTitle,
  Spinner,
  StatusDot,
  Textarea,
} from "./ui";

export function SettingsSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const desktop = useIsDesktop();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={desktop ? "right" : "bottom"}
        className={cn(
          "bg-card gap-0 overflow-y-auto",
          desktop
            ? "w-[460px] max-w-full"
            : "safe-bottom h-[92dvh] rounded-t-3xl",
        )}
      >
        {!desktop && (
          <div className="bg-muted-foreground/30 mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full" />
        )}
        <SheetHeader className="px-5 pt-4">
          <SheetTitle>Settings</SheetTitle>
          <SheetDescription className="sr-only">
            Sessions, remote hosts and sign-in
          </SheetDescription>
        </SheetHeader>
        <Tabs defaultValue="general" className="px-5 pb-6">
          <TabsList className="w-full">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="hosts">Hosts</TabsTrigger>
            <TabsTrigger value="security">Security</TabsTrigger>
          </TabsList>
          <TabsContents className="mt-3">
            <TabsContent value="general">
              <GeneralTab />
            </TabsContent>
            <TabsContent value="hosts">
              <HostsTab />
            </TabsContent>
            <TabsContent value="security">
              <SecurityTab />
            </TabsContent>
          </TabsContents>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

// ── General ────────────────────────────────────────────────────────────

function GeneralTab() {
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<Settings>("/settings"),
  });
  const info = useInfo();
  const providers = useProviders();
  const [dirs, setDirs] = useState("");
  useEffect(() => {
    if (settings.data) setDirs(settings.data.projectsDirs.join("\n"));
  }, [settings.data]);
  const save = useMutation({
    mutationFn: (body: {
      projectsDirs?: string[];
      providerPermissions?: Record<string, PermissionValues>;
    }) => api("/settings", { method: "PUT", body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      queryClient.invalidateQueries({ queryKey: ["overview"] });
      toast.success("Saved");
    },
    onError: (e) => toast.error(e.message),
  });
  if (!settings.data) return <Loading />;
  const dirsChanged = dirs.trim() !== settings.data.projectsDirs.join("\n");

  return (
    <div className="space-y-6">
      {settings.data.providerPermissions.map((provider) => (
        <section key={provider.provider} className="space-y-3">
          <SectionTitle>
            <ProviderLogo provider={provider.provider} className="size-4" />
            {provider.label} permissions
          </SectionTitle>
          <p className="text-muted-foreground px-1 text-xs">
            For new {provider.label} sessions. YOLO overrides these settings.
          </p>
          {provider.fields.map((field) => (
            <div key={field.key} className="space-y-1.5">
              <Label>{field.label}</Label>
              {field.options.map((option) => {
                const active = provider.values[field.key] === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    disabled={save.isPending}
                    onClick={() =>
                      !active &&
                      save.mutate({
                        providerPermissions: {
                          [provider.provider]: {
                            ...provider.values,
                            [field.key]: option.value,
                          },
                        },
                      })
                    }
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors",
                      active
                        ? "border-primary/50 bg-primary/10"
                        : "hover:bg-accent/50",
                    )}
                  >
                    <span
                      className={cn(
                        "shrink-0 font-mono text-sm",
                        active && "text-primary",
                      )}
                    >
                      {option.label}
                    </span>
                    <span className="text-muted-foreground ml-auto text-right text-xs">
                      {option.description}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </section>
      ))}

      <section className="space-y-2">
        <SectionTitle>project directories</SectionTitle>
        <p className="text-muted-foreground px-1 text-xs">
          On this machine, one root per line. Nested folders are discovered
          recursively; hidden and dependency folders are skipped.
        </p>
        <Textarea
          className="font-mono"
          rows={3}
          value={dirs}
          onChange={(e) => setDirs(e.target.value)}
        />
        <AnimatePresence>
          {dirsChanged && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              <Button
                size="sm"
                onClick={() => save.mutate({ projectsDirs: dirs.split("\n") })}
              >
                Save directories
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      {info.data && (
        <section className="text-muted-foreground space-y-1 rounded-lg border p-3 font-mono text-xs">
          <p>host · {info.data.hostname}</p>
          <p>rcm · v{info.data.version}</p>
          {providers.data?.map((p) => (
            <p key={p.id} className="flex items-center gap-2">
              <ProviderLogo provider={p.id} className="size-3.5" />
              {p.label} · {p.version ?? "not available on this host"}
            </p>
          ))}
        </section>
      )}
    </div>
  );
}

// ── Hosts ──────────────────────────────────────────────────────────────

type HostForm = {
  editing: string | null;
  ssh: string;
  name: string;
  dirs: string;
};
const emptyForm: HostForm = {
  editing: null,
  ssh: "",
  name: "",
  dirs: "~/Developer",
};

function HostsTab() {
  const hosts = useQuery({
    queryKey: ["hosts"],
    queryFn: () => api<HostStatus[]>("/hosts"),
  });
  const [form, setForm] = useState<HostForm | null>(null);
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["hosts"] });
    queryClient.invalidateQueries({ queryKey: ["overview"] });
  };
  const save = useMutation({
    mutationFn: (f: HostForm) =>
      api(f.editing ? `/hosts/${encodeURIComponent(f.editing)}` : "/hosts", {
        method: f.editing ? "PUT" : "POST",
        body: {
          ssh: f.ssh,
          name: f.name || undefined,
          projectsDirs: f.dirs.split("\n"),
        },
      }),
    onSuccess: () => {
      toast.success("Host saved");
      setForm(null);
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (name: string) =>
      api<{ runningSessions: number }>(`/hosts/${encodeURIComponent(name)}`, {
        method: "DELETE",
      }),
    onSuccess: (r) => {
      toast.success("Host removed", {
        description: r.runningSessions
          ? `${r.runningSessions} session(s) keep running on it.`
          : undefined,
      });
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground px-1 text-xs leading-relaxed">
        Manage projects on other machines over ssh. Each needs key-based ssh and
        the selected engine’s CLI installed and signed in. Claude hosts also
        need <code>loginctl enable-linger</code> so sessions outlive the
        connection.
      </p>

      {hosts.isPending ? (
        <Loading label="Checking hosts…" />
      ) : (
        <ul className="grid gap-2">
          <AnimatePresence initial={false}>
            {hosts.data?.map((h) => (
              <motion.li
                key={h.name}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="flex items-center gap-3 rounded-lg border p-3"
              >
                <StatusDot tone={h.online ? "success" : "danger"} />
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-sm">{h.name}</p>
                  <p className="text-muted-foreground truncate font-mono text-xs">
                    {h.ssh} · {h.projectsDirs.join(", ")}
                  </p>
                  {h.error && (
                    <p className="text-destructive mt-0.5 truncate text-xs">
                      {h.error}
                    </p>
                  )}
                </div>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Edit"
                  onClick={() =>
                    setForm({
                      editing: h.name,
                      ssh: h.ssh,
                      name: h.name,
                      dirs: h.projectsDirs.join("\n"),
                    })
                  }
                >
                  <Pencil />
                </Button>
                <Confirm
                  title={`Remove ${h.name}?`}
                  description="Its projects leave the list. Sessions running there are not stopped."
                  action="Remove"
                  onConfirm={() => remove.mutate(h.name)}
                >
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="text-destructive"
                    aria-label="Remove"
                  >
                    <Trash2 />
                  </Button>
                </Confirm>
              </motion.li>
            ))}
          </AnimatePresence>
          {hosts.data?.length === 0 && !form && (
            <li className="text-muted-foreground rounded-lg border border-dashed p-4 text-center text-sm">
              No remote hosts.
            </li>
          )}
        </ul>
      )}

      <AnimatePresence mode="wait" initial={false}>
        {form ? (
          <motion.form
            key="form"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="grid gap-3 overflow-hidden rounded-lg border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(form);
            }}
          >
            <div className="grid gap-1.5">
              <Label>ssh destination</Label>
              <Input
                autoFocus
                className="font-mono"
                placeholder="me@desktop or ssh alias"
                autoCapitalize="none"
                value={form.ssh}
                onChange={(e) => setForm({ ...form, ssh: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Label</Label>
              <Input
                className="font-mono"
                placeholder="defaults to the hostname"
                autoCapitalize="none"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Project directories (on that machine)</Label>
              <Textarea
                className="font-mono"
                rows={2}
                value={form.dirs}
                onChange={(e) => setForm({ ...form, dirs: e.target.value })}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setForm(null)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!form.ssh.trim() || save.isPending}
              >
                {save.isPending ? (
                  <>
                    <Spinner /> Checking ssh…
                  </>
                ) : form.editing ? (
                  "Save"
                ) : (
                  "Add host"
                )}
              </Button>
            </div>
          </motion.form>
        ) : (
          <motion.div
            key="add"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setForm(emptyForm)}
            >
              <Server /> Add remote host
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Security ───────────────────────────────────────────────────────────

function SecurityTab() {
  const passkeys = useQuery({
    queryKey: ["passkeys"],
    queryFn: () => api<Passkey[]>("/auth/passkeys"),
  });
  const [invite, setInvite] = useState<{
    token: string;
    expiresAt: string;
  } | null>(null);
  const [renaming, setRenaming] = useState<Passkey | null>(null);
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["passkeys"] });

  const add = useMutation({
    mutationFn: () => registerPasskey({}),
    onSuccess: () => {
      toast.success("Passkey added");
      refresh();
    },
    onError: (e) => e.message !== "Cancelled" && toast.error(e.message),
  });
  const mint = useMutation({
    mutationFn: () =>
      api<{ token: string; expiresAt: string }>("/auth/invite", { body: {} }),
    onSuccess: setInvite,
    onError: (e) => toast.error(e.message),
  });
  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api(`/auth/passkeys/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: { name },
      }),
    onSuccess: refresh,
    onError: (e) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) =>
      api(`/auth/passkeys/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: refresh,
    onError: (e) => toast.error(e.message),
  });
  const signOutOthers = useMutation({
    mutationFn: () =>
      api<{ removed: number }>("/auth/logout-others", { body: {} }),
    onSuccess: (r) =>
      toast.success(
        `Signed out ${r.removed} other session${r.removed === 1 ? "" : "s"}`,
      ),
  });
  const signOut = useMutation({
    mutationFn: () => api("/auth/logout", { body: {} }),
    onSuccess: () => {
      // Drop everything signed-in first, so nothing refetches into a 401 on the way out.
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "auth" });
      queryClient.setQueryData(["auth"], {
        authenticated: false,
        setupRequired: false,
      });
    },
  });

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <SectionTitle>passkeys</SectionTitle>
        {passkeys.isPending ? (
          <Loading />
        ) : (
          <ul className="grid gap-2">
            {passkeys.data?.map((p) => (
              <li
                key={p.id}
                className="flex items-center gap-3 rounded-lg border p-3"
              >
                <Fingerprint className="text-clay size-5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm">
                    <span className="truncate">{p.name}</span>
                    {p.current && <Badge tone="clay">this session</Badge>}
                    {p.backedUp && <Badge>synced</Badge>}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    added {ago(p.createdAt)} ·{" "}
                    {p.lastUsedAt ? `used ${ago(p.lastUsedAt)}` : "never used"}
                  </p>
                </div>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Rename"
                  onClick={() => setRenaming(p)}
                >
                  <Pencil />
                </Button>
                <Confirm
                  title={`Remove “${p.name}”?`}
                  description="Devices using this passkey are signed out and can't sign in with it again."
                  action="Remove"
                  onConfirm={() => remove.mutate(p.id)}
                >
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="text-destructive"
                    aria-label="Remove"
                    disabled={(passkeys.data?.length ?? 0) <= 1}
                  >
                    <Trash2 />
                  </Button>
                </Confirm>
              </li>
            ))}
          </ul>
        )}
        <Button
          variant="outline"
          className="w-full"
          disabled={add.isPending}
          onClick={() => add.mutate()}
        >
          {add.isPending ? <Spinner /> : <Plus />} Add a passkey on this device
        </Button>
      </section>

      <section className="space-y-2">
        <SectionTitle>new device</SectionTitle>
        <p className="text-muted-foreground px-1 text-xs">
          Passkeys in iCloud Keychain already sync across your Apple devices.
          For anything else, mint a one-time code and enter it on the new device
          under “Set up a new device”.
        </p>
        <AnimatePresence mode="wait" initial={false}>
          {invite ? (
            <motion.div
              key={invite.token}
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="border-clay/40 bg-clay/8 flex items-center gap-3 rounded-lg border p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="font-mono text-lg tracking-wider">
                  {invite.token}
                </p>
                <p className="text-muted-foreground text-xs">
                  single use · expires {ago(invite.expiresAt)}
                </p>
              </div>
              <CopyButton content={invite.token} variant="ghost" size="sm" />
            </motion.div>
          ) : (
            <motion.div
              key="mint"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <Button
                variant="outline"
                className="w-full"
                disabled={mint.isPending}
                onClick={() => mint.mutate()}
              >
                <UserPlus /> Invite a device
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      <section className="space-y-2">
        <SectionTitle>
          <ShieldCheck className="size-3.5" /> sessions
        </SectionTitle>
        <div className="grid gap-2 sm:grid-cols-2">
          <Confirm
            title="Sign out other devices?"
            description="Every other browser has to sign in with its passkey again."
            action="Sign out others"
            onConfirm={() => signOutOthers.mutate()}
          >
            <Button variant="outline">
              <MonitorSmartphone /> Sign out others
            </Button>
          </Confirm>
          <Button
            variant="outline"
            className="text-destructive"
            onClick={() => signOut.mutate()}
          >
            <LogOut /> Sign out
          </Button>
        </div>
      </section>

      <PromptDialog
        open={!!renaming}
        onOpenChange={(o) => !o && setRenaming(null)}
        title="Rename passkey"
        initial={renaming?.name ?? ""}
        onSubmit={(name) =>
          renaming && rename.mutate({ id: renaming.id, name })
        }
      />
    </div>
  );
}

function Loading({ label }: { label?: string }) {
  return (
    <div className="text-muted-foreground flex items-center justify-center gap-2 py-6 text-sm">
      <Spinner /> {label}
    </div>
  );
}
