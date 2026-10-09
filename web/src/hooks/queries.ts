import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, queryClient } from "@/lib/api";
import type { Info, LiveSession, Overview, PastConversation, StartResult, ProviderId, ProviderStatus } from "@/lib/types";

export const useAuthStatus = () =>
  useQuery({
    queryKey: ["auth"],
    queryFn: () => api<{ authenticated: boolean; setupRequired: boolean }>("/auth/status"),
    staleTime: 60_000,
  });

export const useInfo = () => useQuery({ queryKey: ["info"], queryFn: () => api<Info>("/info"), staleTime: 600_000 });

export const useProviders = (host = "") => useQuery({
  queryKey: ["providers", host],
  queryFn: () => api<ProviderStatus[]>(`/providers${host ? `?host=${encodeURIComponent(host)}` : ""}`),
  staleTime: 30_000,
});

export const useOverview = () =>
  useQuery({
    queryKey: ["overview"],
    queryFn: () => api<Overview>("/overview"),
    // Sessions end on their own (closed from claude.ai, crashed); keep the view honest.
    refetchInterval: 8_000,
  });

export const useHistory = (project: string | null, provider: ProviderId) =>
  useQuery({
    queryKey: ["history", project, provider],
    queryFn: () => api<PastConversation[]>(`/projects/${encodeURIComponent(project!)}/history?provider=${provider}`),
    enabled: !!project,
  });

const refresh = (project?: string | null) => {
  queryClient.invalidateQueries({ queryKey: ["overview"] });
  if (project) queryClient.invalidateQueries({ queryKey: ["history", project] });
};

const onError = (e: Error) => toast.error(e.message);

export function useStartSession(project: string) {
  return useMutation({
    mutationFn: (body: { provider: ProviderId; name?: string; yolo: boolean }) =>
      api<StartResult>(`/projects/${encodeURIComponent(project)}/sessions`, { body }),
    onSettled: () => refresh(project),
    onError,
  });
}

export function useResume(project: string) {
  return useMutation({
    mutationFn: (body: { provider: ProviderId; conversationId: string; yolo: boolean }) =>
      api<StartResult>(`/projects/${encodeURIComponent(project)}/resume`, { body }),
    onSettled: () => refresh(project),
    onError,
  });
}

export const sessionKey = (s: Pick<LiveSession, "provider" | "host" | "id">) => JSON.stringify([s.provider, s.host, s.id]);

export function useStopSession() {
  return useMutation({
    mutationFn: (s: LiveSession) =>
      api(`/providers/${s.provider}/sessions/${encodeURIComponent(s.id)}${s.host ? `?host=${encodeURIComponent(s.host)}` : ""}`, { method: "DELETE" }),
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
