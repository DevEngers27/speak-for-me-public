import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { APP_NAME } from "@core/engine/ui";
import { ConvexClientProvider } from "@/components/providers";
import { getServiceConfig } from "@/lib/config";
import "@/app/globals.css";

export const metadata: Metadata = {
  title: APP_NAME,
  description:
    "Multi-party AI negotiation with private constraints and explicit human approval.",
};

export default function PublicRootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const config = getServiceConfig();
  return (
    <html lang="en">
      <body>
        {config.mode === "configured" ? (
          <ClerkProvider publishableKey={config.clerkPublishableKey}>
            <ConvexClientProvider convexUrl={config.convexUrl}>
              {children}
            </ConvexClientProvider>
          </ClerkProvider>
        ) : (
          children
        )}
      </body>
    </html>
  );
}
