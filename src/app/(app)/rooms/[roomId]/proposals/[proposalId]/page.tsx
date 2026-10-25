import { ProposalRoute } from "@/components/room/RoomScreens";

export default async function RoomProposalDecisionPage({
  params,
}: {
  params: Promise<{ roomId: string; proposalId: string }>;
}) {
  const { proposalId } = await params;
  return <ProposalRoute proposalId={proposalId} />;
}
