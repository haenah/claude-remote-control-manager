import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, queryClient } from "@/lib/api";
import type { Info, LiveSession, Overview, PastConversation, StartResult } from "@/lib/types";

export const useAuthStatus = () =>
  useQuery({
    queryKey: ["auth"],
    queryFn: () => api<{ authenticated: boolean; setupRequired: boolean }>("/auth/status"),
    staleTime: 60_000,
  });

export const useInfo = () => useQuery({ queryKey: ["info"], queryFn: () => api<Info>("/info"), staleTime: 600_000 });

export const useOverview = () =>
  useQuery({
    queryKey: ["overview"],
    queryFn: () => api<Overview>("/overview"),
    // Sessions end on their own (closed from claude.ai, crashed); keep the view honest.
    refetchInterval: 8_000,
  });

export const useHistory = (project: string | null) =>
  useQuery({
    queryKey: ["history", project],
    queryFn: () => api<PastConversation[]>(`/projects/${encodeURIComponent(project!)}/history`),
    enabled: !!project,
  });

const refresh = (project?: string | null) => {
  queryClient.invalidateQueries({ queryKey: ["overview"] });
  if (project) queryClient.invalidateQueries({ queryKey: ["history", project] });
};

const onError = (e: Error) => toast.error(e.message);

export function useStartSession(project: string) {
  return useMutation({
    mutationFn: (body: { name?: string; yolo: boolean }) =>
      api<StartResult>(`/projects/${encodeURIComponent(project)}/sessions`, { body }),
    onSettled: () => refresh(project),
    onError,
  });
}

export function useResume(project: string) {
  return useMutation({
    mutationFn: (body: { conversationId: string; yolo: boolean }) =>
      api<StartResult>(`/projects/${encodeURIComponent(project)}/resume`, { body }),
    onSettled: () => refresh(project),
    onError,
  });
}

export const sessionKey = (s: Pick<LiveSession, "host" | "pid">) => `${s.host}:${s.pid}`;

export function useStopSession() {
  return useMutation({
    mutationFn: (s: LiveSession) =>
      api(`/sessions/${s.pid}${s.host ? `?host=${encodeURIComponent(s.host)}` : ""}`, { method: "DELETE" }),
    onMutate: async (s) => {
      // Optimistic: the row slides out right away; a clean shutdown takes a moment.
      await queryClient.cancelQueries({ queryKey: ["overview"] });
      queryClient.setQueryData<Overview>(
        ["overview"],
        (o) => o && { ...o, sessions: o.sessions.filter((x) => sessionKey(x) !== sessionKey(s)) },
      );
    },
    onSettled: (_d, _e, s) => refresh(s.project),
    onError,
  });
}
