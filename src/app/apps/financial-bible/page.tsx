import { redirect } from "next/navigation";
import { isRoom } from "@/lib/bible/rooms";

// Financial Bible is the Bible tab of Money Agent Studio now — the money the
// agents make and the plan it is spent against belong behind one door. The
// route stays alive because links to it exist (Jarvis chat, the catalog detail
// page, the Smartcar-era bookmarks), and `?studio=` is carried across so a
// link that named a room still lands in that room.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ studio?: string }>;
}) {
  const { studio } = await searchParams;
  const room = isRoom(studio) ? `&studio=${studio}` : "";
  redirect(`/apps/money-agent-studio?tab=bible${room}`);
}
