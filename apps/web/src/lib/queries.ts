import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { api } from "./api";

export const qk = {
  session: ["session"] as const,
  chains: (sort: string) => ["chains", sort] as const,
  chain: (id: string) => ["chain", id] as const,
  posts: (id: string) => ["posts", id] as const,
  plans: ["plans"] as const,
  myPosts: ["my-posts"] as const,
};

export const useSession = () =>
  useQuery({
    queryKey: qk.session,
    queryFn: () => api.post<SessionDTO>("/api/auth/session"),
    staleTime: 30_000,
    retry: 1,
  });

export const usePlans = () =>
  useQuery({ queryKey: qk.plans, queryFn: () => api.get<PlansDTO>("/api/plans") });

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
    retry: (count, err) => (err as { status?: number }).status !== 404 && count < 2,
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
