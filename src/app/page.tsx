import { Suspense } from "react";
import { BottomNav } from "@/components/hub/BottomNav";
import { HubShell } from "@/components/hub/HubShell";

export default function Page() {
  return (
    <>
      <Suspense fallback={null}>
        <HubShell />
      </Suspense>
      <BottomNav />
    </>
  );
}
