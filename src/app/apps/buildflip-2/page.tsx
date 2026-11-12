import Landing from "@/components/buildflip-2/landing/Landing";
import { currentUser } from "@/lib/buildflip-2/supabase/server";

export default async function HomePage() {
  const user = await currentUser();
  return (
    <div id="main">
      <Landing signedIn={Boolean(user)} />
    </div>
  );
}
