"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";

/** Live subscription to the public health probe. Must render under BackendGate. */
export function EngineStatus() {
  const ping = useQuery(api.engine.health.ping);
  const { isAuthenticated, isLoading } = useConvexAuth();
  if (ping === undefined) return <p>Connecting to Convex...</p>;
  return (
    <p>
      Engine {ping.engineVersion} · scenarios: {ping.scenarios.join(", ")} · auth:{" "}
      {isLoading ? "loading" : isAuthenticated ? "signed in" : "signed out"}
    </p>
  );
}
