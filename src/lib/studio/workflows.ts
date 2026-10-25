// ---------------------------------------------------------------------------
// Studio workflows — the video and image "skills" behind Jarvis's Studio tab.
//
// A workflow is a named way of making one kind of video or image: what it is,
// the brief a director would follow, and (only where tone actually changes the
// result) the style keywords the owner can stack on it. Some have variants,
// shown as a dropdown on the card — E-commerce is one card, nine shoots.
//
// Workflows mix: the owner can pick several (in Studio, or with @ in chat) and
// Jarvis combines their briefs into one production prompt.
//
// ADD ONE = add an object to WORKFLOWS. Ids are the @-mention names, so they
// are lowercase-with-dashes and never change once shipped. `preview` takes the
// card's looping clip when it exists; until then the card animates its motif.
// ---------------------------------------------------------------------------

export type Medium = "video" | "image";

export type CategoryId =
  | "stories"
  | "talk"
  | "ads"
  | "film"
  | "performance"
  | "athletes"
  | "events"
  | "creators"
  | "influencers"
  | "broadcast"
  | "romance"
  | "camera"
  | "social"
  | "occasions"
  | "shoots"
  | "covers"
  | "commerce-images"
  | "cards"
  | "restore"
  | "design"
  | "illustration"
  | "spaces";

export interface Category {
  id: CategoryId;
  medium: Medium;
  label: string;
}

export const CATEGORIES: Category[] = [
  { id: "stories", medium: "video", label: "Stories" },
  { id: "ads", medium: "video", label: "Ads & brand" },
  { id: "social", medium: "video", label: "Social" },
  { id: "film", medium: "video", label: "Film, music & games" },
  { id: "performance", medium: "video", label: "Performance & action" },
  { id: "athletes", medium: "video", label: "Athletes & sport" },
  { id: "events", medium: "video", label: "Events & fashion" },
  { id: "creators", medium: "video", label: "Creators & channels" },
  { id: "influencers", medium: "video", label: "Influencers" },
  { id: "broadcast", medium: "video", label: "TV & radio" },
  { id: "romance", medium: "video", label: "Romance & allure" },
  { id: "camera", medium: "video", label: "Camera moves" },
  { id: "talk", medium: "video", label: "Talk & teach" },
  { id: "occasions", medium: "video", label: "Occasions" },
  { id: "shoots", medium: "image", label: "Photo shoots" },
  { id: "covers", medium: "image", label: "Covers & posters" },
  { id: "commerce-images", medium: "image", label: "Product images" },
  { id: "cards", medium: "image", label: "Cards & occasions" },
  { id: "design", medium: "image", label: "Characters & design" },
  { id: "illustration", medium: "image", label: "Illustration & story art" },
  { id: "spaces", medium: "image", label: "Homes & spaces" },
  { id: "restore", medium: "image", label: "Fix & restore" },
];

/** The card's placeholder animation until a real preview clip exists. */
export type Motif =
  | "storybook"
  | "spotlight"
  | "confetti"
  | "loop"
  | "equalizer"
  | "letterbox"
  | "waveform"
  | "grid"
  | "candle"
  | "flash"
  | "orbit"
  | "rise";

export interface Variant {
  id: string;
  name: string;
  brief: string;
}

export interface Workflow {
  id: string;
  name: string;
  medium: Medium;
  category: CategoryId;
  /** One line on the card. */
  blurb: string;
  /** The skill: how a director makes this. Jarvis receives it verbatim. */
  brief: string;
  /** Default format, e.g. "9:16 · 15–30 s". */
  format: string;
  /** Style words worth offering. Absent = this workflow doesn't take keywords. */
  keywords?: string[];
  /** A dropdown of sub-workflows. The first is the default. */
  variants?: Variant[];
  motif: Motif;
  /** Card colour, 0–360. */
  hue: number;
  isNew?: boolean;
  preview?: { video?: string; poster?: string };
}

const TONE = ["luxury", "funny", "cinematic", "heartfelt", "minimal", "bold", "playful", "epic"];
const LOOK = ["3D animated", "cartoon", "anime", "watercolor", "claymation", "photoreal", "vintage film"];

