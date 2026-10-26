"use client";

// ---------------------------------------------------------------------------
// Website Redesigner — the whole app as one component, so it can be mounted
// as App Builder's "Website Redesigner" section.
//
// Three views behind the docked toggle: V1 (the seven-composition
// redesigner), V2 (the bake-off console) and Showcase (app ideas). Which one
// is in the address as `?v=`; reading it here, not in a page, is what lets the
// studio home mount this like any other section.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { Redesigner } from "./Redesigner";
import { BakeOff } from "./v2/BakeOff";
import { Showcase } from "./Showcase";
import { VersionToggle, type RedesignerView } from "./v2/VersionToggle";
import { REDESIGNER_FONTS } from "./fonts";

function viewFromUrl(): RedesignerView {
  if (typeof window === "undefined") return 1;
  const v = new URLSearchParams(window.location.search).get("v");
  return v === "2" ? 2 : v === "showcase" ? "showcase" : 1;
}

// `embedded` is accepted so the studio home can mount it; the Redesigner has
// no hub chrome of its own to drop beyond the back link, which the home's
// stylesheet hides.
export function WebsiteRedesigner(props: { embedded?: boolean }) {
  void props;
  const [view] = useState<RedesignerView>(viewFromUrl);
  return (
    <div className={`rdx-home ${REDESIGNER_FONTS}`} data-view={String(view)}>
      {view === 2 ? <BakeOff /> : view === "showcase" ? <Showcase /> : <Redesigner />}
      <VersionToggle current={view} />
    </div>
  );
}
