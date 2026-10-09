import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/animate-ui/components/buttons/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/animate-ui/components/radix/dialog";
import { api, queryClient } from "@/lib/api";
import type { HostStatus, Project } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Input, Label, Spinner } from "./ui";

export function NewProjectDialog({
  open,
  onOpenChange,
  hosts,
  localName,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  hosts: HostStatus[];
  localName: string;
  onCreated: (key: string) => void;
}) {
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const create = useMutation({
    mutationFn: () => api<Project>("/projects", { body: { name: name.trim(), host: host || undefined } }),
    onSuccess: async (p) => {
      toast.success(`Created ${p.label}`);
      await queryClient.invalidateQueries({ queryKey: ["overview"] });
      setName("");
      onOpenChange(false);
      onCreated(p.key);
    },
    onError: (e) => toast.error(e.message),
  });
  const targets = [{ name: "", label: localName, online: true }, ...hosts.map((h) => ({ name: h.name, label: h.name, online: h.online }))];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card max-w-sm">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>Creates an empty directory you can start a session in.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label>Name</Label>
            <Input
              autoFocus
              className="font-mono"
              placeholder="my-idea"
              pattern="[A-Za-z0-9_.\-]+"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          {targets.length > 1 && (
            <div className="grid gap-1.5">
              <Label>Machine</Label>
              <div className="flex flex-wrap gap-1.5">
                {targets.map((t) => (
                  <button
                    key={t.name}
                    type="button"
                    disabled={!t.online}
                    onClick={() => setHost(t.name)}
                    className={cn(
                      "rounded-lg border px-3 py-1.5 font-mono text-xs transition-colors disabled:opacity-40",
                      host === t.name ? "border-primary bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button type="submit" disabled={!name.trim() || create.isPending}>
              {create.isPending ? <Spinner /> : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