export const WORKFLOWS: Workflow[] = [
  // ----- Stories --------------------------------------------------------------
  {
    id: "story-to-video",
    name: "Story to video",
    medium: "video",
    category: "stories",
    blurb: "Any story or script, told scene by scene",
    brief:
      "Break the story into 6–12 scenes with one clear visual beat each. Keep the same characters (describe face, hair, clothes once and reuse it word for word), write narration per scene, and end on an image that resolves the story.",
    format: "16:9 · 1–5 min",
    keywords: [...LOOK, "cinematic", "dreamy", "dark"],
    motif: "storybook",
    hue: 262,
  },
  {
    id: "kids-story",
    name: "Kids story video",
    medium: "video",
    category: "stories",
    blurb: "Bedtime tales with a lesson and a friendly narrator",
    brief:
      "Ages 3–8. Simple sentences, a warm narrator, one lovable hero, gentle stakes, a clear lesson in the last scene. Bright, soft-edged visuals, no scary imagery, slow cuts so small eyes can follow.",
    format: "16:9 · 2–6 min",
    keywords: ["3D animated", "cartoon", "watercolor", "claymation", "funny", "cozy"],
    motif: "storybook",
    hue: 38,
  },
  {
    // Rendered in CODE on the owner's PC (the cth9191/animate kit through the
    // animate-character-story skill), not by the video model: Round 3 hands
    // the approved brief and the character picture to In Queue with
    // studio_queue, and the PC session completes it. One character, one design,
    // every shot — which is the thing a clip-by-clip video model cannot hold.
    id: "animate-my-character",
    name: "Kids Animation Flow",
    medium: "video",
    category: "stories",
    blurb: "Attach your character, type the story — opens a storyboard, renders a cut-paper short on your PC",
    brief:
      "Read the uploaded character into a character sheet (head, skin, hair, eyes, each garment with its colour, one "
      + "signature item, the one colour that means him), pick a story shape, and write 8–11 beats for ~45 s: his "
      + "expression and visible action per beat, one world per beat, captions of six words or fewer, a silence before "
      + "the payoff and the loudest hit on it, the end returning to the first image changed. It renders in code on "
      + "the owner's PC: send the approved brief and the picture with studio_queue, never studio_generate.",
    format: "16:9 · ~45 s · cut paper",
    keywords: ["cut paper", "sketchbook", "riso", "pixel", "cozy", "funny", "adventurous"],
    motif: "storybook",
    hue: 24,
    isNew: true,
  },
  {
    // Made in CODE as a real Three.js scene (src/lib/studio/film3d): the
    // card's prompt opens the 3D Animation Flow screen, which plans the shots,
    // plays the film live, renders the MP4 in the browser, or hands the exact
    // film to the PC (threejs-film-story skill) for an HD render via
    // studio_queue. One character, one rig, every shot.
    id: "film-3d",
    name: "3D Animation Flow",
    medium: "video",
    category: "stories",
    blurb: "Attach your character, type the story — a 3D animated short made in code, plays live, renders right here",
    brief:
      "Read the uploaded character into a 3D toy figure (build, hair style and colour, skin, each garment with its colour, "
      + "one signature item, the one colour that means them), then write 7–12 beats for 30–60 s in the engine's own words: "
      + "a world, a time of day, a move, a face, a shot and a prop per beat, captions of six words or fewer, a silence before "
      + "the payoff and the loudest hit on it, the end returning to the first image changed. It renders in code (Three.js), "
      + "in the browser or on the owner's PC: hand the approved film over with studio_queue, never studio_generate.",
    format: "16:9 / 9:16 · 30–60 s · 3D",
    keywords: ["toy box", "clay", "storybook", "neon", "cozy", "funny", "adventurous"],
    motif: "orbit",
    hue: 200,
    isNew: true,
  },
  {
    id: "short-drama",
    name: "Short story drama",
    medium: "video",
    category: "stories",
    blurb: "Vertical micro-drama with a cliffhanger",
    brief:
      "Vertical episodic drama. Hook in the first 2 seconds (a slap, a secret, a reveal), escalate every 10 seconds, close on a cliffhanger line. Tight close-ups on faces, dialogue as on-screen subtitles.",
    format: "9:16 · 60–90 s per episode",
    keywords: ["romantic", "revenge", "betrayal", "cinematic", "dark"],
    motif: "letterbox",
    hue: 340,
  },
  {
    id: "religious-story",
    name: "Religious story video",
    medium: "video",
    category: "stories",
    blurb: "Scripture and parables, told with reverence",
    brief:
      "Faithful to the source text; name the book and verse when it is scripture. Reverent pacing, painterly golden light, respectful portrayal of figures, narration in a calm, warm voice, closing reflection line.",
    format: "16:9 · 2–8 min",
    keywords: ["painterly", "cinematic", "3D animated", "watercolor"],
    motif: "rise",
    hue: 45,
  },
  {
    id: "scary-story",
    name: "Scary story maker",
    medium: "video",
    category: "stories",
    blurb: "Creepypasta and campfire horror, slow-burn dread",
    brief:
      "Slow-burn dread: a normal setting, one wrong detail, escalation, a final reveal you only half see. Low-key lighting, long held shots, sound-led scares, first-person narration.",
    format: "9:16 or 16:9 · 1–10 min",
    keywords: ["found footage", "folk horror", "analog", "psychological", "creature"],
    motif: "candle",
    hue: 0,
  },
  {
    // ---- pipeline experiments -------------------------------------------
    // Each of these is a whole way of BUILDING a stitched film, kept as a
    // workflow so a pipeline that worked can be picked again and one that did
    // not can be read and argued with. They differ in shape — shot length, how
    // shots join, what gets anchored — not in subject.
    id: "long-take-chain",
    name: "Long-take chain",
    medium: "video",
    category: "stories",
    blurb: "Few long shots, chained — the fewest joins a film can have",
    brief:
      "Build the film out of the LONGEST shots H3 will render (12–15 s), not the shortest, because "
      + "every defect in a stitched film happens at a join: three 15 s shots have two joins where eight "
      + "5 s shots have seven. Open once on Ref2VA with the cast sheets and the set plate attached, then "
      + "stay on FL2VA (`continuous`) for as long as the action really is continuous, cutting back to a "
      + "referenced shot only when the story needs a new angle or the chain has run to two. Let each "
      + "shot's beat list do the work a cut would have done.",
    format: "16:9 · 12–15 s per shot, 2 joins per minute",
    motif: "letterbox",
    hue: 195,
    isNew: true,
  },
  {
    id: "cinematic-story",
    name: "Cinematic story",
    medium: "video",
    category: "stories",
    blurb: "A short film look: lenses, light and score",
    brief:
      "Direct it like a short film: establishing wide, motivated camera moves, shallow depth of field, a colour palette of 2–3 hues, score-driven pacing and one hero shot the whole piece builds to.",
    format: "2.39:1 · 30 s–3 min",
    keywords: ["noir", "epic", "dreamy", "gritty", "vintage film"],
    motif: "letterbox",
    hue: 210,
  },

  // ----- Ads & brand ------------------------------------------------------------
  {
    id: "product-ad",
    name: "Product ads",
    medium: "video",
    category: "ads",
    blurb: "The product is the star — 15 seconds to sell it",
    brief:
      "Hook with the product in motion in second one, show the benefit (not the feature) in use, a hero packshot, then the call to action. Product must stay identical shot to shot.",
    format: "9:16 + 1:1 · 15 s",
    keywords: TONE,
    motif: "spotlight",
    hue: 12,
  },
  {
    id: "commercial",
    name: "Commercial ads",
    medium: "video",
    category: "ads",
    blurb: "A TV-style spot with a story and a tagline",
    brief:
      "Broadcast structure: a relatable moment, a turn, the brand as the answer, tagline over logo. Actors, locations and a voice-over script with timings.",
    format: "16:9 · 30 s",
    keywords: TONE,
    motif: "letterbox",
    hue: 200,
  },
  {
    id: "ad-remake",
    name: "Ad remake",
    medium: "video",
    category: "ads",
    blurb: "Rebuild a winning ad for your brand",
    brief:
      "Take the reference ad's structure — shot order, timing, hook, camera moves — and rebuild it beat for beat with the owner's product, brand colours and copy. Never copy the reference's logo, people or words.",
    format: "Matches the reference",
    keywords: TONE,
    motif: "loop",
    hue: 280,
  },
  {
    id: "comedy-commercial",
    name: "Comedy commercial",
    medium: "video",
    category: "ads",
    blurb: "A product joke that lands without explaining itself",
    brief:
      "Build an original product-centred joke from a real audience tension: setup, rule, escalation, reaction, payoff, product reveal, tag — timed to the half second. The product must cause the payoff.",
    format: "16:9 or 9:16 · 10–30 s",
    keywords: ["deadpan", "absurdist", "physical", "observational", "gentle satire"],
    motif: "spotlight",
    hue: 55,
    isNew: true,
  },
  {
    id: "90s-commercial",
    name: "90s commercial ad",
    medium: "video",
    category: "ads",
    blurb: "A spot that could have aired in the break, 1990–1999",
    brief:
      "Reconstruct a 1990s TV spot: pick the part of the decade and the capture medium (35mm "
      + "telecine, Betacam SP, 16mm, worn VHS dub), then write the era as physical fact — period "
      + "wardrobe, props, cars and packaging, plus the artefacts of that medium (video gain, chroma "
      + "bleed on reds, blooming highlights, halation, interlace). Locked tripod, servo-zoom moves, "
      + "DVE squeeze wipes and freeze-frames, chunky extruded supers, a period VO archetype. "
      + "Composed for 4:3 inside a 1:1 render. Original pastiche only — never a real 90s brand, "
      + "jingle, mascot or celebrity.",
    format: "1:1 composed for 4:3 · 15, 30 or 60 s",
    keywords: TONE,
    variants: [
      { id: "toy", name: "Toy spot", brief: "Camera at kid height on a carpet or bedroom floor, fast cuts of kids playing and reacting, a demo of the toy's one trick, freeze-frame with a burst-in super, and the disclaimer along the bottom." },
      { id: "fast-food", name: "Fast food", brief: "Glamour macro of steam, melt and sizzle, a booth of friends laughing, a tray hero, and a value price in a yellow starburst." },
      { id: "dealership", name: "Local dealership", brief: "Blown-out daylight on a car lot, flags and balloons, the price written on a windshield, a fast-talk local voice, a hard end date." },
      { id: "studio-pitch", name: "Studio pitch", brief: "Presenter direct to camera on a seamless gradient cyc, the product turning on a chrome riser, squeeze wipe to the demo, price starburst, 1-800 number held five seconds." },
      { id: "hero-glamour", name: "Hero glamour", brief: "No dialogue: smoke-lit black stage, a single hard key raking the product, a slow orbit or crane, library music, one tagline card." },
      { id: "psa", name: "PSA", brief: "16mm, one hard source, a held silence, a single plain domestic image that carries the whole message, one line of type at the end." },
    ],
    motif: "flash",
    hue: 330,
    isNew: true,
  },
  {
    id: "ugc-ad",
    name: "UGC ads",
    medium: "video",
    category: "ads",
    blurb: "A real-person testimonial shot on a phone",
    brief:
      "Handheld selfie framing, natural light, a relatable creator talking to camera: problem, first try, honest reaction, result. Imperfect on purpose; captions burned in; ends with where to buy.",
    format: "9:16 · 20–45 s",
    keywords: ["funny", "honest", "excited", "calm", "gen-z"],
    motif: "waveform",
    hue: 160,
  },
  {
    id: "brand-film",
    name: "Brand film",
    medium: "video",
    category: "ads",
    blurb: "Why the brand exists, told as a feeling",
    brief:
      "Mission-first, product-second. Human moments, a manifesto voice-over in short lines, a consistent grade, and the logo only at the end.",
    format: "16:9 · 60–120 s",
    keywords: ["luxury", "heartfelt", "documentary", "bold", "minimal"],
    motif: "rise",
    hue: 225,
  },
  {
    id: "promo",
    name: "Promo video",
    medium: "video",
    category: "ads",
    blurb: "Launch, sale or event — loud and quick",
    brief:
      "Fast cuts on the beat, kinetic type with the offer, the date/deadline twice, and a single clear call to action. Every frame readable with the sound off.",
    format: "9:16 + 16:9 · 10–20 s",
    keywords: ["bold", "playful", "luxury", "urgent", "neon"],
    motif: "flash",
    hue: 320,
  },
  {
    id: "automotive-ad",
    name: "Automotive ad",
    medium: "video",
    category: "ads",
    blurb: "Tracking shots, wet roads, the reveal",
    brief:
      "Low tracking shots, rolling shots alongside, detail passes over lights and badge, wet-asphalt reflections, and a final hero stop. Keep the car's exact model, colour and wheels constant.",
    format: "16:9 · 30 s",
    keywords: ["luxury", "rugged", "futuristic", "night", "epic"],
    motif: "orbit",
    hue: 195,
  },
  {
    id: "sports-campaign",
    name: "Sports campaign",
    medium: "video",
    category: "ads",
    blurb: "Sweat, slow motion and a line that hits",
    brief:
      "Training grind to game moment. Speed ramps, slow-motion impact, sweat and breath detail, a short spoken line or manifesto, the brand mark on the final freeze.",
    format: "9:16 + 16:9 · 30 s",
    keywords: ["gritty", "epic", "inspiring", "street"],
    motif: "flash",
    hue: 25,
  },
  {
    id: "real-estate",
    name: "Real estate reveal & tour",
    medium: "video",
    category: "ads",
    blurb: "Listing photos into a walk-through film",
    brief:
      "Drone-style approach, front-door push-in, room-by-room glide in walking order, golden-hour exterior finish, price and contact card. Rooms must match the listing photos exactly.",
    format: "16:9 + 9:16 · 45–90 s",
    keywords: ["luxury", "cozy", "modern", "twilight"],
    motif: "rise",
    hue: 150,
    isNew: true,
  },
  {
    id: "hero-product-reveal",
    name: "Hero product reveal",
    medium: "video",
    category: "ads",
    blurb: "Darkness, a rim light, the product appears",
    brief:
      "Start in near-black, reveal the product with a moving rim light or particles, one slow orbit, end on a perfectly lit packshot with the name.",
    format: "1:1 + 9:16 · 6–10 s",
    keywords: ["luxury", "futuristic", "minimal", "epic"],
    motif: "spotlight",
    hue: 45,
  },
  {
    id: "product-showcase",
    name: "Product showcase video",
    medium: "video",
    category: "ads",
    blurb: "Every angle and feature, clean and clear",
    brief:
      "Turntable, then close-ups of each key feature with a short label, then the product in use, then all colourways side by side.",
    format: "1:1 · 15–30 s",
    keywords: ["minimal", "playful", "luxury", "techy"],
    motif: "orbit",
    hue: 175,
  },
  {
    id: "e-commerce",
    name: "E-commerce",
    medium: "video",
    category: "ads",
    blurb: "Nine store-ready product shoots in one",
    brief: "Store-ready product video. Keep the product's shape, label and colour exact in every shot.",
    format: "1:1 + 9:16 · 5–15 s",
    keywords: ["luxury", "minimal", "playful", "seasonal"],
    variants: [
      { id: "detail-macro", name: "Detail macro", brief: "Extreme close-ups of texture, stitching, finish and materials, with a slow focus pull." },
      { id: "flat-lay", name: "Flat lay", brief: "Top-down arrangement with complementary props that assemble or shift in a stop-motion rhythm." },
      { id: "lifestyle", name: "Lifestyle", brief: "The product in a real home, street or hands, used naturally by a person." },
      { id: "luxury-atmospherics", name: "Luxury atmospherics", brief: "Smoke, silk, water, marble and soft light around the product; slow and expensive." },
      { id: "seasonal-campaign", name: "Seasonal campaign", brief: "The product styled for the current season or holiday, with its colours and props." },
      { id: "model-showcase", name: "Model showcase", brief: "A model wearing or holding the product, turning and walking, catalogue-clean." },
      { id: "infographic", name: "Infographic", brief: "Animated callouts that point to features, sizes and benefits on the product." },
      { id: "creative-concept", name: "Creative concept", brief: "One surreal, scroll-stopping idea built around the product (giant scale, impossible physics)." },
      { id: "virtual-try-on", name: "Virtual try-on", brief: "The same person shown wearing the product in several colours or sizes, matched frame to frame." },
    ],
    motif: "grid",
    hue: 30,
    isNew: true,
  },
  {
    id: "luxury-fashion-walk",
    name: "Luxury fashion walk",
    medium: "video",
    category: "ads",
    blurb: "Campaign-grade runway and street walks",
    brief:
      "A model walking in the outfit, 15 s: fabric in motion, tracking and low-angle moves, texture close-ups, a final hold. The outfit stays exact in every shot.",
    format: "9:16 + 16:9 · 15 s",
    keywords: ["runway", "street", "editorial", "night", "minimal"],
    motif: "letterbox",
    hue: 300,
  },
  {
    id: "logo-reveal",
    name: "Logo reveals",
    medium: "video",
    category: "ads",
    blurb: "Your mark, assembling in 4 seconds",
    brief:
      "The logo builds from a material or motion that suits the brand (ink, light, particles, metal), settles in 3–4 seconds, holds 1 second. Exact logo geometry and colours.",
    format: "16:9 + 1:1 · 4–6 s",
    keywords: ["minimal", "luxury", "glitch", "playful", "3D"],
    motif: "orbit",
    hue: 250,
  },
  {
    id: "motion-graphics",
    name: "Motion graphics",
    medium: "video",
    category: "ads",
    blurb: "Type, shapes and data that move",
    brief:
      "Design in motion, not photography: graphic elements with weight and easing, a strict grid, one idea per beat. The video model cannot render legible copy, so the moving artwork and the typographic frames are made separately and composited — plan deliberate empty type zones into every moving plate.",
    format: "16:9 or 9:16 · 5–30 s",
    keywords: ["minimal", "bold", "retro", "3D", "glitch", "hand-drawn", "corporate", "playful"],
    variants: [
      {
        id: "kinetic-type",
        name: "Kinetic type",
        brief:
          "Words are the subject. One phrase at a time, scaled to fill the frame, entering and leaving on the beat; the moving plate carries only the field the type sits on.",
      },
      {
        id: "title-sequence",
        name: "Title sequence",
        brief:
          "A short opening sequence with a single repeating visual device and the credits cut into it; the device, not the type, carries the identity.",
      },
      {
        id: "data-viz",
        name: "Data in motion",
        brief:
          "Charts, counters and comparisons that animate in a readable order: axis first, then bars or line, then the label that names the point.",
      },
      {
        id: "broadcast-package",
        name: "Broadcast package",
        brief:
          "A matched set for a show or channel: lower third, transition wipe, bumper and end card, all built from one shape language.",
      },
      {
        id: "abstract-loop",
        name: "Abstract loop",
        brief:
          "A seamless looping field of shape, gradient or material motion, designed as a backplate for type or a product to sit on top of.",
      },
      {
        id: "ui-demo",
        name: "Product UI in motion",
        brief:
          "A screen or interface animating through a flow, framed on a device or floating in space, with each step held long enough to follow.",
      },
      {
        id: "infographic",
        name: "Animated infographic",
        brief:
          "A process or comparison built in steps, each element drawing itself in the order the narration needs it.",
      },
      {
        id: "logo-system",
        name: "Logo system in motion",
        brief:
          "The mark's behaviour rather than one reveal: how it enters, holds, transitions and endcaps, as a consistent set.",
      },
    ],
    motif: "grid",
    hue: 285,
    isNew: true,
  },

  // ----- Athletes & sport -------------------------------------------------------
  // Made FOR the athlete, not for a brand: no logo lockup, no campaign line, and
  // the person in frame owns the footage. `sports-campaign` is the brand version
  // of this territory and they mix deliberately, never by accident.
  {
    id: "workout-ad",
    name: "Workout ad",
    medium: "video",
    category: "athletes",
    blurb: "One workout, sold in fifteen seconds",
    brief:
      "Sell the feeling of the session, not the exercise list. Open mid-effort on the hardest rep, hold the form long enough to read, cut on the breath and the bar path. Sweat, chalk, plate noise and real strain; no smiling at the camera. End on the finished set, not a logo.",
    format: "9:16 + 16:9 · 15–30 s",
    keywords: ["high-energy", "gritty", "clean", "premium", "raw phone"],
    variants: [
      { id: "strength", name: "Strength", brief: "Barbell and rack work: bar bend, chalk, belt, the grind rep that slows and finishes." },
      { id: "bodyweight", name: "Home bodyweight", brief: "No equipment in a real room: floor work, controlled tempo, one continuous space." },
      { id: "running", name: "Running", brief: "Road or track: cadence, foot strike, breath fogging, distance eaten by the frame." },
      { id: "hiit", name: "HIIT class", brief: "Group energy, a clock on the wall, rotation between stations, collective effort." },
      { id: "conditioning", name: "Outdoor conditioning", brief: "Sleds, hills, sand or stairs, with weather and terrain doing the punishing." },
      { id: "mobility", name: "Recovery and mobility", brief: "Slow, quiet, unglamorous: stretching, banded work, breathing, ice." },
    ],
    motif: "flash",
    hue: 8,
    isNew: true,
  },
  {
    id: "training-montage",
    name: "Training montage",
    medium: "video",
    category: "athletes",
    blurb: "Warm-up to peak, one clip at a time",
    brief:
      "Three acts, in order: warm-up (cold, empty, alone), the grind (repetition, failure, small corrections), the performance (the thing it was all for). Time must visibly pass — light, weather, kit and body all change across the piece. Reuse one framing at the start and the end so the progress is measurable, not asserted.",
    format: "16:9 · 45–90 s",
    keywords: ["gritty", "epic", "inspiring", "vintage film", "cold"],
    variants: [
      { id: "solo", name: "Solo grind", brief: "One athlete, no crowd, no coach — the work nobody sees." },
      { id: "team", name: "Team pre-season", brief: "A squad becoming a unit: drills in formation, collective exhaustion, one voice counting." },
      { id: "comeback", name: "Back from injury", brief: "From rehab table to full speed; the brace, the limp and the first pain-free rep." },
      { id: "fight-camp", name: "Fight camp", brief: "Weeks to a date: weigh-in clock, pads, sparring marks, the walk to the scales." },
      { id: "rookie", name: "Rookie to starter", brief: "Last in the drill to first on the sheet; earning minutes rather than being given them." },
      { id: "off-season", name: "Off-season", brief: "Empty facility, no fixtures, nobody watching — the months that decide the season." },
    ],
    motif: "rise",
    hue: 35,
    isNew: true,
  },
  {
    id: "athlete-motivation",
    name: "Athlete motivation film",
    medium: "video",
    category: "athletes",
    blurb: "Discipline, struggle, payoff",
    brief:
      "Emotion carried by behaviour, never by a caption: the alarm before it rings, the empty seats, the taped hands, the held stare. Build discipline → doubt → decision → payoff, and make the payoff small and specific rather than a trophy. The quietest shot should be the loudest moment.",
    format: "16:9 or 9:16 · 60–120 s",
    keywords: ["cinematic", "emotional", "cold", "gritty", "hopeful", "dark"],
    variants: [
      { id: "manifesto", name: "Voiceover manifesto", brief: "A written first-person line running under the images, plain and unpoetic." },
      { id: "silent", name: "No words", brief: "Sound design and picture only: breath, contact, room tone, no narration and no text." },
      { id: "interview", name: "Interview-led", brief: "The athlete answering off-camera, the best sentence landing over the hardest image." },
      { id: "letter", name: "Letter to a younger self", brief: "Addressed to who they were, cut against who they are now." },
    ],
    motif: "rise",
    hue: 265,
    isNew: true,
  },
  {
    id: "game-day-hype",
    name: "Game day hype",
    medium: "video",
    category: "athletes",
    blurb: "Bus to tunnel to first whistle",
    brief:
      "Anticipation, and it must stop before the game. In order: arrival, the empty venue, kit laid out, headphones and taping, the room going quiet, the tunnel, the noise hitting, the first step onto the surface. Cut faster as it approaches; hold the last frame one beat too long.",
    format: "9:16 · 30–60 s",
    keywords: ["epic", "dark", "neon", "raw phone", "cinematic"],
    variants: [
      { id: "home-opener", name: "Home opener", brief: "Familiar building waking up: groundskeepers, lights coming on, the first fans in." },
      { id: "rivalry", name: "Rivalry", brief: "Two colours in one frame, history on the walls, hostility as texture." },
      { id: "final", name: "Championship", brief: "Everything heavier: covered logos, extra cameras, the weight of one result." },
      { id: "debut", name: "Debut", brief: "First time in this shirt: name on the locker, unfamiliar corridors, nerves in the hands." },
      { id: "away", name: "Away, hostile", brief: "Outnumbered: the wrong colour everywhere, a small travelling section, silence as the goal." },
      { id: "senior-night", name: "Last home game", brief: "Ceremony before the contest; family in the stands, a room they will not enter again." },
    ],
    motif: "spotlight",
    hue: 215,
    isNew: true,
  },
  {
    id: "impossible-trick",
    name: "Impossible trick",
    medium: "video",
    category: "athletes",
    blurb: "One move, made to look impossible",
    brief:
      "Everything serves ONE movement. Set it up so the difficulty is legible to someone who does not know the sport — show the gap, the height, the target — then execute in one unbroken take with the camera moving through the trick, not watching it. Land it and hold. Never cut on the moment of contact; cutting there reads as a cheat.",
    format: "9:16 · 8–15 s",
    keywords: ["epic", "bold", "neon", "raw phone", "bullet time", "cinematic"],
    variants: [
      { id: "skate", name: "Skate / BMX", brief: "Street or park: the run-up, the obstacle named by the framing, roll-away as proof." },
      { id: "parkour", name: "Parkour", brief: "Architecture as apparatus: the drop shown before the jump so the risk is understood." },
      { id: "basketball", name: "Basketball", brief: "Dunk or shot: rim height established, no cut between release and result." },
      { id: "football", name: "Football freestyle", brief: "Ball never grounded: touches counted by the camera circling the athlete." },
      { id: "gymnastics", name: "Gymnastics / tumbling", brief: "Rotation read fully: entry, air, and a landing held dead still." },
      { id: "trick-shot", name: "Trick shot", brief: "An absurd line shown end to end in one take, because a cut would be a lie." },
      { id: "martial-arts", name: "Martial arts", brief: "Kick or throw: contact and consequence in the same frame." },
    ],
    motif: "orbit",
    hue: 300,
    isNew: true,
  },
  {
    id: "slow-motion-technique",
    name: "Slow-motion technique",
    medium: "video",
    category: "athletes",
    blurb: "One movement, read frame by frame",
    brief:
      "A teaching piece that happens to be beautiful. Take one movement and cover it from the angles that actually reveal it: the plane the power travels in, the joint that decides it, and the contact. High shutter so each frame is sharp rather than smeared, hard side light to model the muscle, and the whole thing slow enough to see the order things happen in. No commentary — the framing is the explanation.",
    format: "16:9 · 20–45 s",
    keywords: ["clean", "clinical", "premium", "dark", "high-speed"],
    variants: [
      { id: "sprint-start", name: "Sprint start", brief: "Blocks to third step: shin angle, ground contact time, head staying down." },
      { id: "lift", name: "Olympic lift", brief: "Bar path as the subject: the second pull, the turnover, the catch." },
      { id: "swing", name: "Golf / bat swing", brief: "Rotation sequence from the ground up, and the moment of contact isolated." },
      { id: "combo", name: "Boxing combination", brief: "Weight transfer between punches, and what the feet do before the hands." },
      { id: "swim", name: "Swim stroke", brief: "Above and below the line in the same piece: catch, pull, breath, recovery." },
      { id: "throw", name: "Pitch / throw", brief: "Separation between hip and shoulder, arm lag, release and follow-through." },
      { id: "kick", name: "Kick", brief: "Plant foot, hip rotation, contact point on the ball, and the shape that follows." },
    ],
    motif: "waveform",
    hue: 180,
    isNew: true,
  },

  // ----- Events & fashion -------------------------------------------------------
  // Promoting a night, a launch or an experience with the grammar of a fashion
  // campaign. All three share one hard constraint: the video model cannot spell,
  // and an event lives or dies on its date, venue and name being correct — so
  // every skill here separates the FILM from the DETAILS and says so out loud.
  {
    id: "event-editorial",
    name: "Event editorial",
    medium: "video",
    category: "events",
    blurb: "A night, shot like a magazine",
    brief:
      "Sell the feeling of being there, not the schedule. Composed editorial frames rather than candid coverage: one idea per shot, deliberate negative space for type, and a palette taken from the venue itself. Nothing documentary, nobody mugging at the lens, and no legible text in frame — the details are laid over afterwards.",
    format: "9:16 + 4:5 · 15–30 s",
    keywords: ["editorial", "luxury", "neon", "moody", "playful", "film grain"],
    variants: [
      { id: "club-night", name: "Club night", brief: "Low light, one strong colour, bodies as shape; heat, haze and movement over faces." },
      { id: "launch", name: "Product launch", brief: "The object treated as the guest of honour: plinths, controlled light, people orbiting it." },
      { id: "gallery", name: "Exhibition or gallery", brief: "White walls, daylight, quiet; the crowd composed like the work on the wall." },
      { id: "rooftop", name: "Rooftop or garden", brief: "Golden hour into blue hour, city behind, glassware and wind in fabric." },
      { id: "dinner", name: "Private dinner", brief: "One long table, candlelight, the room lit only by what is on it." },
      { id: "pop-up", name: "Pop-up or market", brief: "Daylight, colour, signage as shape, movement through a crowded space." },
    ],
    motif: "confetti",
    hue: 320,
    isNew: true,
  },
  {
    id: "event-fashion-film",
    name: "Event fashion film",
    medium: "video",
    category: "events",
    blurb: "Models, venue and outfits as one campaign",
    brief:
      "A campaign that happens to be set at an event: cast, looks, venue and atmosphere directed together so the clothes and the room belong to each other. Walk, turn, hold. Every look gets an establishing frame, a movement frame and a detail frame, and the same lighting logic runs through all of them.",
    format: "9:16 + 16:9 · 30–60 s",
    keywords: ["luxury", "editorial", "minimal", "bold", "vintage film", "monochrome"],
    variants: [
      { id: "runway", name: "Runway", brief: "A real walk: entrance, length of the room, turn, exit, shot from three fixed positions." },
      { id: "presentation", name: "Static presentation", brief: "Models held in poses around a space while the camera moves instead of them." },
      { id: "after-party", name: "After-party", brief: "The collection worn in motion at the party rather than on a stage." },
      { id: "street-cast", name: "Street cast", brief: "Real people, real proportions, the venue's doorway as the backdrop." },
      { id: "lookbook", name: "Moving lookbook", brief: "One neutral setup, each look entering, turning and leaving the same frame." },
      { id: "campaign", name: "Campaign film", brief: "Narrative fragments with the clothes incidental, the way the best campaigns work." },
    ],
    motif: "letterbox",
    hue: 30,
    isNew: true,
  },
  {
    id: "luxury-invitation-film",
    name: "Luxury invitation film",
    medium: "video",
    category: "events",
    blurb: "The details, delivered like a trailer",
    brief:
      "A short film that withholds almost everything: texture, light and one gesture, ending on the details. The film is atmosphere only — the name, date, venue and RSVP are typographic frames made separately and composited, because a video model cannot spell and an invitation with an invented date is worthless.",
    format: "9:16 · 8–20 s",
    keywords: ["luxury", "minimal", "moody", "gold", "monochrome", "film grain"],
    variants: [
      { id: "black-tie", name: "Black tie", brief: "Silk, low light, a hand on a stair rail; restraint as the whole aesthetic." },
      { id: "fashion-week", name: "Fashion week", brief: "Fast, graphic, cold; a seating card and an empty front row." },
      { id: "art-opening", name: "Art opening", brief: "Daylight on a white wall, one covered work, a curator's gloved hand." },
      { id: "wedding", name: "Wedding", brief: "Warm, tactile, personal: paper, wax, flowers, two hands." },
      { id: "product-reveal", name: "Product reveal", brief: "The object never shown whole — edge, reflection, shadow, then the date." },
      { id: "members-club", name: "Members club", brief: "A door, a nod, a corridor; the promise that you had to be asked." },
    ],
    motif: "candle",
    hue: 45,
    isNew: true,
  },

  // ----- Creators & channels ----------------------------------------------------
  // Formats a person makes for their own channel. All of them are talking-head
  // shaped, and NO model here generates speech — so every skill states that the
  // voice is recorded or dubbed by the owner, and offers @avatar-lip-sync when
  // the mouth has to match.
  {
    id: "vlog-influencer",
    name: "Vlog",
    medium: "video",
    category: "influencers",
    blurb: "A day, told to camera",
    brief:
      "Pieces to camera holding the story together and b-roll carrying everything else. Handheld, available light, the creator addressing the lens directly and moving while they talk. Cut on the sentence, never mid-clause. The strongest vlog shot is the one where they forget the camera is there.",
    format: "9:16 or 16:9 · 60 s–8 min",
    keywords: ["raw phone", "cozy", "travel", "cinematic", "chaotic", "film grain"],
    variants: [
      { id: "day-in-life", name: "Day in the life", brief: "Wake to sleep, the ordinary rendered watchable by pace and honesty." },
      { id: "travel", name: "Travel", brief: "Arrival, getting lost, the meal, the view nobody photographs well." },
      { id: "studio-day", name: "Behind the work", brief: "Making the thing they are known for, shot between takes." },
      { id: "errand", name: "Come with me", brief: "One small errand stretched into a whole piece by commentary." },
      { id: "reset", name: "Reset day", brief: "Cleaning, cooking, laundry, lists — the genre that quietly outperforms everything." },
      { id: "q-and-a", name: "Q&A while doing something", brief: "Answering questions with the hands busy, which is what makes it watchable." },
    ],
    motif: "waveform",
    hue: 195,
    isNew: true,
  },
  {
    id: "fitness-influencer",
    name: "Fitness creator",
    medium: "video",
    category: "influencers",
    blurb: "Form, routine and a reason to follow",
    brief:
      "The creator is the proof and the teacher at once: a piece to camera that sets up the session, the work shot so the form is actually legible, and a close that gives one usable cue. Never a montage of impressive reps with no instruction — that is a highlight, not a channel.",
    format: "9:16 · 20–90 s",
    keywords: ["high-energy", "clean", "gritty", "premium", "raw phone"],
    variants: [
      { id: "form-check", name: "Form check", brief: "One movement, the common error shown and then corrected, from the angle that reveals it." },
      { id: "routine", name: "Routine", brief: "Three to five exercises in order, each held long enough to copy." },
      { id: "myth", name: "Myth busted", brief: "A claim stated, then shown to be wrong with the body rather than with a caption." },
      { id: "transformation", name: "Progress", brief: "Honest change over time, with the timescale stated and nothing exaggerated." },
      { id: "day-of-eating", name: "Day of eating", brief: "Meals as they actually are, portioned on camera, no numbers claimed." },
      { id: "gym-vlog", name: "Train with me", brief: "The whole session in real time, talking between sets." },
    ],
    motif: "flash",
    hue: 100,
    isNew: true,
  },
  {
    id: "youtube-influencer",
    name: "YouTube video",
    medium: "video",
    category: "influencers",
    blurb: "Hook, promise, payoff — built to be watched through",
    brief:
      "Retention is the craft. Open on the most interesting eight seconds you have, say what the video will deliver, then deliver it in a visible structure the viewer can feel progressing. Cut every time the frame stops earning its place. The thumbnail moment is a shot you plan, not one you find.",
    format: "16:9 · 3–15 min",
    keywords: ["clean", "high-energy", "cinematic", "raw phone", "premium"],
    variants: [
      { id: "challenge", name: "Challenge", brief: "A stated rule set, a clock or a counter, and a genuine chance of failure." },
      { id: "review", name: "Review", brief: "The thing handled, tested and judged, with the verdict earned on camera." },
      { id: "essay", name: "Video essay", brief: "An argument in chapters, illustrated rather than narrated over stock." },
      { id: "build", name: "Build or make", brief: "Start, problem, solve, reveal — the oldest and most reliable shape." },
      { id: "reaction", name: "First try", brief: "Genuine first attempt at something, with the failures left in." },
      { id: "documentary", name: "Mini documentary", brief: "One subject, interviews and place, cut like a short film." },
    ],
    motif: "letterbox",
    hue: 355,
    isNew: true,
  },
  // The reaction format, and the reason it is its own skill: the reactor is a
  // CUT-OUT over the playing video, not one half of a split screen. Everything
  // that makes it read — where the matte sits, the eyeline, the screen light
  // spilling onto them, reacting on the video's beats and being still between —
  // is compositing craft that no amount of "reaction video" in a prompt buys.
  {
    id: "reaction-video",
    name: "Reaction",
    medium: "video",
    category: "influencers",
    blurb: "Cut out over the video, reacting as it plays",
    brief:
      "The video plays full frame and the reactor is a matted cut-out standing in its dead space — no box, no border, never a split screen. Three things sell it and nothing else does: the eyeline goes to what they are watching rather than to the lens, the screen light spills onto them and changes colour as the video does, and the reactions land on the video’s beats with real stillness in between. Continuous mugging is the failure mode; the best reaction shot is the one where they forget to perform and just watch.",
    format: "9:16 or 16:9 · 15 s–3 min",
    keywords: ["raw phone", "clean", "high-energy", "cozy", "premium"],
    variants: [
      { id: "first-watch", name: "First watch", brief: "Genuine first viewing — the reactions are unplanned and the silences are left in." },
      { id: "commentary", name: "Commentary", brief: "Pausing to talk over it, the cut-out taking more frame while they explain." },
      { id: "expert", name: "Expert review", brief: "Someone qualified judging what is on screen, correcting it as it plays." },
      { id: "duet", name: "Duet reply", brief: "Answering another creator’s video, addressing them rather than the camera." },
      { id: "watch-along", name: "Watch along", brief: "Long-form, low-energy company — small reactions, long stretches of just watching." },
      { id: "rank", name: "Rate it", brief: "A score or verdict delivered at the end, set up by the reactions before it." },
    ],
    motif: "letterbox",
    hue: 22,
    isNew: true,
  },
  {
    id: "joke-video",
    name: "Comedy sketch",
    medium: "video",
    category: "creators",
    blurb: "Setup, turn, button — in under a minute",
    brief:
      "Comedy is structure, not funny faces. A premise established in one shot, a turn that breaks it, and a button that ends the piece a beat earlier than expected. Shoot it straight and play it straight; the camera should never be in on the joke.",
    format: "9:16 · 15–60 s",
    keywords: ["deadpan", "chaotic", "raw phone", "cinematic", "absurd"],
    variants: [
      { id: "two-hander", name: "Two-hander", brief: "One straight person, one absurd person, one location, no cutting away." },
      { id: "character", name: "Character piece", brief: "A single recognisable type played completely seriously." },
      { id: "escalation", name: "Escalation", brief: "The same beat repeated three times, worse each time, then broken." },
      { id: "voiceover", name: "Inner monologue", brief: "What they are thinking laid over what they are visibly doing." },
      { id: "parody-format", name: "Format parody", brief: "A familiar kind of video — not a real show — played dead straight until it collapses." },
      { id: "prank-free", name: "Misunderstanding", brief: "Two people in the same conversation about different things." },
    ],
    motif: "confetti",
    hue: 50,
    isNew: true,
  },
  {
    id: "street-interview",
    name: "Street interview",
    medium: "video",
    category: "creators",
    blurb: "One question, a lot of strangers",
    brief:
      "One question, asked identically to everyone, with the answers carrying the whole piece. Handheld, mic in frame, real street behind. Cut hard between answers with no dead air, and put the best answer last rather than first. Everyone on camera is an invented participant, never a real member of the public.",
    format: "9:16 · 30–90 s",
    keywords: ["raw phone", "high-energy", "clean", "chaotic"],
    variants: [
      { id: "opinion", name: "Opinion", brief: "A harmless question with a spread of answers — best film, worst habit, biggest ick." },
      { id: "knowledge", name: "Do you know", brief: "A general-knowledge question, played warmly rather than to humiliate." },
      { id: "fashion", name: "Outfit check", brief: "What they are wearing and why, shot head to toe and then close." },
      { id: "money-free", name: "Advice", brief: "One piece of advice from each person, ages varying deliberately." },
      { id: "reaction", name: "Blind taste or listen", brief: "A genuine reaction to something they cannot see, caught in one take." },
      { id: "kids", name: "Ask the young ones", brief: "Children answering an adult question, with parental presence implied in frame." },
    ],
    motif: "equalizer",
    hue: 165,
    isNew: true,
  },

  // ----- TV & radio -------------------------------------------------------------
  // Broadcast grammar, made as fiction. Every one of these is built so it cannot
  // be mistaken for a real programme: invented station, invented show, invented
  // people, and nothing presented as a fact about the real world.
  {
    id: "news-anchor",
    name: "News desk",
    medium: "video",
    category: "broadcast",
    blurb: "An anchor, a desk, an invented station",
    brief:
      "Broadcast grammar shot as fiction: an anchor at a desk, studio depth behind, the lens at eye height and dead level, the delivery measured. The station, the programme and the story are invented, and the piece is built so nobody could mistake it for real coverage. Lower thirds and tickers are added in an editor, never rendered.",
    format: "16:9 · 20–90 s",
    keywords: ["clean", "premium", "retro", "local access", "satire"],
    variants: [
      { id: "studio", name: "Studio bulletin", brief: "Anchor at the desk, studio behind, the standard two-shot and single." },
      { id: "field", name: "Field report", brief: "A reporter on location, handheld, wind on the mic, the scene behind them." },
      { id: "two-anchor", name: "Two anchors", brief: "The hand-off between them, which is the tell that makes it read as broadcast." },
      { id: "weather", name: "Weather", brief: "Presenter against a blank wall where a map goes in post." },
      { id: "retro", name: "1970s broadcast", brief: "Tube camera softness, wood-veneer desk, heavy makeup, period framing." },
      { id: "satire", name: "Obvious satire", brief: "Played straight but about something plainly absurd, so the joke is unmistakable." },
    ],
    motif: "grid",
    hue: 210,
    isNew: true,
  },
  {
    id: "sitcom-scene",
    name: "Sitcom scene",
    medium: "video",
    category: "broadcast",
    blurb: "One set, three cameras, a laugh track",
    brief:
      "Multi-camera sitcom grammar: a standing set with a fourth wall, flat bright key light, characters entering and exiting through known doors, and blocking that keeps everyone facing out. Beats land and then pause for the laugh. It should look lit for an audience, because it is.",
    format: "16:9 · 30–90 s",
    keywords: ["90s", "warm", "retro", "modern single-cam", "absurd"],
    variants: [
      { id: "apartment", name: "The apartment", brief: "Sofa, kitchen counter, front door — the standing set that carries most sitcoms." },
      { id: "workplace", name: "The workplace", brief: "Desks, a break room, a boss's office with a glass wall." },
      { id: "diner", name: "The hangout", brief: "A booth, a counter, a regular's table that everyone gravitates to." },
      { id: "family", name: "Family home", brief: "Stairs in shot, a kitchen table, and a door everyone slams." },
      { id: "single-cam", name: "Single camera", brief: "No audience, handheld, natural light, the modern comedy look." },
      { id: "mockumentary", name: "Mockumentary", brief: "The camera acknowledged, talking heads cut into the scene." },
    ],
    motif: "letterbox",
    hue: 40,
    isNew: true,
  },
  {
    id: "sitcom-intro",
    name: "Sitcom title sequence",
    medium: "video",
    category: "broadcast",
    blurb: "The theme tune, and everyone's name",
    brief:
      "The opening titles: the cast introduced one at a time in a freeze or a turn to camera, a location montage that sets the city, and a repeating device that returns every episode. Built for a name card to sit beside each face — the card itself is added in an editor.",
    format: "16:9 · 20–45 s",
    keywords: ["90s", "warm", "retro", "modern", "animated"],
    variants: [
      { id: "freeze-frame", name: "Freeze frames", brief: "Each cast member caught mid-laugh and frozen, name card beside them." },
      { id: "city-montage", name: "City montage", brief: "Landmarks, transit and streets, the cast appearing within them." },
      { id: "couch", name: "The couch", brief: "Everyone arriving at one piece of furniture, one at a time." },
      { id: "photo-album", name: "Photographs", brief: "Stills and home-movie fragments, warm and nostalgic." },
      { id: "animated", name: "Animated titles", brief: "Illustrated versions of the cast moving through a stylised version of the set." },
      { id: "cold-open", name: "Cold open into titles", brief: "A short scene that ends on the joke and hard-cuts into the theme." },
    ],
    motif: "confetti",
    hue: 15,
    isNew: true,
  },
  {
    id: "podcast-show",
    name: "Podcast / radio show",
    medium: "video",
    category: "broadcast",
    blurb: "Mics, chairs and a room that sounds expensive",
    brief:
      "A show shot for clipping: two or three people around mics, each on their own camera, plus a wide that establishes the room. The set does the branding — the lighting, the backdrop, the mics — because the picture has to be recognisable at thumbnail size with the sound off.",
    format: "16:9 + 9:16 clips · 30 s–3 min",
    keywords: ["premium", "moody", "clean", "retro radio", "warm"],
    variants: [
      { id: "two-person", name: "Two-person", brief: "Host and guest across a table, each with a single, plus the wide." },
      { id: "solo", name: "Solo monologue", brief: "One person, one mic, talking straight down the lens." },
      { id: "panel", name: "Panel", brief: "Three or four, which needs a wide that actually works and a clear seating order." },
      { id: "radio-booth", name: "Radio booth", brief: "On-air light, faders, headphones, the glass of the booth in shot." },
      { id: "clip", name: "Vertical clip", brief: "One moment reframed for a feed, with room at the top for a caption." },
      { id: "retro", name: "Old-time radio", brief: "Ribbon mic, period dress, a script in hand and a studio audience implied." },
    ],
    motif: "equalizer",
    hue: 280,
    isNew: true,
  },
  {
    id: "tutorial-steps",
    name: "Step-by-step tutorial",
    medium: "video",
    category: "talk",
    blurb: "Hands, steps, and a result that works",
    brief:
      "Live-action how-to shot so it can be followed: an overhead or over-shoulder angle that shows what the hands are doing, one step per shot, each held long enough to copy, and the finished result at the end and at the start. Nothing is cut away at the moment the tricky part happens — that is the part they came for.",
    format: "9:16 or 16:9 · 30 s–5 min",
    keywords: ["clean", "cozy", "premium", "raw phone", "clinical"],
    variants: [
      { id: "kitchen", name: "Cooking", brief: "Overhead on the board, cuts to the pan, the plate at the start and the end." },
      { id: "craft", name: "Craft or repair", brief: "Hands and tools, the awkward step shown in full, the fix proven at the end." },
      { id: "beauty", name: "Beauty or grooming", brief: "Mirror logic: the face square on, product named by showing it, before and after." },
      { id: "software", name: "On a screen", brief: "Screen recording with a hand or cursor leading the eye, held on each step." },
      { id: "assembly", name: "Assembly", brief: "Parts laid out first, numbered steps, the finished object turned at the end." },
      { id: "quick", name: "Under 30 seconds", brief: "Three steps maximum, no introduction, result in the first second." },
    ],
    motif: "grid",
    hue: 155,
    isNew: true,
  },

  // ----- Romance & allure -------------------------------------------------------
  // Adult editorial and romantic cinema. Every skill here works by suggestion —
  // fabric, shadow, silhouette, the half-second before — because that is both the
  // craft of the genre and the line these stay on. Adults only, the owner's own
  // uploads or invented people, nothing explicit.
  {
    id: "romantic-film",
    name: "Romantic film",
    medium: "video",
    category: "romance",
    blurb: "Two people, and the space between them",
    brief:
      "Intimacy is proximity and attention, not action. Build the piece out of small physical facts — a hand that almost lands, a look held a beat past comfortable, someone turning away first — and let the room, the light and the weather carry the feeling. The best shot in a romantic film is usually the one where nothing happens.",
    format: "16:9 · 30–90 s",
    keywords: ["warm", "film grain", "melancholy", "golden", "rain", "quiet"],
    variants: [
      { id: "first-meeting", name: "First meeting", brief: "Strangers, one small accident, and the moment it becomes deliberate." },
      { id: "long-love", name: "Years in", brief: "Two people who know each other completely; tenderness in routine." },
      { id: "reunion", name: "Reunion", brief: "Time apart written on both of them; the first thirty seconds of seeing each other." },
      { id: "goodbye", name: "The last day", brief: "Everything ordinary, done for the last time, and neither saying so." },
      { id: "almost", name: "Almost", brief: "A connection that never resolves; the piece ends on the door closing." },
      { id: "letter", name: "Read aloud", brief: "Words from one of them laid over the other's ordinary day." },
    ],
    motif: "candle",
    hue: 350,
    isNew: true,
  },
  {
    id: "romantic-montage",
    name: "Romantic montage",
    medium: "video",
    category: "romance",
    blurb: "A relationship, cut to music",
    brief:
      "Moments rather than scenes: fragments that would mean nothing alone and everything in sequence. Cut on the music, keep every shot short, and let the chronology do the storytelling. One repeated image — the same doorway, the same coat, the same kitchen — is what turns a reel into a relationship.",
    format: "9:16 or 16:9 · 20–60 s",
    keywords: ["film grain", "warm", "nostalgic", "home video", "golden", "monochrome"],
    variants: [
      { id: "how-we-met", name: "How we met", brief: "The story told in order, from the first frame to now." },
      { id: "anniversary", name: "Anniversary", brief: "One year or twenty, built around what has stayed the same." },
      { id: "wedding-tease", name: "Wedding tease", brief: "The week before, shot as anticipation rather than ceremony." },
      { id: "home-video", name: "Home video", brief: "Deliberately imperfect: camcorder texture, bad framing, real rooms." },
      { id: "seasons", name: "A year", brief: "The same places through four seasons and two people changing in them." },
      { id: "proposal", name: "The question", brief: "Everything before it, and nothing after." },
    ],
    motif: "confetti",
    hue: 335,
    isNew: true,
  },
  {
    id: "seduction-film",
    name: "Seduction film",
    medium: "video",
    category: "romance",
    blurb: "Tension, held",
    brief:
      "Slow, stylish and entirely about anticipation. Restraint is the technique: long lenses, long takes, almost no cutting, and a camera that stays further away than it wants to be. Nothing explicit — the charge comes from proximity, eye contact, a hand that stops short, and the length of the silence.",
    format: "16:9 · 15–45 s",
    keywords: ["noir", "luxury", "moody", "monochrome", "neon", "film grain"],
    variants: [
      { id: "across-the-room", name: "Across a room", brief: "Two people at opposite ends of a crowded space and the camera between them." },
      { id: "slow-dance", name: "Slow dance", brief: "One continuous take, one piece of music, almost no distance closed." },
      { id: "hotel-bar", name: "Hotel bar", brief: "Low light, glassware, a conversation the camera never quite hears." },
      { id: "getting-ready", name: "Getting ready", brief: "Two people dressing in separate rooms for the same evening." },
      { id: "the-drive", name: "The drive", brief: "A car at night, two profiles, streetlights and nothing said." },
      { id: "morning", name: "The morning after", brief: "Sunlight, coffee, borrowed clothes, and easy silence." },
    ],
    motif: "candle",
    hue: 305,
    isNew: true,
  },
  {
    id: "noir-seduction",
    name: "Noir seduction",
    medium: "video",
    category: "romance",
    blurb: "Blinds, smoke and a bad idea",
    brief:
      "Classic noir grammar in service of romantic tension: one hard key through slatted blinds, faces half in darkness, rain on glass, cigarette smoke reading the light. Everyone in a noir wants something and nobody says what. Shot in black and white or a grade close to it, with the shadow doing most of the work.",
    format: "16:9 · 20–45 s",
    keywords: ["monochrome", "high-contrast", "rain", "smoke", "1940s", "neo-noir"],
    variants: [
      { id: "office", name: "The office", brief: "A desk, a bottle, a door with frosted glass, and someone arriving late." },
      { id: "rain-street", name: "Rain outside", brief: "Wet asphalt, one streetlight, two people under one umbrella." },
      { id: "club", name: "The club", brief: "A singer, a table at the back, and a look held across the room." },
      { id: "apartment", name: "The apartment", brief: "Blinds, a fan, heat, and a conversation that circles." },
      { id: "neo", name: "Neo-noir", brief: "Colour: neon through rain, cyan and magenta instead of grey." },
      { id: "stairwell", name: "The stairwell", brief: "Verticals, shadows through a bannister, footsteps arriving." },
    ],
    motif: "letterbox",
    hue: 220,
    isNew: true,
  },
  {
    id: "boudoir-film",
    name: "Boudoir film",
    medium: "video",
    category: "romance",
    blurb: "A portrait session, in motion",
    brief:
      "High-end boudoir made the way the good studios make it: it is a confidence portrait, shot for the subject rather than about them. Posing, fabric, window light and a camera that flatters. Everything is suggestion — silk, shadow, the edge of a shoulder — and the subject is always fully in control of the frame.",
    format: "9:16 or 4:5 · 15–45 s",
    keywords: ["luxury", "warm", "monochrome", "film grain", "window light", "editorial"],
    variants: [
      { id: "window", name: "Window light", brief: "One large window, linen, morning; the softest and most forgiving setup." },
      { id: "hotel", name: "Hotel suite", brief: "Robe, city behind, mirrors used deliberately rather than decoratively." },
      { id: "monochrome", name: "Black and white", brief: "Texture and edge only; grain, shadow and the line of a silhouette." },
      { id: "vintage", name: "Vintage", brief: "1950s styling, soft-focus filter, satin and a low warm key." },
      { id: "bridal", name: "Bridal", brief: "The morning of, robe and veil, shot as anticipation." },
      { id: "studio", name: "Studio", brief: "Black seamless, one hard source, the body read as sculpture." },
    ],
    motif: "spotlight",
    hue: 15,
    isNew: true,
  },

  // ----- Social -----------------------------------------------------------------
  {
    id: "social-content",
    name: "Social content",
    medium: "video",
    category: "social",
    blurb: "Scroll-stopping posts for TikTok, Reels, Shorts",
    brief:
      "Hook in the first 1.5 seconds, one idea per video, captions on screen, a loopable ending, and a trending-style format (POV, list, before/after).",
    format: "9:16 · 7–30 s",
    keywords: ["funny", "aesthetic", "relatable", "educational", "hype"],
    motif: "flash",
    hue: 300,
  },
  {
    id: "vlog-memories",
    name: "Vlog memories",
    medium: "video",
    category: "social",
    blurb: "Your photos and clips into a day-in-the-life",
    brief:
      "Chronological memories with gentle zooms, handwritten-style date captions, a soft grade and a song-led rhythm. Real faces stay unaltered.",
    format: "9:16 · 30–60 s",
    keywords: ["cozy", "nostalgic", "film grain", "travel"],
    motif: "grid",
    hue: 20,
  },
  {
    id: "outfit-try-on",
    name: "Outfit try-on",
    medium: "video",
    category: "social",
    blurb: "UGC-style try-on haul in the mirror",
    brief:
      "Vertical, phone-camera try-on: the creator shows each outfit, turns, reacts, points to details. Clothing matches the product photos exactly.",
    format: "9:16 · 15 s",
    keywords: ["haul", "get ready with me", "honest", "aesthetic"],
    motif: "grid",
    hue: 320,
  },
  {
    id: "seamless-loop",
    name: "Seamless loop · 5 s",
    medium: "video",
    category: "social",
    blurb: "A 5-second clip whose end is its beginning",
    brief:
      "Exactly 5 seconds; the last frame must match the first. Use periodic motion (orbit, sway, flow, rotation) with no cuts and no camera drift that cannot return.",
    format: "1:1 or 9:16 · 5 s",
    keywords: ["hypnotic", "satisfying", "minimal", "dreamy"],
    motif: "loop",
    hue: 185,
  },
  {
    id: "flash-montage",
    name: "Flash montage",
    medium: "video",
    category: "social",
    blurb: "Rapid-fire cuts synced to a beat",
    brief:
      "Cuts every 2–6 frames on the beat, flash frames and whip transitions, recurring visual motif, a slow-motion moment before the drop.",
    format: "9:16 · 10–20 s",
    keywords: ["hype", "retro", "neon", "grunge"],
    motif: "flash",
    hue: 55,
  },

  // ----- Film, music & games ------------------------------------------------------
  {
    id: "music-video",
    name: "Music video",
    medium: "video",
    category: "film",
    blurb: "Visuals cut to your song's structure",
    brief:
      "Map the song: intro, verse, chorus, bridge. Change visual world at each section, cut on downbeats, performance shots in the chorus, a visual payoff at the final chorus.",
    format: "16:9 or 9:16 · song length",
    keywords: ["dreamy", "gritty", "neon", "anime", "performance", "narrative"],
    motif: "equalizer",
    hue: 275,
    isNew: true,
  },
  {
    id: "film-trailer",
    name: "Film trailer",
    medium: "video",
    category: "film",
    blurb: "Three acts in 60 seconds, title card last",
    brief:
      "Trailer grammar: calm world, inciting incident, rising montage, a big line of dialogue, the title card, a final sting after the title.",
    format: "2.39:1 · 60–90 s",
    keywords: ["action", "horror", "romance", "sci-fi", "comedy", "epic"],
    motif: "letterbox",
    hue: 15,
  },
  {
    id: "game-trailer",
    name: "Game trailer",
    medium: "video",
    category: "film",
    blurb: "Gameplay beats, the world, the logo",
    brief:
      "Show the world, the core loop, the enemy, the hero moment and the logo with a release date. Include what the player actually does.",
    format: "16:9 · 45–90 s",
    keywords: ["fantasy", "sci-fi", "cozy", "pixel", "AAA"],
    motif: "orbit",
    hue: 140,
  },
  {
    id: "game-cutscene",
    name: "Game cut scene",
    medium: "video",
    category: "film",
    blurb: "An in-engine story moment between levels",
    brief:
      "Written like a scene: characters, blocking, dialogue lines, camera per line. Match a game-engine look (real-time lighting, stylised models), end handing control back to the player.",
    format: "16:9 · 30–120 s",
    keywords: ["stylised", "photoreal", "anime", "pixel"],
    motif: "letterbox",
    hue: 120,
  },

  // ----- Performance & action --------------------------------------------------
  {
    id: "micro-expressions",
    name: "Actor micro-expressions",
    medium: "video",
    category: "performance",
    blurb: "Restraint equals tension — a face acting in 15 s",
    brief:
      "Film-grade micro-expression direction: emotion lives in the eyes, face muscles and breath, never in big movement. Timeline of 2–3 s slices, character prefix first, frozen ending.",
    format: "16:9 · 15 s per take",
    motif: "waveform",
    hue: 350,
    isNew: true,
  },
  {
    id: "crisis-evasion",
    name: "Crisis evasion",
    medium: "video",
    category: "performance",
    blurb: "Hazards rain down, the hero slips past each one",
    brief:
      "One continuous take: hazards genuinely enter the character's path and are evaded at the last instant; every event has warning, source, trajectory, evasion, near miss and consequence.",
    format: "16:9 · 8–15 s",
    keywords: ["photoreal disaster", "anime", "game CG", "cartoon"],
    motif: "flash",
    hue: 20,
    isNew: true,
  },
  {
    id: "fight-choreography",
    name: "Action fight choreography",
    medium: "video",
    category: "performance",
    blurb: "Strike by strike, camera on every beat",
    brief:
      "Fights, duels, chases and clashes as explicit beat chains (strike → parry → counter → impact), camera motion motivated by each beat, visible environmental consequence on every big hit, ambient and impact sound only.",
    format: "16:9 · 4–15 s per shot",
    keywords: ["grounded", "wuxia", "anime", "superhero", "gritty", "stylised"],
    motif: "flash",
    hue: 15,
    isNew: true,
  },

  // ----- Camera moves: signature techniques, made to mix with any workflow -------
  {
    id: "hitchcock-dolly-zoom",
    name: "Hitchcock dolly zoom",
    medium: "video",
    category: "camera",
    blurb: "The subject holds still while the world stretches",
    brief:
      "The compensated inverse move: the camera travels along the lens axis while the zoom works against it, so the subject keeps its size and the background perspective expands or compresses violently. Baseline, effect, hold.",
    format: "16:9 · 5–15 s",
    keywords: ["dread", "realisation", "isolation", "product reveal"],
    motif: "loop",
    hue: 215,
    isNew: true,
  },
  {
    id: "dolly-zoom",
    name: "Push in / pull out",
    medium: "video",
    category: "camera",
    blurb: "The camera simply moves closer, or away",
    brief:
      "A plain dolly on a fixed lens: the camera physically travels toward the subject or away from it, so perspective stays natural and a foreground element proves the travel. No zoom at any point. Hold, move, land.",
    format: "16:9 · 4–15 s",
    keywords: ["arrival", "realisation", "reveal", "solitude"],
    motif: "loop",
    hue: 200,
    isNew: true,
  },
  {
    id: "bullet-time",
    name: "Bullet time",
    medium: "video",
    category: "camera",
    blurb: "Time freezes at the peak, the camera circles it",
    brief:
      "Real-time action reaches one readable peak and freezes completely; only the camera travels a 90–270° arc through suspended layers; then time resumes once.",
    format: "16:9 · 10–15 s",
    keywords: ["product", "food", "dance", "comic accident", "fashion"],
    motif: "orbit",
    hue: 185,
    isNew: true,
  },
  {
    id: "parallax-focus-relay",
    name: "Parallax focus relay",
    medium: "video",
    category: "camera",
    blurb: "One moving take, focus passed plane to plane",
    brief:
      "One continuous lateral or diagonal move across three depth planes; each sharp subject performs one action that hands focus to the next plane; near layers slide faster than far ones.",
    format: "16:9 · 8–15 s",
    keywords: ["craft", "team intro", "hospitality", "science", "food"],
    motif: "rise",
    hue: 160,
  },
  {
    id: "object-lock-on",
    name: "Object lock-on tracking",
    medium: "video",
    category: "camera",
    blurb: "Catch a moving product, hold it, let it go",
    brief:
      "Acquire, lock, release: an independent camera intercepts a moving hero object, matches its speed and holds its size and screen position while the world streams past, then releases into a destination reveal.",
    format: "16:9 · 8–15 s",
    keywords: ["logistics", "travel", "sports gear", "packaging", "vehicle"],
    motif: "orbit",
    hue: 30,
  },
  {
    id: "fpv-thread-the-needle",
    name: "FPV thread the needle",
    medium: "video",
    category: "camera",
    blurb: "A drone flight through tight gaps, one take",
    brief:
      "A continuous first-person flight through 2–4 ordered, offset openings with decisive pitch, geometry-matched banks, close edge parallax and safe clearance, ending on a clean reveal.",
    format: "16:9 · 8–15 s",
    keywords: ["venue", "architecture", "factory", "garden", "event intro"],
    motif: "flash",
    hue: 210,
    isNew: true,
  },
  {
    id: "snorricam",
    name: "Snorricam",
    medium: "video",
    category: "camera",
    blurb: "Camera bolted to the body, the world swings",
    brief:
      "A body-mounted camera, actor-facing or rear-facing: the face or shoulders stay locked in frame while every step and turn swings the world around them with matching bounce and roll.",
    format: "9:16 or 16:9 · 5–15 s",
    keywords: ["anxiety", "urgency", "comic overwhelm", "athletic", "entrance"],
    motif: "waveform",
    hue: 330,
  },
  {
    id: "mechanical-transformation",
    name: "Mechanical transformation",
    medium: "video",
    category: "camera",
    blurb: "Any object unfolds into a machine and locks",
    brief:
      "Any object — truck, watch, cup, fruit — splits along real seams, slides, rotates, folds, telescopes and locks into a mechanical form in about three seconds, then performs one showcase action. Every part maps to a new one; no mass from nowhere.",
    format: "16:9 · 6–10 s",
    keywords: ["photoreal", "precision", "retro", "sci-fi", "toy-like"],
    motif: "grid",
    hue: 120,
    isNew: true,
  },
  {
    id: "split-screen",
    name: "Split screen",
    medium: "video",
    category: "camera",
    blurb: "Several threads at once, in one grid that never moves",
    brief:
      "Parallel storytelling: the story's own characters, places and actions are laid out in a fixed grid so several threads run at once. One panel = one narrative unit, ownership never switches, nothing is invented to fill a panel. Optionally one eyeline-triggered split instead.",
    format: "16:9 or 9:16 · 5–15 s",
    keywords: ["parallel lives", "phone call", "before and after", "multi-cam", "process steps"],
    motif: "grid",
    hue: 265,
    isNew: true,
  },

  // ----- Talk & teach -----------------------------------------------------------
  {
    id: "interview",
    name: "Interview video",
    medium: "video",
    category: "talk",
    blurb: "Two chairs, two cameras, a real conversation",
    brief:
      "Two-camera setup (wide and close), interviewer and guest with consistent looks, B-roll cutaways for each answer, lower-third name titles.",
    format: "16:9 · 1–10 min",
    keywords: ["podcast", "documentary", "late-night", "street"],
    motif: "waveform",
    hue: 210,
  },
  {
    id: "explainer",
    name: "Explainer video",
    medium: "video",
    category: "talk",
    blurb: "One idea, made obvious",
    brief:
      "Problem, why it matters, how it works in 3 steps, the takeaway. Each step gets one visual metaphor; on-screen text reinforces the narration.",
    format: "16:9 · 60–120 s",
    keywords: ["whiteboard", "3D animated", "motion graphics", "playful", "minimal"],
    motif: "grid",
    hue: 190,
  },
  {
    id: "avatar-lip-sync",
    name: "Avatar lip sync",
    medium: "video",
    category: "talk",
    blurb: "A face that speaks your script",
    brief:
      "One consistent character, chest-up framing, natural blinks and head movement, lips synced to the provided audio or script, a clean background.",
    format: "9:16 or 16:9 · up to 60 s",
    motif: "waveform",
    hue: 330,
  },
  {
    id: "instructional-motion",
    name: "Instructional motion",
    medium: "video",
    category: "talk",
    blurb: "How-to steps, animated and numbered",
    brief:
      "Numbered steps, one action per shot, arrows and highlights on what moves, a final shot of the finished result.",
    format: "9:16 or 16:9 · 30–90 s",
    motif: "grid",
    hue: 100,
  },
  {
    id: "dance-tutorial",
    name: "Instructional dance video",
    medium: "video",
    category: "talk",
    blurb: "Choreography broken down count by count",
    brief:
      "Full routine at speed, then 8-count sections slowed with the counts on screen, a mirrored view, then the full routine again. Same dancer and outfit throughout.",
    format: "9:16 · 30–90 s",
    motif: "equalizer",
    hue: 310,
  },
  {
    id: "asmr-cooking",
    name: "ASMR cooking tutorial",
    medium: "video",
    category: "talk",
    blurb: "Close-up hands, crisp sounds, no talking",
    brief:
      "Overhead and macro shots of each step, sound-first (sizzles, chops, pours), no voice, minimal text for ingredients, a slow final plating shot.",
    format: "9:16 · 30–60 s",
    keywords: ["cozy", "rustic", "minimal", "street food"],
    motif: "rise",
    hue: 28,
  },

  // ----- Occasions ------------------------------------------------------------
  {
    id: "birthday-video",
    name: "Birthday video",
    medium: "video",
    category: "occasions",
    blurb: "A tribute, a surprise or a party invite",
    brief: "Celebrate one person. Real names and photos stay exact; warm, upbeat pacing.",
    format: "9:16 or 16:9 · 30–60 s",
    keywords: ["funny", "heartfelt", "kids party", "elegant"],
    variants: [
      { id: "tribute", name: "Tribute montage", brief: "Photos from childhood to today, a song, and a closing message from friends." },
      { id: "invite", name: "Party invite", brief: "Date, time and place revealed with confetti and the theme's colours." },
      { id: "surprise", name: "Surprise greeting", brief: "A character or celebrity-style host wishing them happy birthday by name." },
    ],
    motif: "confetti",
    hue: 330,
    isNew: true,
  },
  {
    id: "wedding",
    name: "Wedding",
    medium: "video",
    category: "occasions",
    blurb: "Save the date, love story or highlight film",
    brief: "Romantic, soft and personal. Couple's real faces unaltered; names and date correct.",
    format: "16:9 or 9:16 · 30–180 s",
    keywords: ["romantic", "elegant", "rustic", "vintage film"],
    variants: [
      { id: "save-the-date", name: "Save the date", brief: "The couple, the date and the place, revealed in 15 seconds." },
      { id: "love-story", name: "Love story", brief: "How they met, told as illustrated or cinematic chapters." },
      { id: "highlight", name: "Highlight film", brief: "Ceremony, vows, first dance and party, cut to one song." },
      { id: "proposal", name: "Proposal", brief: "A build-up to the question with a reveal moment." },
    ],
    motif: "rise",
    hue: 350,
  },
  {
    id: "anniversary",
    name: "Anniversary",
    medium: "video",
    category: "occasions",
    blurb: "Years together, one song long",
    brief: "Then-and-now pairs, milestone dates as captions, a closing message between the couple.",
    format: "9:16 or 16:9 · 45–90 s",
    keywords: ["romantic", "funny", "nostalgic"],
    motif: "grid",
    hue: 5,
  },
  {
    id: "baby",
    name: "Baby & family news",
    medium: "video",
    category: "occasions",
    blurb: "Announcements, gender reveals, first steps",
    brief: "Joyful, gentle and personal; soft pastel palette unless asked otherwise.",
    format: "9:16 · 15–45 s",
    keywords: ["cute", "funny", "elegant"],
    variants: [
      { id: "announcement", name: "Pregnancy announcement", brief: "A playful reveal of the due date." },
      { id: "gender-reveal", name: "Gender reveal", brief: "Build suspense, then a colour burst reveal." },
      { id: "first-year", name: "First year", brief: "Month-by-month growth, one photo per month." },
    ],
    motif: "confetti",
    hue: 195,
  },
  {
    id: "graduation",
    name: "Graduation",
    medium: "video",
    category: "occasions",
    blurb: "From first day to cap and gown",
    brief: "School years in order, friends and teachers, the walk, the cap toss; class year on the title.",
    format: "9:16 or 16:9 · 45–90 s",
    keywords: ["inspiring", "funny", "nostalgic"],
    motif: "rise",
    hue: 220,
  },
  {
    id: "retirement",
    name: "Retirement send-off",
    medium: "video",
    category: "occasions",
    blurb: "A career celebrated by the people in it",
    brief: "Career milestones, colleagues' messages as captions, the next adventure teased at the end.",
    format: "16:9 · 60–120 s",
    keywords: ["heartfelt", "funny"],
    motif: "rise",
    hue: 35,
  },
  {
    id: "memorial",
    name: "Memorial tribute",
    medium: "video",
    category: "occasions",
    blurb: "Celebrating a life, gently",
    brief:
      "Dignified and warm, never dramatic. Photos kept exactly as they are (restore, never alter faces), slow dissolves, soft music, full name and years, a closing line chosen by the family.",
    format: "16:9 · 2–5 min",
    variants: [
      { id: "celebration-of-life", name: "Celebration of life", brief: "Their story, told through photos and the things they loved." },
      { id: "pet", name: "Pet memorial", brief: "A pet's life from first day home, with their favourite places and toys." },
      { id: "remembrance", name: "Anniversary of passing", brief: "A short remembrance for the date, one or two photos and a message." },
    ],
    motif: "candle",
    hue: 40,
  },
  {
    id: "holiday-greeting",
    name: "Holiday greeting",
    medium: "video",
    category: "occasions",
    blurb: "A seasonal message for family, clients or fans",
    brief: "Short, warm, culturally respectful. Correct symbols, colours and greetings for the holiday; the sender's name at the end.",
    format: "9:16 + 1:1 · 10–30 s",
    keywords: ["cozy", "funny", "elegant", "kids"],
    variants: [
      { id: "christmas", name: "Christmas", brief: "Snow, lights and warmth." },
      { id: "hanukkah", name: "Hanukkah", brief: "The menorah lit night by night, blue and silver." },
      { id: "diwali", name: "Diwali", brief: "Diyas, rangoli and fireworks." },
      { id: "eid", name: "Eid", brief: "Crescent moon, lanterns and family gathering." },
      { id: "lunar-new-year", name: "Lunar New Year", brief: "Red and gold, lanterns and the year's zodiac animal." },
      { id: "new-year", name: "New Year's Eve", brief: "A countdown and fireworks at midnight." },
      { id: "thanksgiving", name: "Thanksgiving", brief: "A table, family and gratitude." },
      { id: "halloween", name: "Halloween", brief: "Spooky-fun, pumpkins and costumes." },
      { id: "valentines", name: "Valentine's Day", brief: "Romantic or playfully cheesy." },
      { id: "parents-day", name: "Mother's / Father's Day", brief: "Photos and a thank-you message." },
    ],
    motif: "confetti",
    hue: 140,
  },
  {
    id: "year-in-review",
    name: "Year in review",
    medium: "video",
    category: "occasions",
    blurb: "Your year, month by month",
    brief: "Twelve beats, one per month, with the best photo and a one-line caption; a closing stat or wish for next year.",
    format: "9:16 · 30–60 s",
    keywords: ["nostalgic", "hype", "cozy"],
    motif: "grid",
    hue: 260,
  },

  // ----- Images: photo shoots -------------------------------------------------
  {
    id: "birthday-shoot",
    name: "Birthday photo shoot",
    medium: "image",
    category: "shoots",
    blurb: "Balloons, cake and studio light — of you",
    brief:
      "Studio birthday set around the uploaded person: backdrop, balloons with their age, cake, confetti. Face identical to the reference; 4 poses.",
    format: "4:5 · 4 images",
    keywords: ["elegant", "playful", "luxury", "pastel", "black & gold"],
    motif: "confetti",
    hue: 320,
    isNew: true,
  },
  {
    id: "nine-variations",
    name: "9 cinematic variations",
    medium: "image",
    category: "shoots",
    blurb: "One photo, nine film-still angles",
    brief:
      "A 3×3 grid of the same subject and scene from nine cinematic setups: wide, medium, close-up, over-the-shoulder, low angle, high angle, profile, detail insert, silhouette. Identity and wardrobe identical.",
    format: "3×3 grid · 1:1",
    keywords: ["noir", "golden hour", "neon", "moody"],
    motif: "grid",
    hue: 210,
    isNew: true,
  },
  {
    id: "headshots",
    name: "Professional headshots",
    medium: "image",
    category: "shoots",
    blurb: "LinkedIn-ready, from a selfie",
    brief: "Chest-up, soft key light, neutral or office background, business attire; face identical; 4 background options.",
    format: "1:1 · 4 images",
    keywords: ["corporate", "creative", "outdoor", "studio"],
    motif: "flash",
    hue: 205,
  },
  {
    id: "couple-shoot",
    name: "Couple photo shoot",
    medium: "image",
    category: "shoots",
    blurb: "Engagement-style photos, anywhere",
    brief: "Both faces identical to references; natural poses, a chosen location, golden-hour light.",
    format: "4:5 · 4 images",
    keywords: ["romantic", "playful", "editorial", "beach", "city"],
    motif: "rise",
    hue: 355,
  },
  {
    id: "couples-editorial",
    name: "Couples editorial",
    medium: "image",
    category: "shoots",
    blurb: "A full session, not four nice pictures",
    brief:
      "An editorial session for two: the formal portrait, the movement frame, the detail, the environmental wide, a frame of each of them alone, and a graphic. Several lenses, several distances, one continuous light. Distinct from @couple-shoot, which is the quick engagement-style set.",
    format: "4:5 · 6 images",
    keywords: ["editorial", "romantic", "moody", "golden", "monochrome", "film grain"],
    variants: [
      { id: "city-night", name: "City at night", brief: "Wet streets, shop light, the two of them small against architecture." },
      { id: "golden", name: "Golden hour", brief: "Low sun, open ground, both rimmed and the background dissolved." },
      { id: "home", name: "At home", brief: "Their own rooms, window light, coffee, unstyled." },
      { id: "studio", name: "Studio", brief: "Seamless and one hard source; the relationship read as shape." },
      { id: "water", name: "Coast", brief: "Wind, salt, flat horizon, no landmarks." },
      { id: "monochrome", name: "Black and white", brief: "Texture and contact; hands, faces, cloth." },
    ],
    motif: "rise",
    hue: 345,
    isNew: true,
  },
  {
    id: "sensual-photoshoot",
    name: "Sensual editorial",
    medium: "image",
    category: "shoots",
    blurb: "Fabric, light and the line of a pose",
    brief:
      "A luxury editorial built on elegance rather than exposure: how silk falls, how one hard source models a shoulder, where a hand rests, how a spine reads as a line. Implied throughout — negative space, shadow and cloth do the work, and the subject holds the frame.",
    format: "4:5 · 6 images",
    keywords: ["luxury", "editorial", "monochrome", "moody", "warm", "film grain"],
    variants: [
      { id: "silk", name: "Silk", brief: "One fabric, many states: draped, falling, pooled, wrapped." },
      { id: "shadow", name: "Hard shadow", brief: "One source and a gobo; the body mapped by light and dark." },
      { id: "water", name: "Water", brief: "Wet skin, surface line, caustics, everything catching." },
      { id: "mirror", name: "Mirrors", brief: "Reflection and fragment; the subject seen indirectly." },
      { id: "sculpture", name: "Sculptural", brief: "Black seamless, oiled light, the body composed as form." },
      { id: "vintage", name: "Vintage glamour", brief: "1950s styling, soft focus, satin, a warm low key." },
    ],
    motif: "spotlight",
    hue: 25,
    isNew: true,
  },
  {
    id: "forbidden-editorial",
    name: "Forbidden editorial",
    medium: "image",
    category: "shoots",
    blurb: "A fashion story about restraint",
    brief:
      "High-fashion narrative built on tension: someone somewhere they should not be, dressed for somewhere else, caught a second before or after. It is a story told in six frames where nothing is stated — the drama lives in the wrong location, the wrong clothes and the held expression.",
    format: "4:5 · 6 images",
    keywords: ["editorial", "moody", "high-contrast", "monochrome", "luxury", "grainy"],
    variants: [
      { id: "empty-grand", name: "Empty grand rooms", brief: "Marble, dust sheets, evening wear in a house with no people." },
      { id: "after-hours", name: "After hours", brief: "A closed shop, a dark office, security lighting only." },
      { id: "wrong-weather", name: "Wrong weather", brief: "Couture in rain, snow or mud; the clothes ruined and worn anyway." },
      { id: "backstage", name: "Backstage", brief: "Corridors and service doors; the half-second before going on." },
      { id: "getaway", name: "The getaway", brief: "A car, a coat, a road at night, nothing explained." },
      { id: "masked", name: "Masked", brief: "Identity withheld by veil, shadow or crop in every frame." },
    ],
    motif: "letterbox",
    hue: 275,
    isNew: true,
  },
  {
    id: "maternity-shoot",
    name: "Maternity shoot",
    medium: "image",
    category: "shoots",
    blurb: "Soft, glowing, fine-art portraits",
    brief: "Flowing gown, soft window or studio light, fine-art posing; face identical; tasteful and elegant.",
    format: "4:5 · 4 images",
    keywords: ["ethereal", "boho", "studio", "outdoor"],
    motif: "rise",
    hue: 25,
  },
  {
    id: "family-portrait",
    name: "Family portrait",
    medium: "image",
    category: "shoots",
    blurb: "Everyone together, even if they can't be",
    brief: "Composite each person from their own reference into one natural group photo with matching light and scale.",
    format: "3:2 · 2 images",
    keywords: ["holiday", "classic", "outdoor", "matching outfits"],
    motif: "grid",
    hue: 30,
  },
  {
    id: "family-photoshoot",
    name: "Family photoshoot",
    medium: "image",
    category: "shoots",
    blurb: "A whole session, not one group shot",
    brief:
      "A real session rather than a single line-up: the formal group, the generations, the parents alone, each child alone, a candid, and a detail. One location, one light, one wardrobe palette, so six different pictures read as one afternoon. Distinct from @family-portrait, which composites people who could not be in the same room.",
    format: "4:5 · 6 images",
    keywords: ["classic", "editorial", "warm", "outdoor", "studio", "film grain"],
    variants: [
      { id: "outdoor-golden", name: "Outdoor golden hour", brief: "Long grass or trees, low sun behind, everyone rimmed in warm light." },
      { id: "home", name: "At home", brief: "Their own rooms and window light; the house as a character." },
      { id: "studio", name: "Studio", brief: "Seamless backdrop, controlled soft light, nothing but the family in frame." },
      { id: "beach", name: "Beach or water", brief: "Open sky, wind, bare feet, a horizon behind every frame." },
      { id: "holiday", name: "Holiday", brief: "Seasonal but restrained: one colour note, no props competing with faces." },
      { id: "generations", name: "Generations", brief: "Built around the oldest and youngest, with the frames pairing them." },
    ],
    motif: "spotlight",
    hue: 28,
    isNew: true,
  },
  {
    id: "pet-portrait",
    name: "Pet portrait",
    medium: "image",
    category: "shoots",
    blurb: "Your pet as a royal, a hero, a painting",
    brief: "The pet's exact markings and features, in a themed portrait setting.",
    format: "4:5 · 4 images",
    keywords: ["royal", "renaissance", "superhero", "cartoon", "studio"],
    motif: "spotlight",
    hue: 45,
  },

  {
    id: "athlete-photoshoot",
    name: "Athlete photoshoot",
    medium: "image",
    category: "shoots",
    blurb: "A whole editorial sports shoot, in one set",
    brief:
      "A complete shoot rather than six versions of one picture: a hero portrait, a peak-action frame, a texture detail, an environmental wide, a gear still and a graphic silhouette — each with its own lens, distance and light, all obviously the same athlete on the same day.",
    format: "4:5 · 6 images",
    keywords: ["editorial", "gritty", "premium", "moody", "high-key", "vintage sports"],
    variants: [
      { id: "studio", name: "Studio seamless", brief: "Controlled black or grey seamless, hard rim light, nothing in frame but the athlete." },
      { id: "stadium-night", name: "Stadium at night", brief: "Empty stands, floodlights as the key, long lens compression, breath in cold air." },
      { id: "gym", name: "Industrial gym", brief: "Chalk, steel, window light through grime, sweat catching the edge." },
      { id: "golden", name: "Outdoor golden hour", brief: "Track, field or road with low raking sun, long shadows and warm skin." },
      { id: "locker-room", name: "Locker room", brief: "Before or after, not during: fluorescent overhead, benches, tape, quiet." },
      { id: "street", name: "Street court", brief: "Cage, chain net, city behind; daylight and a real neighbourhood." },
      { id: "water", name: "Pool and water", brief: "Surface line, caustics, wet skin and goggles, shot both above and below." },
    ],
    motif: "spotlight",
    hue: 20,
    isNew: true,
  },

  // ----- Images: covers & posters ------------------------------------------------
  {
    id: "magazine-cover",
    name: "Magazine cover",
    medium: "image",
    category: "covers",
    blurb: "You, on the cover, with the headlines",
    brief:
      "Cover-model framing with the masthead behind the head, 3–5 cover lines, issue date and barcode; face identical. Invent the masthead — never use a real magazine's name.",
    format: "8.5×11 · 1 image",
    keywords: ["fashion", "business", "sports", "music", "vintage"],
    motif: "spotlight",
    hue: 0,
  },
  {
    id: "pet-magazine-cover",
    name: "Pet magazine cover",
    medium: "image",
    category: "covers",
    blurb: "Pet of the year, cover story inside",
    brief: "The pet as the cover star with playful cover lines about them; invented masthead.",
    format: "8.5×11 · 1 image",
    keywords: ["funny", "glam", "vintage"],
    motif: "spotlight",
    hue: 50,
  },
  {
    id: "product-poster",
    name: "Creative product posters",
    medium: "image",
    category: "covers",
    blurb: "Scroll-stopping key art for a product",
    brief: "One bold concept around the product, strong typography, the product label exact.",
    format: "4:5 + 9:16 · 3 concepts",
    keywords: ["luxury", "surreal", "minimal", "pop art", "Swiss"],
    motif: "spotlight",
    hue: 280,
  },
  {
    id: "teaser-poster-set",
    name: "Trailer poster campaign",
    medium: "image",
    category: "covers",
    blurb: "A poster campaign, not one poster",
    brief:
      "The full key-art set a film actually ships: a teaser that shows almost nothing, a character poster for each lead, and the final one-sheet. One visual idea runs through all of them. Every frame is built with the title, billing block and credits left as empty space, because that type is set in an editor. Distinct from @movie-poster, which is a single one-sheet.",
    format: "27×40 · 4–6 images",
    keywords: ["thriller", "horror", "romance", "sci-fi", "vintage", "A24"],
    variants: [
      { id: "teaser-first", name: "Teaser first", brief: "One object, one silhouette, almost no information; the rest follows it." },
      { id: "character-set", name: "Character posters", brief: "One lead per sheet, identical treatment, colour-coded." },
      { id: "one-sheet", name: "Final one-sheet", brief: "The full cast composite, the genre stated by composition alone." },
      { id: "festival", name: "Festival", brief: "Illustrated, restrained, an idea rather than faces." },
      { id: "retro", name: "Retro", brief: "Painted key art, period type space, montage composition." },
      { id: "minimal", name: "Minimal", brief: "One graphic element carrying the whole campaign." },
    ],
    motif: "letterbox",
    hue: 5,
    isNew: true,
  },
  {
    id: "movie-poster",
    name: "Movie poster",
    medium: "image",
    category: "covers",
    blurb: "Your story as a one-sheet",
    brief: "Title treatment, tagline, billing block, the hero image; genre-true composition.",
    format: "27×40 · 1 image",
    keywords: ["action", "horror", "romance", "sci-fi", "vintage"],
    motif: "letterbox",
    hue: 15,
  },
  {
    id: "album-cover",
    name: "Album cover",
    medium: "image",
    category: "covers",
    blurb: "Square art that sounds like the music",
    brief: "Square composition that reads at thumbnail size, artist and title placed or left off as asked.",
    format: "1:1 · 3 concepts",
    keywords: ["minimal", "grunge", "dreamy", "retro", "hip-hop"],
    motif: "equalizer",
    hue: 265,
  },
  {
    id: "thumbnail",
    name: "YouTube thumbnail",
    medium: "image",
    category: "covers",
    blurb: "Click-worthy at 120 pixels wide",
    brief: "A big expressive face or object, 3 words max, high contrast, one clear focal point.",
    format: "16:9 · 3 options",
    keywords: ["shocked", "clean", "gaming", "tutorial"],
    motif: "flash",
    hue: 5,
  },

  // ----- Images: product ---------------------------------------------------------
  {
    id: "product-photos",
    name: "Product photos",
    medium: "image",
    category: "commerce-images",
    blurb: "Store-ready stills in nine styles",
    brief: "Product label, shape and colour exact in every image.",
    format: "1:1 + 4:5 · 4 images",
    keywords: ["luxury", "minimal", "playful", "seasonal"],
    variants: [
      { id: "white-background", name: "White background", brief: "Pure white, soft shadow, marketplace-ready." },
      { id: "detail-macro", name: "Detail macro", brief: "Texture and material close-ups." },
      { id: "flat-lay", name: "Flat lay", brief: "Top-down styled arrangement with props." },
      { id: "lifestyle", name: "Lifestyle", brief: "The product in a real setting, in use." },
      { id: "luxury-atmospherics", name: "Luxury atmospherics", brief: "Silk, stone, water and dramatic light." },
      { id: "model-showcase", name: "Model showcase", brief: "Worn or held by a model." },
      { id: "infographic", name: "Infographic", brief: "Feature callouts and dimensions on the image." },
      { id: "virtual-try-on", name: "Virtual try-on", brief: "The same person wearing it in each colour." },
      { id: "seasonal", name: "Seasonal campaign", brief: "Styled for the current season or holiday." },
    ],
    motif: "grid",
    hue: 30,
  },

  // ----- Images: cards -----------------------------------------------------------
  {
    id: "holiday-card",
    name: "Holiday card",
    medium: "image",
    category: "cards",
    blurb: "Your family, on this year's card",
    brief: "Family faces identical, a seasonal scene, the greeting and family name in elegant type.",
    format: "5×7 · 2 designs",
    keywords: ["classic", "funny", "modern", "illustrated"],
    motif: "confetti",
    hue: 145,
  },
  {
    id: "invitation",
    name: "Invitation",
    medium: "image",
    category: "cards",
    blurb: "Party, wedding or shower — with the details",
    brief: "Event name, host, date, time, place and RSVP, legible and correct; theme-matched art.",
    format: "5×7 + 9:16 · 2 designs",
    keywords: ["elegant", "playful", "floral", "modern"],
    motif: "confetti",
    hue: 300,
  },
  {
    id: "memorial-portrait",
    name: "Memorial portrait",
    medium: "image",
    category: "cards",
    blurb: "A dignified portrait for the service",
    brief: "Restore and gently enhance the given photo without changing the face; soft background, name and years.",
    format: "8×10 · 1 image",
    motif: "candle",
    hue: 40,
  },

  // ----- Images: characters & design -------------------------------------------
  {
    id: "character-sheet",
    name: "Character design sheet",
    medium: "image",
    category: "design",
    blurb: "Turnaround, expressions and poses for one character",
    brief:
      "A consistent character reference sheet: front/side/back turnaround, an expression row, key poses and a colour palette, so the character stays identical in every later video.",
    format: "16:9 · 3 sheets",
    keywords: ["anime", "3D animated", "realistic", "cartoon", "painterly"],
    motif: "grid",
    hue: 240,
    isNew: true,
  },

  // ----- More image skills ------------------------------------------------------
  {
    id: "ai-avatars",
    name: "AI avatar pack",
    medium: "image",
    category: "shoots",
    blurb: "Your face in eight styles for every profile",
    brief:
      "Eight profile pictures of the same person in eight distinct looks (studio, editorial, painted, anime, 3D, noir…), identity locked, all square and crop-safe for circles.",
    format: "1:1 · 8 images",
    keywords: ["professional", "playful", "fantasy", "gaming", "minimal"],
    motif: "grid",
    hue: 280,
    isNew: true,
  },
  {
    id: "yearbook-photo",
    name: "Retro yearbook photo",
    medium: "image",
    category: "shoots",
    blurb: "You, in a 90s school portrait",
    brief:
      "A period-true school portrait: laser or mottled backdrop, era hair and wardrobe, soft studio flash, slight film grain — the face identical.",
    format: "4:5 · 4 images",
    keywords: ["70s", "80s", "90s", "2000s"],
    motif: "flash",
    hue: 25,
    isNew: true,
  },
  {
    id: "fashion-lookbook",
    name: "Fashion lookbook",
    medium: "image",
    category: "shoots",
    blurb: "One outfit, a campaign-ready look set",
    brief:
      "A lookbook of one outfit (from product photos) on a model: full look, detail, movement and styling shots, garment exact in every frame.",
    format: "4:5 · 6 images",
    keywords: ["street", "editorial", "minimal", "luxury", "resort"],
    motif: "letterbox",
    hue: 320,
    isNew: true,
  },
  {
    id: "food-photography",
    name: "Food photography",
    medium: "image",
    category: "shoots",
    blurb: "Menu and delivery-app shots that sell",
    brief:
      "Styled food photography of the owner's dish: hero angle, lighting and props chosen for the cuisine, the dish itself kept true to the photo.",
    format: "1:1 + 4:5 · 4 images",
    keywords: ["rustic", "bright & airy", "dark & moody", "street food", "fine dining"],
    motif: "spotlight",
    hue: 30,
    isNew: true,
  },
  {
    id: "car-photoshoot",
    name: "Car photoshoot",
    medium: "image",
    category: "shoots",
    blurb: "Your car, shot like a magazine feature",
    brief:
      "Automotive stills of the owner's car: 3/4 hero, profile, details, location and light chosen for the car's character; model, colour and wheels exact.",
    format: "16:9 + 4:5 · 5 images",
    keywords: ["night city", "golden hour", "studio", "track", "offroad"],
    motif: "orbit",
    hue: 210,
    isNew: true,
  },
  {
    id: "logo-design",
    name: "Logo design",
    medium: "image",
    category: "design",
    blurb: "Mark concepts for a brand, from a brief",
    brief:
      "Logo concepts from a brand brief: a symbol, a wordmark and a combination mark per direction, shown flat on white and in one mockup. Invented, never imitating an existing brand.",
    format: "1:1 · 3 directions",
    keywords: ["minimal", "geometric", "hand-drawn", "vintage", "tech"],
    motif: "orbit",
    hue: 250,
    isNew: true,
  },
  {
    id: "brand-board",
    name: "Brand board",
    medium: "image",
    category: "design",
    blurb: "Logo, colours, type and imagery on one sheet",
    brief:
      "A one-page brand identity board: mark, palette with hex values, type pairing, imagery style, patterns and two mockups, all in one coherent system.",
    format: "16:9 · 2 boards",
    keywords: ["luxury", "playful", "eco", "tech", "editorial"],
    motif: "grid",
    hue: 40,
    isNew: true,
  },
  {
    id: "sticker-pack",
    name: "Sticker pack",
    medium: "image",
    category: "design",
    blurb: "A character turned into die-cut stickers",
    brief:
      "A sheet of die-cut stickers of one character (or pet) with different expressions and short words, white borders, consistent style.",
    format: "1:1 · 2 sheets",
    keywords: ["kawaii", "retro", "bold outline", "3D"],
    motif: "confetti",
    hue: 300,
    isNew: true,
  },
  {
    id: "tattoo-design",
    name: "Tattoo design",
    medium: "image",
    category: "design",
    blurb: "Flash-ready tattoo concepts",
    brief:
      "Tattoo concepts as clean flash on paper plus a placement preview on the chosen body area; line weight and style true to the genre.",
    format: "3:4 · 3 designs",
    keywords: ["fine line", "traditional", "blackwork", "neo-trad", "minimal"],
    motif: "candle",
    hue: 0,
    isNew: true,
  },
  {
    id: "action-figure",
    name: "Action figure box",
    medium: "image",
    category: "design",
    blurb: "You as a boxed collectible figure",
    brief:
      "The person as a toy action figure in blister packaging with accessories that tell their story, a printed card back and a name on the box.",
    format: "3:4 · 2 images",
    keywords: ["retro 80s", "premium collector", "kids toy", "sci-fi"],
    motif: "spotlight",
    hue: 200,
    isNew: true,
  },
  {
    id: "phone-wallpaper",
    name: "Phone wallpaper",
    medium: "image",
    category: "design",
    blurb: "Custom lock screens that fit the clock",
    brief:
      "A set of phone wallpapers designed around the lock-screen clock and dock: safe zones kept clear, depth for the clock effect.",
    format: "9:16 · 4 images",
    keywords: ["minimal", "dreamy", "dark", "abstract", "nature"],
    motif: "rise",
    hue: 230,
    isNew: true,
  },
  {
    id: "storyboard-frames",
    name: "Storyboard frames",
    medium: "image",
    category: "illustration",
    blurb: "A script as a sheet of storyboard panels",
    brief:
      "A storyboard of a scene: numbered panels with framing, camera move arrows and action notes, consistent characters — ready to hand to a video skill.",
    format: "16:9 · 1–3 sheets",
    keywords: ["sketch", "clean line", "colour animatic"],
    motif: "letterbox",
    hue: 195,
    isNew: true,
  },
  {
    id: "comic-page",
    name: "Comic page",
    medium: "image",
    category: "illustration",
    blurb: "A story told as a comic or manga page",
    brief:
      "A full comic page: panel layout for pacing, consistent characters, speech balloons with short exact lines, a page-turn hook.",
    format: "2:3 · 1–4 pages",
    keywords: ["manga", "western comic", "webtoon", "graphic novel"],
    motif: "grid",
    hue: 15,
    isNew: true,
  },
  {
    id: "childrens-book",
    name: "Children's book illustration",
    medium: "image",
    category: "illustration",
    blurb: "Picture-book spreads with a consistent hero",
    brief:
      "Picture-book illustrations for a story: one spread per beat, the same lovable character throughout, space left for the text.",
    format: "3:2 · 4–12 spreads",
    keywords: ["watercolor", "gouache", "crayon", "3D animated", "paper cut"],
    motif: "storybook",
    hue: 38,
    isNew: true,
  },
  {
    id: "virtual-staging",
    name: "Virtual staging",
    medium: "image",
    category: "spaces",
    blurb: "Empty rooms furnished for the listing",
    brief:
      "Empty-room photos staged with furniture that fits the room's real size and light; walls, windows, floors and architecture untouched.",
    format: "Original ratio · 1 per room",
    keywords: ["modern", "scandinavian", "luxury", "family", "coastal"],
    motif: "rise",
    hue: 150,
    isNew: true,
  },
  {
    id: "interior-redesign",
    name: "Interior redesign",
    medium: "image",
    category: "spaces",
    blurb: "Your room, restyled in a new look",
    brief:
      "The owner's room photo redesigned in a chosen style: same layout and architecture, new finishes, furniture, colour and lighting.",
    format: "Original ratio · 3 styles",
    keywords: ["japandi", "industrial", "boho", "mid-century", "maximalist"],
    motif: "grid",
    hue: 90,
    isNew: true,
  },
  {
    id: "twilight-exterior",
    name: "Twilight exterior",
    medium: "image",
    category: "spaces",
    blurb: "Daytime house photo turned to dusk",
    brief:
      "A daytime exterior converted to a twilight shot: deep blue sky, warm interior lights, landscape lighting, the house itself unchanged.",
    format: "Original ratio · 2 images",
    motif: "candle",
    hue: 220,
    isNew: true,
  },

  // ----- Images: fix & restore -----------------------------------------------------
  {
    id: "photo-restore",
    name: "Old photo restoration",
    medium: "image",
    category: "restore",
    blurb: "Scratches gone, faces kept",
    brief: "Remove damage, scratches and fading; sharpen gently; never change faces or add details that were not there.",
    format: "Original size · 1 image",
    motif: "flash",
    hue: 35,
  },
  {
    id: "colorize",
    name: "Colorize",
    medium: "image",
    category: "restore",
    blurb: "Black and white, brought back to colour",
    brief: "Period-accurate, natural colours; skin tones realistic; keep the grain.",
    format: "Original size · 1 image",
    motif: "rise",
    hue: 180,
  },
];

