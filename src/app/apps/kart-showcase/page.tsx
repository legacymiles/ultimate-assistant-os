import type { Metadata } from "next";
import KartClient from "./KartClient";

export const metadata: Metadata = {
  title: "APEX/01 · Kart Teardown",
  description:
    "An interactive 3D racing-kart teardown — orbit the machine, pull it apart to inspect every part, then scroll into a first-person ride.",
};

export default function Page() {
  return <KartClient />;
}
