import { describe, expect, it } from "vitest";
import {
  cleanFileTitle,
  coverage,
  downloadName,
  fileNameFrom,
  durationCloseness,
  formatBytes,
  formatDuration,
  normalize,
  scoreCandidate,
} from "./match";
import { isAllowedFileUrl, licenceFromUrl } from "./sources";
import { isSupportedMediaUrl, isYouTubeUrl } from "./ytdlp";
import type { Track } from "./types";

const track: Track = {
  id: "1",
  title: "Blinding Lights",
  artist: "The Weeknd",
  album: "After Hours",
  artworkUrl: "",
  previewUrl: null,
  durationMs: 200_040,
  releaseDate: "2019-11-29T12:00:00Z",
  genre: "Pop",
  explicit: false,
  trackNumber: 9,
  trackCount: 14,
  discNumber: 1,
  storeUrl: "",
};

describe("normalize", () => {
  it("folds diacritics so two catalogues agree on one name", () => {
    expect(normalize("ROSALÍA")).toBe("rosalia");
  });

  it("drops release noise that is not part of the song", () => {
    expect(normalize("Purple Rain (2015 Remaster)")).toBe("purple rain");
    expect(normalize("Levitating (Official Audio)")).toBe("levitating");
  });

  it("drops a featured-artist credit", () => {
    expect(normalize("Savage Remix (feat. Beyoncé)")).toBe("savage remix");
    expect(normalize("Stay ft. Justin Bieber")).toBe("stay");
  });

  it("drops the credit WITHOUT eating the song that follows it", () => {
    // The bug this guards: a greedy credit pattern ran past "ft. ROSALÍA" and
    // swallowed the title too, so every YouTube hit for a collaboration
    // scored zero and the source table came back empty.
    const folded = normalize("The Weeknd ft. ROSALÍA - Blinding Lights [Remix] (Official Lyric Video)");
    expect(folded).toContain("blinding lights");
    expect(folded).toContain("remix");
    expect(folded).not.toContain("rosalia");
  });
});

describe("coverage", () => {
  it("is asymmetric — the song inside a longer upload title still counts", () => {
    expect(coverage("Moonlight Sonata", "Moonlight Sonata, live at Wigmore Hall")).toBe(1);
    expect(coverage("Moonlight Sonata, live at Wigmore Hall", "Moonlight Sonata")).toBeLessThan(1);
  });

  it("ignores stop words so 'The Weeknd' matches 'Weeknd'", () => {
    expect(coverage("The Weeknd", "Weeknd")).toBe(1);
  });
});

describe("durationCloseness", () => {
  it("treats a two-second difference as the same recording", () => {
    expect(durationCloseness(200_000, 201_500)).toBe(1);
  });

  it("gives nothing to a runtime half a minute out", () => {
    expect(durationCloseness(200_000, 235_000)).toBe(0);
  });
});

describe("scoreCandidate", () => {
  it("scores an exact title, artist and length near the top", () => {
    const { score } = scoreCandidate(track, {
      title: "Blinding Lights",
      creator: "The Weeknd",
      durationMs: 200_000,
    });
    expect(score).toBeGreaterThanOrEqual(95);
  });

  it("caps a cover, however well the title matches", () => {
    const { score, reasons } = scoreCandidate(track, {
      title: "Blinding Lights",
      creator: "Piano Covers Daily",
      durationMs: 200_000,
    });
    expect(score).toBeLessThanOrEqual(62);
    expect(reasons).toContain("Different artist — likely a cover");
  });

  it("marks a length that is well off", () => {
    const { reasons } = scoreCandidate(track, {
      title: "Blinding Lights",
      creator: "The Weeknd",
      durationMs: 600_000,
    });
    expect(reasons).toContain("Length is well off");
  });

  it("still matches a collaboration whose upload title carries a credit", () => {
    const remix = { ...track, title: "Blinding Lights (Remix)", artist: "The Weeknd & ROSALÍA" };
    const { score } = scoreCandidate(remix, {
      title: "The Weeknd ft. ROSALÍA - Blinding Lights [Remix] (Official Lyric Video)",
      creator: "The Weeknd",
      durationMs: remix.durationMs,
    });
    expect(score).toBeGreaterThan(30);
  });

  it("ranks a cover below the record even when it credits the real artist", () => {
    const real = scoreCandidate(track, {
      title: "The Weeknd - Blinding Lights (Official Audio)",
      creator: "The Weeknd",
      durationMs: track.durationMs,
    });
    const cover = scoreCandidate(track, {
      title: "The Weeknd - Blinding Lights (IMY2 Cover)",
      creator: "IMY2",
      durationMs: track.durationMs,
    });
    expect(cover.score).toBeLessThan(real.score);
    expect(cover.reasons.join(" ")).toContain("not the original recording");
  });

  it("marks the other not-the-record variants too", () => {
    for (const title of [
      "Blinding Lights (Karaoke Version)",
      "Blinding Lights - Instrumental",
      "The Weeknd - Blinding Lights (slowed + reverb)",
      "Blinding Lights (8D AUDIO)",
    ]) {
      const { score } = scoreCandidate(track, {
        title,
        creator: "The Weeknd",
        durationMs: track.durationMs,
      });
      expect(score).toBeLessThanOrEqual(58);
    }
  });

  it("finds the artist when the upload puts it in the title", () => {
    const inTitle = scoreCandidate(track, {
      title: "The Weeknd - Blinding Lights",
      creator: "SomeUploader",
      durationMs: 200_000,
    });
    expect(inTitle.score).toBeGreaterThan(80);
  });
});

