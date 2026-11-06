import type { Metadata } from "next";
import { AccountScreen } from "@/components/screens/account-screen";
import { PageTransition } from "@/components/motion/page-transition";

export const metadata: Metadata = { title: "Account" };

export default function Page() {
  return (
    <PageTransition>
      <AccountScreen />
    </PageTransition>
  );
}
