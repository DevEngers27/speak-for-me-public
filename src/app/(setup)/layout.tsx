import type { Metadata } from "next";
import type { ReactNode } from "react";
import { APP_NAME } from "@core/engine/ui";
import "@/app/globals.css";

export const metadata: Metadata = {
  title: `Setup · ${APP_NAME}`,
  description: "Environment diagnostic for authentication and backend configuration.",
};

/**
 * Independent root layout for `/setup` (13 §13.2, FE-D13, W1-6-r08).
 * Deliberately mounts zero auth or backend providers so `/setup` always renders
 * even when environment keys or URLs are missing or invalid.
 */
export default function SetupRootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
