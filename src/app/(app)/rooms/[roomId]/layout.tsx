import type { ReactNode } from "react";
import { RoomFrame } from "@/components/room/RoomFrame";

export default async function RoomLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = await params;
  return <RoomFrame roomId={roomId}>{children}</RoomFrame>;
}
