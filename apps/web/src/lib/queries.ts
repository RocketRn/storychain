import { useCallback, useEffect } from "react";
import {
  QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  ChainDetailDTO,
  ChainDTO,
  ChainInput,
  MyPostDTO,
  Page,
  PlansDTO,
  PostDTO,
  SessionDTO,
} from "@storychain/shared/light";
import { api, ApiError } from "./api";

/**
 * Retry only what a retry can fix: network failures and 5xx. A 4xx is the server's decision (401 expired,
 * 403, 404, 429 slow down...): repeating it only adds load and delays the error the user needs to see.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 2;
}

export const createQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: { staleTime: 15_000, refetchOnWindowFocus: false, retry: shouldRetry },
    },
  });

/**
 * Flattens infinite-query pages. De-duplicates by id (first occurrence wins): rankings move while a user
 * scrolls, and a repeated id would render twice and break React's keys.
 */
export function flattenPages<T extends { id: string }>(
  pages: ReadonlyArray<{ items: T[] }> | undefined,
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const page of pages ?? [])
    for (const item of page.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
  return out;
}

export const qk = {
  session: ["session"] as const,
  chains: (sort: string) => ["chains", sort] as const,
  chain: (id: string) => ["chain", id] as const,
  posts: (id: string) => ["posts", id] as const,
  plans: ["plans"] as const,
  myPosts: ["my-posts"] as const,
  myChains: ["my-chains"] as const,
  boosted: ["boosted"] as const,
};

export const useSession = () =>
  useQuery({
    queryKey: qk.session,
    queryFn: () => api.post<SessionDTO>("/api/auth/session"),
    // POST /auth/session writes (lastSeenAt): refresh it rarely, not on every screen that reads the name
    staleTime: 10 * 60_000,
  });

const PLANS_STALE_MS = 10 * 60_000;
const fetchPlans = () => api.get<PlansDTO>("/api/plans");

/** Prices and methods change with a deploy, not while the app is open. */
export const usePlans = () =>
  useQuery({ queryKey: qk.plans, queryFn: fetchPlans, staleTime: PLANS_STALE_MS });

/** Warms the plans for a user who can open the boost sheet, so it appears with content instead of a skeleton. */
export function usePrefetchPlans(enabled: boolean): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (enabled)
      void qc.prefetchQuery({ queryKey: qk.plans, queryFn: fetchPlans, staleTime: PLANS_STALE_MS });
  }, [enabled, qc]);
}

export const useChains = (sort: "trending" | "new" | "featured") =>
  useInfiniteQuery({
    queryKey: qk.chains(sort),
    queryFn: ({ pageParam }) =>
      api.get<Page<ChainDTO>>(`/api/chains?sort=${sort}${pageParam ? `&cursor=${pageParam}` : ""}`),
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

export const useChain = (id: string) =>
  useQuery({
    queryKey: qk.chain(id),
    queryFn: () => api.get<ChainDetailDTO>(`/api/chains/${id}`),
  });

export const useChainPosts = (id: string, enabled: boolean) =>
  useInfiniteQuery({
    queryKey: qk.posts(id),
    enabled,
    queryFn: ({ pageParam }) =>
      api.get<Page<PostDTO>>(`/api/chains/${id}/posts${pageParam ? `?cursor=${pageParam}` : ""}`),
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

export const useCreateChain = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ChainInput) => api.post<ChainDTO>("/api/chains", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chains"] }),
  });
};

export const useMyPosts = () =>
  useInfiniteQuery({
    queryKey: qk.myPosts,
    queryFn: ({ pageParam }) =>
      api.get<Page<MyPostDTO>>(`/api/me/posts${pageParam ? `?cursor=${pageParam}` : ""}`),
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

/** Home carousel: active boosts only (the server decides with boostedUntil > now). */
export const useBoosted = () =>
  useQuery({
    queryKey: qk.boosted,
    queryFn: () => api.get<ChainDTO[]>("/api/chains/boosted"),
    staleTime: 30_000,
  });

export const useMyChains = () =>
  useInfiniteQuery({
    queryKey: qk.myChains,
    queryFn: ({ pageParam }) =>
      api.get<Page<ChainDTO>>(`/api/me/chains${pageParam ? `?cursor=${pageParam}` : ""}`),
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

/** After anything that can change a chain's boost/channel state: refresh every view that shows it. */
export function useInvalidateChains() {
  const qc = useQueryClient();
  return useCallback(
    () =>
      Promise.all(
        [qk.boosted, ["chains"], ["chain"], qk.myChains].map((queryKey) =>
          qc.invalidateQueries({ queryKey }),
        ),
      ),
    [qc],
  );
}

export const usePatchChain = (id: string) => {
  const invalidate = useInvalidateChains();
  return useMutation({
    mutationFn: (patch: {
      channelUrl?: string | null;
      emoji?: string | null;
      description?: string | null;
    }) => api.patch<ChainDTO>(`/api/chains/${id}`, patch),
    onSuccess: () => invalidate(),
  });
};
