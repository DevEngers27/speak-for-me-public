import { RequestRoute } from "@/components/room/RoomScreens";

export default async function RoomHumanRequestPage({
  params,
}: {
  params: Promise<{ roomId: string; requestId: string }>;
}) {
  const { requestId } = await params;
  return <RequestRoute requestId={requestId} />;
}
