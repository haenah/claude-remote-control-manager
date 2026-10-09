import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/animate-ui/components/buttons/button";
import { FileItem, Files, FolderContent, FolderItem, FolderTrigger, SubFiles } from "@/components/animate-ui/components/radix/files";
import { api } from "@/lib/api";
import type { LiveSession, Project, ProjectFile, StartResult } from "@/lib/types";
import { Badge, Spinner } from "./ui";
import { SessionLaunchActions } from "./session-controls";

type Node = { project: Project; children: Node[] };
type TreeProps = {
  projects: Project[];
  query: string;
  sessions: Map<string, LiveSession[]>;
  yolo: boolean;
  onOpen: (key: string) => void;
  onStarted: (result: StartResult, project: Project) => void;
};

export function ProjectTree(props: TreeProps) {
  const groups = useMemo(() => {
    const grouped = new Map<string, { host: string; root: string; nodes: Node[] }>();
    const lookup = new Map<string, Node>();
    const groupKey = (p: Project) => JSON.stringify([p.host, p.root]);
    const pathKey = (p: Project, path: string) => JSON.stringify([p.host, p.root, path]);
    for (const p of props.projects) {
      lookup.set(pathKey(p, p.relativePath), { project: p, children: [] });
      if (!grouped.has(groupKey(p))) grouped.set(groupKey(p), { host: p.host, root: p.root, nodes: [] });
    }
    for (const p of props.projects) {
      const node = lookup.get(pathKey(p, p.relativePath))!;
      const parentPath = p.relativePath.split("/").slice(0, -1).join("/");
      const parent = lookup.get(pathKey(p, parentPath));
      if (parent) parent.children.push(node);
      else grouped.get(groupKey(p))!.nodes.push(node);
    }
    const q = props.query.trim().toLowerCase();
    function filter(nodes: Node[]): Node[] {
      return nodes.sort((a, b) => a.project.label.localeCompare(b.project.label)).flatMap((n) => {
        const children = filter(n.children);
        const match = [n.project.relativePath, n.project.path, n.project.host].some((s) => s.toLowerCase().includes(q));
        return !q || match || children.length ? [{ ...n, children }] : [];
      });
    }
    return [...grouped.entries()].map(([key, group]) => ({ key, ...group, nodes: filter(group.nodes) })).filter((g) => g.nodes.length);
  }, [props.projects, props.query]);

  if (!groups.length) return <p className="text-muted-foreground rounded-xl border p-6 text-center text-sm">No match.</p>;
  return (
    <Files className="bg-card/60 rounded-xl border" defaultOpen={groups.map((g) => g.key)}>
      {groups.map((g) => (
        <FolderItem value={g.key} key={g.key}>
          <FolderTrigger className="break-all font-mono text-xs">
            {g.host && <Badge tone="clay" className="mr-2">{g.host}</Badge>}{g.root}
          </FolderTrigger>
          <FolderContent>
            <TreeLevel key={props.query.trim().toLowerCase()} nodes={g.nodes} {...props} />
          </FolderContent>
        </FolderItem>
      ))}
    </Files>
  );
}

function TreeLevel({ nodes, ...props }: TreeProps & { nodes: Node[] }) {
  const [open, setOpen] = useState<string[]>(props.query.trim() ? nodes.map((n) => n.project.key) : []);
  return (
    <SubFiles open={open} onOpenChange={setOpen}>
      {nodes.map((n) => <TreeFolder key={n.project.key} node={n} expanded={open.includes(n.project.key)} {...props} />)}
    </SubFiles>
  );
}

function TreeFolder({ node, expanded, ...props }: TreeProps & { node: Node; expanded: boolean }) {
  const p = node.project;
  const live = props.sessions.get(p.key)?.length ?? 0;
  const files = useQuery({
    queryKey: ["project-files", p.key],
    queryFn: () => api<ProjectFile[]>(`/projects/${encodeURIComponent(p.key)}/files`),
    enabled: expanded && !props.query.trim(),
    staleTime: 15_000,
  });
  return (
    <FolderItem value={p.key}>
      <div className="flex items-center gap-1 pr-1">
        <div className="min-w-0 flex-1">
          <FolderTrigger className="break-all font-mono" title={p.path}>
            {p.label}{live > 0 && <Badge tone="success" className="ml-2">{live} live</Badge>}
          </FolderTrigger>
        </div>
        <Button size="icon-sm" variant="ghost" aria-label={`Open ${p.path}`} onClick={() => props.onOpen(p.key)}>
          <ArrowUpRight />
        </Button>
        <SessionLaunchActions project={p} yolo={props.yolo} onResult={props.onStarted} />
      </div>
      <FolderContent>
        {node.children.length > 0 && <TreeLevel nodes={node.children} {...props} />}
        {!props.query.trim() && (
          files.isPending ? <p className="text-muted-foreground flex items-center gap-2 p-2 text-xs"><Spinner /> Loading files…</p>
          : files.isError ? <div className="text-destructive p-2 text-xs">{files.error.message} <button type="button" className="underline" onClick={() => files.refetch()}>Retry</button></div>
          : files.data.map((f) => <FileItem key={f.name} className="break-all font-mono text-xs">{f.name}</FileItem>)
        )}
        {!node.children.length && !props.query.trim() && files.data?.length === 0 && <p className="text-muted-foreground p-2 text-xs">Empty folder.</p>}
      </FolderContent>
    </FolderItem>
  );
}
