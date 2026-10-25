"use client";

import { useAuth } from "@clerk/nextjs";
import { ConvexReactClient, useConvexConnectionState } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { createContext, useContext, useState, type ReactNode } from "react";

/** Whether a live backend (Clerk + Convex) is mounted above this point. */
const BackendStatus = createContext<{ live: boolean }>({ live: false });

export function useBackendStatus() {
  return useContext(BackendStatus);
}

/**
 * Mounted (inside the server-side ClerkProvider) only when all three variables are
 * present. Otherwise no ConvexReactClient exists, so no code path can read or write.
 */
export function ConvexClientProvider({ children, convexUrl }: { children: ReactNode; convexUrl: string }) {
  const [client] = useState(() => new ConvexReactClient(convexUrl));
  return (
    <ConvexProviderWithClerk client={client} useAuth={useAuth}>
      <BackendStatus.Provider value={{ live: true }}><ConnectionBanner />{children}</BackendStatus.Provider>
    </ConvexProviderWithClerk>
  );
}

/** Renders `children` only under LiveProviders; otherwise renders `fallback`. */
export function BackendGate({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  return useBackendStatus().live ? <>{children}</> : <>{fallback}</>;
}

function ConnectionBanner() { const connection=useConvexConnectionState();return !connection.isWebSocketConnected && connection.hasEverConnected ? <div className="connection-banner" role="status">Reconnecting… Live updates are paused. Your last confirmed data remains visible.</div> : null; }