// ---------------------------------------------------------------------------
// Mentions: "@kids-story" or "@e-commerce:flat-lay".
// ---------------------------------------------------------------------------

export interface Mention {
  /** What goes after @. */
  token: string;
  workflow: Workflow;
  variant: Variant | null;
  /** "E-commerce › Flat lay". */
  label: string;
}

const BY_ID = new Map(WORKFLOWS.map((w) => [w.id, w]));

export function workflowById(id: string): Workflow | undefined {
  return BY_ID.get(id);
}

export function categoryOf(w: Workflow): Category {
  return CATEGORIES.find((c) => c.id === w.category)!;
}

/**
 * Workflows with a rendered card still in `public/studio/cards/<id>.webp` — a
 * photograph of the thing the workflow makes, generated free and locally by
 * Flux 2 Klein through WanGP (the preview-icon skill's `studio-cards.mjs`).
 *
 * Listed rather than derived from the id, so a card only ever points at a file
 * that exists; anything not listed falls back to its motif animation. Re-render
 * the set and paste the script's list back here.
 */
export const CARD_STILLS = new Set<string>([
  "story-to-video", "kids-story", "short-drama",
  "religious-story", "scary-story", "cinematic-story",
  "product-ad", "commercial", "ad-remake",
  "comedy-commercial", "ugc-ad", "brand-film",
  "promo", "automotive-ad", "sports-campaign",
  "real-estate", "hero-product-reveal", "product-showcase",
  "e-commerce", "luxury-fashion-walk", "logo-reveal",
  "motion-graphics", "workout-ad", "training-montage",
  "athlete-motivation", "game-day-hype", "impossible-trick",
  "slow-motion-technique", "event-editorial", "event-fashion-film",
  "luxury-invitation-film", "vlog-influencer", "fitness-influencer",
  "youtube-influencer", "reaction-video", "joke-video", "street-interview",
  "news-anchor", "sitcom-scene", "sitcom-intro",
  "podcast-show", "tutorial-steps", "romantic-film",
  "romantic-montage", "seduction-film", "noir-seduction",
  "boudoir-film", "social-content", "vlog-memories",
  "outfit-try-on", "seamless-loop", "flash-montage",
  "music-video", "film-trailer", "game-trailer",
  "game-cutscene", "micro-expressions", "crisis-evasion",
  "fight-choreography", "dolly-zoom", "hitchcock-dolly-zoom",
  "split-screen", "bullet-time",
  "parallax-focus-relay", "object-lock-on", "fpv-thread-the-needle",
  "snorricam", "mechanical-transformation", "interview",
  "explainer", "avatar-lip-sync", "instructional-motion",
  "dance-tutorial", "asmr-cooking", "birthday-video",
  "wedding", "anniversary", "baby",
  "graduation", "retirement", "memorial",
  "holiday-greeting", "year-in-review", "birthday-shoot",
  "nine-variations", "headshots", "couple-shoot",
  "couples-editorial", "sensual-photoshoot", "forbidden-editorial",
  "maternity-shoot", "family-portrait", "family-photoshoot",
  "pet-portrait", "athlete-photoshoot", "magazine-cover",
  "pet-magazine-cover", "product-poster", "teaser-poster-set",
  "movie-poster", "album-cover", "thumbnail",
  "product-photos", "holiday-card", "invitation",
  "memorial-portrait", "character-sheet", "ai-avatars",
  "yearbook-photo", "fashion-lookbook", "food-photography",
  "car-photoshoot", "logo-design", "brand-board",
  "sticker-pack", "tattoo-design", "action-figure",
  "phone-wallpaper", "storyboard-frames", "comic-page",
  "childrens-book", "virtual-staging", "interior-redesign",
  "twilight-exterior", "photo-restore", "colorize",
]);

