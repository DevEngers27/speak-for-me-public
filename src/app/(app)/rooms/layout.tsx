import type { ReactNode } from "react";

/**
 * Product layout for `/rooms` (13 §13.2, FE-D14, I-FE-10, W1-6-r03).
 * Renders authenticated room views directly with no prototype chrome.
 */
export default function RoomsLayout({ children }: { children: ReactNode }) {
  return <main className="rooms-layout">{children}</main>;
}
