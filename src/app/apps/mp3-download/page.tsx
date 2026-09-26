import { redirect } from "next/navigation";

// MP3 Download is now the Find studio inside Jarvis Audio Studio. The route
// stays alive because links to it exist — in the owner's bookmarks, in Jarvis's
// toolkit, in earlier notes — and a merge should not turn those into 404s.
export default function Page() {
  redirect("/apps/jarvis-audio-studio?section=find");
}
