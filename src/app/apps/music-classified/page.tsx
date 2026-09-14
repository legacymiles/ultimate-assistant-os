import { MusicClassified } from "@/components/music-classified/MusicClassified";

export const metadata = {
  title: "Music Classified · Ultimate Assistant OS",
  description:
    "File your favourite songs by energy level 1–10, genre and sub-genre, with AI descriptions of how each one sounds and how to make something like it.",
};

export default function Page() {
  return <MusicClassified />;
}
