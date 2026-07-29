import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { BELTCON_QUERY_RETRY, BELTCON_QUERY_STALE_TIME } from "./lib/queryPolicy";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: BELTCON_QUERY_STALE_TIME.readerConfiguration,
        retry: BELTCON_QUERY_RETRY.read,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