/** The card's still, or null when it has not been rendered yet. */
export function cardStill(id: string): string | null {
  return CARD_STILLS.has(id) ? `/studio/cards/${id}.webp` : null;
}

/** Every @-able entry: each workflow, then each of its variants. */
export const MENTIONS: Mention[] = WORKFLOWS.flatMap((w) => [
  { token: w.id, workflow: w, variant: null, label: w.name },
  ...(w.variants ?? []).map((v) => ({
    token: `${w.id}:${v.id}`,
    workflow: w,
    variant: v,
    label: `${w.name} › ${v.name}`,
  })),
]);

const BY_TOKEN = new Map(MENTIONS.map((m) => [m.token, m]));

export function resolveMention(token: string): Mention | undefined {
  return BY_TOKEN.get(token.toLowerCase());
}

export const MENTION_PATTERN = /(^|\s)@([a-z0-9-]+(?::[a-z0-9-]+)?)/gi;

/** The known workflows mentioned in a message, in order, without repeats. */
export function mentionsIn(text: string): Mention[] {
  const out: Mention[] = [];
  for (const m of text.matchAll(MENTION_PATTERN)) {
    const hit = resolveMention(m[2]);
    if (hit && !out.some((o) => o.token === hit.token)) out.push(hit);
  }
  return out;
}

