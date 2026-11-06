import { HubScreen } from "@/components/screens/hub-screen";
import { PageTransition } from "@/components/motion/page-transition";

export default function Page() {
  return (
    <PageTransition>
      <HubScreen />
    </PageTransition>
  );
}
