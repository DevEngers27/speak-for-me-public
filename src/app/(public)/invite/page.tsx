import type { Metadata } from "next";
import { APP_NAME } from "@core/engine/ui";
import { InviteLandingClient } from "@/components/invite/InviteLandingClient";

export const metadata: Metadata = {
  title: `Room Invitation · ${APP_NAME}`,
  referrer: "no-referrer",
};

export default function InvitePage() {
  return <InviteLandingClient />;
}
