"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";

/** Live subscription to the public health probe. Must render under BackendGate. */
export function EngineStatus() {
  const ping = useQuery(api.health.ping);
  const { isAuthenticated, isLoading } = useConvexAuth();
  if (ping == null) return <p>Connecting to Convex...</p>;
  return (
    <p>
      Convex {ping.ok ? "connected" : "unavailable"} · auth:{" "}
      {isLoading ? "loading" : isAuthenticated ? "signed in" : "signed out"}
    </p>
  );
}
