"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider as TanstackQueryClientProvider } from "@tanstack/react-query";

/**
 * One QueryClient per browser tab, created lazily so it survives Fast
 * Refresh/re-renders of the admin shell without resetting the cache —
 * `useState(() => new QueryClient())` is the documented pattern for this
 * (a plain `new QueryClient()` at module scope would leak across users on
 * the server; this file is "use client" only, but keeping the lazy-init
 * habit here too costs nothing and matches every React Query example).
 */
export function QueryClientProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient());
  return <TanstackQueryClientProvider client={client}>{children}</TanstackQueryClientProvider>;
}
