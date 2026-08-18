import RoomClient from "@/components/room/RoomClient";
import { normalizeCode } from "@/lib/game/engine";

export const dynamic = "force-dynamic";

export function generateMetadata({ params }: { params: { code: string } }) {
  const code = normalizeCode(params.code);
  return {
    title: `Room ${code} · Consensus Radar`,
    description: `Join room ${code} and tune into your team's wavelength.`,
  };
}

export default function RoomPage({ params }: { params: { code: string } }) {
  return <RoomClient code={normalizeCode(params.code)} />;
}
