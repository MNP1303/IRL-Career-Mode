import type { Metadata } from "next";
import { Suspense } from "react";
import { MatchDetailScreen } from "@/components/screens/match-detail-screen";
import { PageTransition } from "@/components/motion/page-transition";

export const metadata: Metadata = { title: "Match report" };

export default function Page() {
  return (
    <PageTransition>
      <Suspense fallback={<div className="skeleton h-80" />}>
        <MatchDetailScreen />
      </Suspense>
    </PageTransition>
  );
}
