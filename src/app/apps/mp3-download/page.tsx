import { Mp3Download } from "@/components/mp3-download/Mp3Download";

export const metadata = {
  title: "MP3 Download · Ultimate Assistant OS",
  description:
    "Search a song, confirm it is the right recording, then download a file of it — from the Internet Archive, the Creative Commons catalogues, or YouTube through yt-dlp, with the licence on every row.",
};

export default function Page() {
  return <Mp3Download />;
}
