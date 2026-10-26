"use client";

// ---------------------------------------------------------------------------
// Website Redesigner › Showcase — app ideas worth building again.
//
// EMBER Reveal and the APEX/01 Kart Teardown used to be tiles of their own.
// They are reference pieces now: each plays in place here (their routes stay
// alive for exactly this), opens full screen, and "Use this idea" hands App
// Builder's Build section a one-line brief to start from.
// ---------------------------------------------------------------------------

import { IDEA_PARAM, SHOWCASE, showcaseIdea } from "@/lib/studio-home/builder";
import { sectionHref } from "@/lib/studio-home/sections";
import { goToSection } from "../studio-home/go";
import { PlayShelf, type ShelfItem } from "../studio-home/PlayShelf";

const ITEMS: ShelfItem[] = SHOWCASE.map((s) => ({
  slug: s.slug,
  title: s.title,
  tag: s.tag,
  overview: s.overview,
  route: s.route,
  hue: s.hue,
  cols: [s.tag, s.route],
  posterNote: "WebGL — move the pointer over it once it loads",
}));

export function Showcase() {
  return (
    <div className="rdx-showcase">
      <PlayShelf
        title="Showcase"
        lede="Interactive pieces worth building again. Play one here, or start a new app from it."
        count={`${ITEMS.length} pieces`}
        heads={["Piece", "What it is", "Lives at"]}
        items={ITEMS}
        action={{
          label: "Use this idea",
          run: (it) => {
            const idea = showcaseIdea(it);
            goToSection("build", { [IDEA_PARAM]: idea }, sectionHref("/apps/app-builder", "build", { [IDEA_PARAM]: idea }));
          },
        }}
      />
    </div>
  );
}
