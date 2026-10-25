import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { ClerkProvider } from "@clerk/nextjs";
import { ConvexClientProvider } from "@/components/providers";
import { getServiceConfig } from "@/lib/config";
import "./globals.css";

export const metadata: Metadata = { title: "Speak for Me", description: "Multi-party AI negotiation workspace." };
// Every page depends on per-request auth; never prerender user-specific output.
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const config = getServiceConfig();
  const shell = (
    <>
      <header>
        <Link href="/">Speak for Me</Link>
        <nav aria-label="Main">
          <Link href="/rooms">Rooms</Link> <Link href="/setup">Setup</Link>
        </nav>
      </header>
      {config.mode === "unconfigured" && (
        <p role="status" className="banner">
          Backend not configured ({config.missing.join(", ")}). Data features are disabled.
        </p>
      )}
      <main>{children}</main>
    </>
  );
  return (
    <html lang="en">
      <body>
        {config.mode === "configured" ? (
          <ClerkProvider publishableKey={config.clerkPublishableKey}>
            <ConvexClientProvider convexUrl={config.convexUrl}>{shell}</ConvexClientProvider>
          </ClerkProvider>
        ) : (
          shell
        )}
      </body>
    </html>
  );
}
