import { FriendsNightOut } from "@/components/friends-night-out/FriendsNightOut";

export const metadata = {
  title: "Friends Night Out · Ultimate Assistant OS",
  description:
    "Find the events near you that nobody posted about — plus the standing and seasonal stuff you can go do any day, colour-coded free vs paid.",
};

export default function Page() {
  return <FriendsNightOut />;
}
