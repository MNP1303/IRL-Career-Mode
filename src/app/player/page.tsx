import type { Metadata } from "next";
import { PlayerScreen } from "@/components/screens/player-screen";
import { PageTransition } from "@/components/motion/page-transition";

export const metadata: Metadata = { title: "Player" };

export default function Page() {
  return (
    <PageTransition>
      <PlayerScreen />
    </PageTransition>
  );
}