describe("cleanFileTitle", () => {
  it("strips the extension and a leading track number", () => {
    expect(cleanFileTitle("03 - Moonlight Sonata.mp3")).toBe("Moonlight Sonata");
    expect(cleanFileTitle("audio.flac")).toBe("audio");
  });
});

describe("downloadName", () => {
  it("names the file from the confirmed metadata, not the source", () => {
    expect(downloadName(track, "MP3")).toBe("The Weeknd - Blinding Lights.mp3");
  });

  it("removes characters Windows will not accept in a filename", () => {
    const awkward = { ...track, title: 'A/B: "C" <D>' };
    expect(downloadName(awkward, "mp3")).toBe("The Weeknd - AB C D.mp3");
    expect(fileNameFrom("a\\b", "c|d", "mp4")).toBe("ab - cd.mp4");
  });
});

describe("fileNameFrom", () => {
  it("drops an empty half rather than naming a file ' - .mp3'", () => {
    expect(fileNameFrom("", "Some Upload", "mp3")).toBe("Some Upload.mp3");
    expect(fileNameFrom("A Channel", "", "mp4")).toBe("A Channel.mp4");
  });

  it("never produces a nameless file", () => {
    expect(fileNameFrom("", "", "mp3")).toBe("download.mp3");
  });
});

describe("isSupportedMediaUrl", () => {
  it("takes the sites the paste box advertises, on any subdomain", () => {
    expect(isSupportedMediaUrl("https://www.youtube.com/watch?v=abc")).toBe(true);
    expect(isSupportedMediaUrl("https://vm.tiktok.com/ZMabc/")).toBe(true);
    expect(isSupportedMediaUrl("https://soundcloud.com/artist/track")).toBe(true);
    expect(isSupportedMediaUrl("https://artist.bandcamp.com/track/x")).toBe(true);
  });

  it("refuses everything else, so the route is not an arbitrary fetcher", () => {
    expect(isSupportedMediaUrl("https://internal.local/admin")).toBe(false);
    expect(isSupportedMediaUrl("http://169.254.169.254/latest/meta-data/")).toBe(false);
    expect(isSupportedMediaUrl("https://youtube.com.evil.net/watch?v=a")).toBe(false);
    expect(isSupportedMediaUrl("file:///etc/passwd")).toBe(false);
    expect(isSupportedMediaUrl("nonsense")).toBe(false);
  });
});

describe("formatting", () => {
  it("renders durations and sizes, and says so when it has neither", () => {
    expect(formatDuration(200_040)).toBe("3:20");
    expect(formatDuration(null)).toBe("—");
    expect(formatBytes(7_472_488)).toBe("7.1 MB");
    expect(formatBytes(null)).toBe("—");
  });
});

describe("licenceFromUrl", () => {
  it("reads the tier out of a creativecommons URL", () => {
    expect(licenceFromUrl("https://creativecommons.org/publicdomain/zero/1.0/")?.kind).toBe(
      "public-domain",
    );
    expect(licenceFromUrl("https://creativecommons.org/licenses/by-sa/3.0/")?.label).toBe(
      "CC BY-SA 3.0",
    );
    expect(licenceFromUrl(undefined)).toBeNull();
  });
});

describe("isAllowedFileUrl", () => {
  it("accepts the hosts the sources actually return", () => {
    expect(isAllowedFileUrl("https://archive.org/download/x/y.mp3")).toBe(true);
    expect(isAllowedFileUrl("https://cdn.freesound.org/previews/1/1.mp3")).toBe(true);
    expect(isAllowedFileUrl("https://prod-1.storage.jamendo.com/?trackid=1")).toBe(true);
  });

  it("refuses anything else, so the proxy is not an open one", () => {
    expect(isAllowedFileUrl("https://evil.example.com/x.mp3")).toBe(false);
    expect(isAllowedFileUrl("http://archive.org/x.mp3")).toBe(false);
    expect(isAllowedFileUrl("file:///etc/passwd")).toBe(false);
    expect(isAllowedFileUrl("https://archive.org.evil.com/x.mp3")).toBe(false);
    expect(isAllowedFileUrl("not a url")).toBe(false);
  });
});

describe("isYouTubeUrl", () => {
  it("accepts the real hosts and nothing that merely looks like them", () => {
    expect(isYouTubeUrl("https://www.youtube.com/watch?v=abc")).toBe(true);
    expect(isYouTubeUrl("https://youtu.be/abc")).toBe(true);
    expect(isYouTubeUrl("https://youtube.com.evil.net/watch?v=abc")).toBe(false);
    expect(isYouTubeUrl("https://vimeo.com/1")).toBe(false);
  });
});
