import { Suspense } from "react";
import { BottomNav } from "@/components/hub/BottomNav";
import { HubHome } from "@/components/hub/HubHome";

export default function Page() {
  return (
    <>
      <Suspense fallback={null}>
        <HubHome />
      </Suspense>
      <BottomNav />
    </>
  );
}
