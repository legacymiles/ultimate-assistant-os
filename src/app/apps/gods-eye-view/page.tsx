import type { Metadata } from "next";
import GodsEyeClient from "./GodsEyeClient";

export const metadata: Metadata = {
  title: "God's Eye View",
  description:
    "A spy-satellite view of the live planet — real flights, satellites, earthquakes and public cameras on a 3D globe, through CRT, NVG and FLIR sensor looks.",
};

export default function Page() {
  return <GodsEyeClient />;
}
