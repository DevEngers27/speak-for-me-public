import { ClerkProvider } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { APP_NAME } from "@core/engine/ui";
import { AppAuthShell } from "@/components/auth/AppAuthShell";
import { ConvexClientProvider } from "@/components/providers";
import { isClerkConfigured } from "@/lib/clerk-env";
import { getServiceConfig } from "@/lib/config";
import "@/app/globals.css";

export const metadata: Metadata = {
  title: APP_NAME,
  description:
    "Multi-party AI negotiation with private constraints and explicit human approval.",
};

/**
 * Authenticated product root layout (`(app)`) (13 §13.2, FE-D13, FE-D14, W1-6-r08).
 * Calls `await auth.protect()` on the server as the client-navigation fallback
 * and mounts `AppAuthShell` (`users.viewer` -> `users.ensureViewer` before business queries).
 */
export default async function AppRootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const config = getServiceConfig();
  if (config.mode === "unconfigured" || !isClerkConfigured()) {
    redirect("/setup?missing=clerk");
  }

  await auth.protect();

  return (
    <html lang="en">
      <body>
        <ClerkProvider publishableKey={config.clerkPublishableKey}>
          <ConvexClientProvider convexUrl={config.convexUrl}>
            <AppAuthShell>{children}</AppAuthShell>
          </ConvexClientProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