/** The half-typed "@kid" right before the caret, if any. */
export function mentionQueryAt(text: string, caret: number): { start: number; query: string } | null {
  const m = /(^|\s)@([a-z0-9:-]*)$/i.exec(text.slice(0, caret));
  if (!m) return null;
  return { start: caret - m[2].length - 1, query: m[2].toLowerCase() };
}

/** Menu matches: name and token prefixes first, then anywhere. */
export function searchMentions(query: string, limit = 12): Mention[] {
  const q = query.toLowerCase().replace(/[-:]/g, " ").trim();
  if (!q) return MENTIONS.filter((m) => !m.variant).slice(0, limit);
  const scored = MENTIONS.map((m) => {
    const hay = `${m.label} ${m.token.replace(/[-:]/g, " ")} ${m.workflow.blurb}`.toLowerCase();
    const label = m.label.toLowerCase();
    const score = label.startsWith(q) ? 0 : hay.includes(` ${q}`) || label.includes(q) ? 1 : hay.includes(q) ? 2 : 9;
    return { m, score };
  }).filter((s) => s.score < 9);
  scored.sort((a, b) => a.score - b.score || Number(!!a.m.variant) - Number(!!b.m.variant));
  return scored.slice(0, limit).map((s) => s.m);
}

/**
 * What Jarvis receives while Studio skills are active: the operating rules,
 * then each picked skill — its full skill file when one exists, otherwise the
 * catalog's short brief — and the variant the owner chose.
 */
export function studioContext(mentions: Mention[], skills: Map<string, string> = new Map()): string {
  if (!mentions.length) return "";
  const lead = mentions[0];
  const parts = mentions.map((m, i) => {
    const w = m.workflow;
    const head = `### SKILL ${i + 1}${i === 0 ? " (LEADS)" : ""}: ${m.label} — ${w.medium}, ${w.format}`;
    const variant = m.variant ? `\nThe owner chose the variant "${m.variant.name}": ${m.variant.brief}` : "";
    const keywords = w.keywords?.length ? `\nStyle keywords this workflow offers: ${w.keywords.join(", ")}.` : "";
    const body =
      skills.get(w.id) ?? `(No full skill file yet — work from this brief, in the same round structure.)\n${w.brief}`;
    return `${head}${variant}${keywords}\n\n${body}`;
  });
  return [
    "STUDIO MODE — the owner is making something with Studio skills. RUN the skill(s) below as written:",
    "- Follow the rounds in order and pick up where this conversation is. A message starting \"[Form: …]\" is",
    "  the owner's submitted answers to the form of that title — never ask for those answers again.",
    "- Every question or choice goes through the studio_form tool, never plain text. Write any lead-in",
    "  (e.g. your emotional read, the option explanations) as your message text in the same turn.",
    "- Call studio_generate only after the owner approved the final prompt. Images the owner attached",
    "  anywhere in this conversation are the references, in order (Subject 1, Subject 2, …).",
    "- ONE clip → studio_generate. MORE THAN ONE SHOT, or anything that tells a story → studio_storyboard,",
    "  which lays the film out as a shot plan the owner edits and then renders as one continuous film: the",
    "  shots are rendered in order, every shot marked \"continuous\" starts from the last frame of the one",
    "  before it, and ffmpeg cuts them together. Fill the film-wide fields (mood, world, wardrobe, lighting,",
    "  grade, lens, look) concretely — they are repeated word for word into every shot, and they are the only",
    "  reason a dozen separate generations read as one film. Always write ends_on: the next shot is told to",
    "  open on it.",
    "",
    "SEATING A SKILL INSIDE A FILM. Most skills below are written for ONE clip — they say so, in their",
    "deliverable line: \"one continuous 5-15 s shot\", \"one coherent uninterrupted long take\". That is the",
    "skill's SHAPE, and it is a fact about the craft, not about the length of the owner's film. Read each",
    "skill's shape first and seat it, rather than letting it swallow the film or dissolve into it:",
    "- A ONE-SHOT skill (a camera effect: dolly zoom, crash-in, Snorricam) owns exactly ONE cut. Give it",
    "  its own shot, put its geometry in that shot's camera_note, and let the shots either side be",
    "  ordinary coverage that matches on wardrobe, light, lens and location so they cut together.",
    "- A ONE-TAKE SEQUENCE skill (a sustained action: crisis evasion, a chase, a fall) owns a RUN of",
    "  consecutive cuts, all linked \"continuous\" and sharing one location string, because one take is",
    "  exactly what a chain of continuous shots renders as. It does NOT own the whole film. The film may",
    "  open before it and end after it; the sequence is the stretch in the middle that never cuts.",
    "- Two skills in one film usually means two different stretches of it, not one blended shot. Say in",
    "  your message which cuts each skill owns.",
    "Never let a skill's craft dissolve into the action prose. A named camera move with no geometry",
    "renders as the ordinary move its words describe; a hazard with no clock renders as a held pose. Run",
    "the skill's rounds to decide the shot, then write what it decided into the fields that carry it.",
    "- Outside a skill's run, the same rule holds: one continuous action — a chase, a fall, a run through",
    "  a building — is a chain of \"continuous\" shots sharing one location, not a series of cuts. Cuts are",
    "  for when the audience should feel one.",
    "- Audio the owner attached appears in their message as a measured note ([Audio 1] … tempo, key, tone).",
    "  That is real measurement, not a listen — use it to set the cutting rhythm and the mood, and never",
    "  claim to have heard the track. It is laid under the finished film automatically.",
    "- Video renders FREE on the owner's PC by default (engine \"local\": Pinokio/WanGP, ~6 min per 5 s clip,",
    "  one clip at a time). Use engine \"cloud\" (paid RunPod) only if the owner explicitly asks for it. When a",
    "  skill says to render several candidates, say how long the local queue will take.",
    `- Several skills = ONE interaction: "${lead.label}" leads the rounds; fold the others' fields and rules`,
    "  into the same forms and the same final output; never ask the same thing twice.",
    "- Style keywords the owner wrote (e.g. \"Keywords: luxury, funny\") are binding.",
    "- Studio output may be as long as the skill's template needs; the short-answer rule does not apply.",
    "",
    ...parts,
  ].join("\n");
}

/** The short, brief-only form (kept for places that only need the gist). */
export function workflowBrief(mentions: Mention[]): string {
  return studioContext(mentions);
}
