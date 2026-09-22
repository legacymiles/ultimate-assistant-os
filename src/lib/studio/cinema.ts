// ---------------------------------------------------------------------------
// The camera department — what a Studio prompt inherits before a word of the
// idea is written.
//
// A workflow ("@kids-story") says WHAT is being made. The cinema deck says how
// it is SHOT: the film it is shot on, the glass in front of it, how open that
// glass is, the genre/era/tempo it belongs to, how it is lit, how it is graded,
// and the moves the camera makes.
//
// Every option carries a `prompt` — the sentence a cinematographer would put in
// a brief. That, not the label, is what reaches the model, which is the whole
// point: "35mm Film" tells a video model nothing, "35 mm motion picture film,
// fine organic grain, gentle halation on highlights" tells it everything.
//
// Two ways in, one source of truth:
//   · the four panel groups below → a selection object (one option per rail)
//   · MOVES → ordered "#dolly-in" tokens the owner types or clicks into the
//     prompt box, because with camera moves the ORDER is the shot.
//
// ADD ONE = add an object. Ids are tokens the owner can type, so they are
// lowercase-with-dashes, unique across every rail and move, and never change
// once shipped.
// ---------------------------------------------------------------------------

export interface CinemaOption {
  id: string;
  name: string;
  /** The one-line hint under the name in the picker. */
  note: string;
  /** What the model actually reads. Written as direction, not as a label. */
  prompt: string;
  /** Palettes only: the swatch strip under the tile, shadows first. */
  colors?: string[];
  /** Tempo only: the relative length of each shot, drawn as the cut rhythm. */
  cuts?: number[];
  /** Long rails only: the shelf this option is filed under in the picker. */
  family?: string;
}

export interface CinemaRail {
  id: string;
  label: string;
  options: CinemaOption[];
}

export type GroupId = "film" | "camera" | "style" | "color" | "lighting";

export interface CinemaGroup {
  id: GroupId;
  label: string;
  /** The line under the group title inside the dialog. */
  hint: string;
  rails: CinemaRail[];
}

// ---------------------------------------------------------------------------
// Film setup — the world the footage belongs to.
// ---------------------------------------------------------------------------

const GENRE: CinemaOption[] = [
  { id: "genre-auto", name: "Auto", note: "Let the story pick", prompt: "" },
  { id: "genre-horror", name: "Horror", note: "Dread in the negative space", prompt: "Horror: dread built from what is out of frame, oppressive negative space, the subject small inside it, a held beat too long before anything moves." },
  { id: "genre-noir", name: "Film noir", note: "Venetian blinds and guilt", prompt: "Film noir: hard single-source key, deep crushed shadows, slatted light across faces, fog and wet asphalt, every face half in darkness." },
  { id: "genre-thriller", name: "Thriller", note: "Tight, withheld, coiled", prompt: "Thriller: tight framing that withholds information, subjects pressed to the edge of frame, cold restrained palette, tension carried by stillness." },
  { id: "genre-scifi", name: "Sci-fi", note: "Scale, glass and cold light", prompt: "Science fiction: engineered surfaces, enormous scale against a human figure, cold practical light sources, clean volumetric haze." },
  { id: "genre-fantasy", name: "Fantasy", note: "Painterly, mythic, tall", prompt: "Fantasy: painterly mythic imagery, tall vertical compositions, god rays through canopy or cathedral, saturated earth and jewel tones." },
  { id: "genre-action", name: "Action", note: "Weight, impact, consequence", prompt: "Action: physical weight and consequence in every movement, impacts that shake the frame, debris and dust in the air, muscular contrasty light." },
  { id: "genre-western", name: "Western", note: "Horizon, dust, patience", prompt: "Western: a low horizon under an enormous sky, dust hanging in raking light, patient wide framing, sun-bleached earth tones." },
  { id: "genre-romance", name: "Romance", note: "Warm, close, unhurried", prompt: "Romance: warm soft light wrapping faces, shallow focus that isolates two people, unhurried framing, skin tones lifted and golden." },
  { id: "genre-comedy", name: "Comedy", note: "Bright, flat, legible", prompt: "Comedy: bright even light, flat legible staging where the joke is always visible, clean saturated colour, nothing hidden in shadow." },
  { id: "genre-doc", name: "Documentary", note: "Found, not staged", prompt: "Documentary: available light only, imperfect handheld framing that reacts rather than anticipates, real locations, nothing staged or polished." },
  { id: "genre-music-video", name: "Music video", note: "Style over continuity", prompt: "Music video: style over continuity, bold colour, performance energy to camera, every frame designed as an image rather than a link in a story." },
  { id: "genre-anime", name: "Anime", note: "Cel-shaded, expressive", prompt: "Anime: cel-shaded forms, bold clean line work, expressive exaggerated motion, painted background art, speed lines on fast movement." },
  { id: "genre-war", name: "War", note: "Grit, chaos, desaturation", prompt: "War: desaturated grit, smoke and ash in the air, chaotic unstable framing, cold steel and mud palette." },
  { id: "genre-heist", name: "Heist", note: "Cool, precise, geometric", prompt: "Heist: precise geometric compositions, cool controlled palette, competence shown through clean tight inserts of hands and mechanisms." },
  { id: "genre-supernatural", name: "Supernatural", note: "Something is wrong", prompt: "Supernatural: something subtly wrong in an ordinary space, unmotivated light source, unnatural stillness, colour draining toward one hue." },
  { id: "genre-sports", name: "Sports", note: "Effort at high shutter", prompt: "Sports: high shutter speed crispness, sweat and breath visible, long-lens compression from the sideline, stadium light flaring." },
];

const ERA: CinemaOption[] = [
  { id: "era-auto", name: "Auto", note: "Let the story set the period", prompt: "" },
  { id: "era-1920s", name: "1920s silent", note: "Hand-cranked monochrome", prompt: "1920s silent era: orthochromatic black and white, hand-cranked slightly fast motion, heavy vignette, scratches and frame jitter." },
  { id: "era-1940s", name: "1940s", note: "Studio black and white", prompt: "1940s studio era: glossy black-and-white, hard key with a rim light, deep focus staging, tailored period wardrobe." },
  { id: "era-1950s", name: "1950s Technicolor", note: "Impossibly saturated", prompt: "1950s Technicolor: impossibly saturated primaries, glowing skin tones, painted-backdrop cleanliness, three-strip colour separation." },
  { id: "era-1960s", name: "1960s new wave", note: "Loose, real, handheld", prompt: "1960s new wave: loose handheld framing, real streets, natural light, jump-cut energy, muted period colour stock." },
  { id: "era-1970s", name: "1970s", note: "Grain, zooms, brown", prompt: "1970s: warm brown-and-orange palette, heavy grain, sudden zoom adjustments, smoke-filled interiors, lens flare across the frame." },
  { id: "era-retro-future", name: "Retro-future", note: "Tomorrow, as of 1975", prompt: "Retro-future: the future as imagined in the 1970s — curved plastics, CRT readouts, beige and orange, analogue switches everywhere." },
  { id: "era-1980s", name: "1980s", note: "Neon, smoke, hard light", prompt: "1980s: neon practicals cutting through smoke, hard magenta and cyan rim lights, glossy blacks, anamorphic streak flares." },
  { id: "era-1990s", name: "1990s", note: "Camcorder domesticity", prompt: "1990s: consumer camcorder texture, slightly green fluorescent interiors, burnt-in timecode, domestic ordinariness." },
  { id: "era-2000s", name: "2000s", note: "Early digital, teal", prompt: "2000s: early digital video, crushed teal grade, over-sharpened edges, high-key commercial lighting." },
  { id: "era-2010s", name: "2010s", note: "Clean DSLR shallow", prompt: "2010s: clean DSLR look, very shallow depth of field, lifted matte blacks, desaturated film-emulation grade." },
  { id: "era-present", name: "Present day", note: "Now, unstyled", prompt: "Present day: contemporary wardrobe, devices and signage, neutral modern grade, nothing that dates the image to another decade." },
  { id: "era-near-future", name: "Near future", note: "Ten years out", prompt: "Near future, roughly a decade out: today's world with quietly advanced materials, displays and transport; believable, not fantastical." },
  { id: "era-far-future", name: "Far future", note: "Unrecognisable", prompt: "Far future: architecture and technology with no present-day analogue, unfamiliar materials and light sources, human scale dwarfed." },
];

const TEMPO: CinemaOption[] = [
  { id: "tempo-auto", name: "Auto", note: "Let the story set the pace", prompt: "", cuts: [] },
  {
    id: "tempo-single",
    name: "Single shot",
    note: "One take, no cuts",
    prompt:
      "One continuous shot from the first frame to the last: no cut anywhere, the camera move and the blocking carrying every beat themselves.",
    cuts: [1],
  },
  {
    id: "tempo-calm",
    name: "Calm",
    note: "Three or four long holds",
    prompt:
      "A calm cut rhythm: only three or four shots in the whole piece, each held long enough to settle before the next, nothing cut away from early.",
    cuts: [0.36, 0.3, 0.34],
  },
  {
    id: "tempo-dynamic",
    name: "Dynamic",
    note: "Six to ten shots, cut on movement",
    prompt:
      "A dynamic cut rhythm: six to ten shots of varying length, cutting on movement so the energy builds, but every shot still held long enough to read.",
    cuts: [0.16, 0.1, 0.14, 0.2, 0.09, 0.17, 0.14],
  },
  {
    id: "tempo-chaotic",
    name: "Chaotic",
    note: "A dozen hard cuts, scale jumping",
    prompt:
      "A chaotic cut rhythm: a dozen or more short shots, hard cuts landing on the beat, angle and scale jumping between every one of them.",
    cuts: [0.09, 0.06, 0.1, 0.05, 0.08, 0.07, 0.11, 0.05, 0.09, 0.06, 0.08, 0.07, 0.09],
  },
  {
    id: "tempo-flash",
    name: "Flash montage",
    note: "Frames, not shots",
    prompt:
      "A flash montage: twenty or more very short shots, several of them only a few frames long, cut faster than the eye can settle — impression over legibility.",
    cuts: Array.from({ length: 24 }, (_, i) => 0.028 + (i % 3) * 0.012),
  },
];

// ---------------------------------------------------------------------------
// Camera — the body, the glass, and how open it is.
// ---------------------------------------------------------------------------

const BODY: CinemaOption[] = [
  { id: "cam-modern", name: "Modern digital", note: "Clean cinema sensor", prompt: "Shot on a modern digital cinema camera: clean full-frame capture, natural highlight roll-off, no grain, true colour." },
  { id: "cam-35mm", name: "35mm film", note: "The cinema default", prompt: "Shot on 35 mm motion picture film: fine organic grain, gentle halation around highlights, deep film latitude, slight weave." },
  { id: "cam-super16", name: "Super 16", note: "Coarse and immediate", prompt: "Shot on Super 16 mm film: coarse visible grain, slight gate weave, softer resolution, documentary immediacy." },
  { id: "cam-8mm", name: "Super 8", note: "Home movies", prompt: "Shot on Super 8 home-movie film: heavy grain, soft corners, dust and scratches, flicker, faded warm cast, no sound." },
  { id: "cam-imax", name: "IMAX 65mm", note: "Enormous and sharp", prompt: "Shot on IMAX 65 mm large format: enormous depth and resolution, razor detail corner to corner, overwhelming sense of scale." },
  { id: "cam-vhs", name: "VHS camcorder", note: "Tape, tracking, timecode", prompt: "Shot on a 1990s VHS camcorder: interlaced scanlines, chroma bleed, tracking noise, blown highlights, burnt-in timecode in the corner." },
  { id: "cam-hi8", name: "Hi8 camcorder", note: "Soft late-80s video", prompt: "Shot on a late-1980s Hi8 camcorder: soft video resolution, blooming highlights, tape warble, slightly green cast." },
  { id: "cam-dv", name: "MiniDV", note: "Early-2000s home video", prompt: "Shot on MiniDV: 4:3 standard definition, interlaced motion, harsh auto-exposure hunting, thin digital colour." },
  { id: "cam-dslr", name: "DSLR video", note: "2010s YouTube look", prompt: "Shot on an early-2010s DSLR: crisp sensor, visible rolling shutter on fast pans, consumer-zoom rendering, moiré on fine patterns." },
  { id: "cam-phone", name: "Phone", note: "Computational and sharp", prompt: "Shot on a modern phone: ultra-sharp, heavy computational HDR, wide depth of field, handheld, vertical-native framing." },
  { id: "cam-webcam", name: "Webcam", note: "Compressed and lit badly", prompt: "Shot on a laptop webcam: low resolution, compression blocking, uneven auto-exposure, frame stutter, lit only by the screen." },
  { id: "cam-cctv", name: "Security camera", note: "Fixed, high, timestamped", prompt: "Shot on a fixed CCTV camera: high wide corner mount, low frame rate, washed colour, timestamp overlay, mild fisheye distortion." },
  { id: "cam-bodycam", name: "Body cam", note: "Chest height, lurching", prompt: "Shot on a chest-mounted body camera: wide distorted field, lurching with every step, blown highlights, low-light noise." },
  { id: "cam-drone", name: "Drone", note: "Aerial and stabilised", prompt: "Shot from a drone: aerial vantage, glassy gimbal stabilisation, exaggerated altitude and scale, wide clean optics." },
  { id: "cam-polaroid", name: "Instant film", note: "Creamy and bloomed", prompt: "Instant-film rendering: creamy low contrast, bloomed whites, cyan-leaning shadows, soft square frame with a white border feel." },
  { id: "cam-bolex", name: "Bolex", note: "Hand-cranked 16mm", prompt: "Shot on a hand-cranked Bolex 16 mm: uneven frame rate, vignetted corners, vintage uncoated optics, silent-film texture." },
  { id: "cam-thermal", name: "Thermal", note: "Heat as colour", prompt: "Thermal imaging camera: heat mapped to false colour, bodies glowing white-hot against cool surroundings, no visible texture or print." },
  { id: "cam-nightvision", name: "Night vision", note: "Green and noisy", prompt: "Night-vision image intensifier: monochrome green, blown point highlights, heavy sensor noise, circular vignette." },
];

const LENS: CinemaOption[] = [
  { id: "lens-anamorphic", name: "Vintage anamorphic", note: "Oval bokeh, blue flares", prompt: "Vintage anamorphic glass: oval bokeh, horizontal blue streak flares, soft distorted edges, widescreen squeeze." },
  { id: "lens-anamorphic-modern", name: "Modern anamorphic", note: "Clean scope", prompt: "Modern anamorphic glass: clean sharp scope framing, subtle oval bokeh, controlled flares." },
  { id: "lens-warm-vintage", name: "Warm vintage", note: "Amber and low contrast", prompt: "Warm vintage glass: lowered contrast, amber cast, a soft glow blooming out of every highlight." },
  { id: "lens-halation", name: "Halation vintage", note: "Red bloom on lights", prompt: "Uncoated vintage glass with heavy halation: a red-orange bloom wrapping every bright source, milky lifted blacks." },
  { id: "lens-wide-24", name: "24mm wide", note: "Expansive, close", prompt: "24 mm wide lens: expansive space, subject close to camera with the environment wrapping behind them, mild edge stretch." },
  { id: "lens-ultrawide", name: "14mm ultra-wide", note: "Lines that converge hard", prompt: "14 mm ultra-wide lens: dramatic converging lines, enormous foreground, distant compressed background, edge distortion." },
  { id: "lens-fisheye", name: "Fisheye", note: "180°, curved horizon", prompt: "8 mm circular fisheye: extreme barrel distortion, horizon curving across the frame, 180-degree field, the subject bulging at the centre and everything else bending away." },
  { id: "lens-normal-50", name: "50mm normal", note: "What the eye sees", prompt: "50 mm normal lens: human-eye perspective, no distortion, natural subject-to-background separation." },
  { id: "lens-portrait-85", name: "85mm portrait", note: "Flattering fall-off", prompt: "85 mm portrait lens: flattering facial compression, creamy background fall-off, subject cleanly lifted off the backdrop." },
  { id: "lens-tele-135", name: "135mm telephoto", note: "Stacked and flat", prompt: "135 mm telephoto: heavy compression, background stacked flat behind the subject, layers pressed together." },
  { id: "lens-long-300", name: "300mm long lens", note: "Watched from far away", prompt: "300 mm long lens: extreme compression and isolation, shot from a great distance, the feeling of being observed." },
  { id: "lens-macro", name: "Macro", note: "Life-size texture", prompt: "Macro lens: life-size detail, a focus plane only millimetres deep, texture and moisture readable on every surface." },
  { id: "lens-probe", name: "Probe lens", note: "Travels through the scene", prompt: "Probe lens: a tiny front element travelling through the scene at impossible proximity, deep focus from front to back." },
  { id: "lens-tilt-shift", name: "Tilt-shift", note: "Miniature effect", prompt: "Tilt-shift: the focus plane tilted off-axis so a real scene reads as a miniature model, sharp band through the middle." },
  { id: "lens-petzval", name: "Petzval swirl", note: "Edges that spin", prompt: "Petzval lens: a sharp centre with bokeh swirling around the edges, 19th-century optical character, strong vignette." },
  { id: "lens-diffusion", name: "Soft diffusion", note: "Romantic haze", prompt: "Heavy diffusion filter: dreamy glow, lifted blacks, highlights blooming into a romantic haze." },
  { id: "lens-split-diopter", name: "Split diopter", note: "Both planes sharp", prompt: "Split diopter: foreground and far background both razor sharp at once, with a visible soft seam dividing the frame." },
  { id: "lens-smeared", name: "Smeared edges", note: "Centre sharp, edges melt", prompt: "Smeared-edge optic: the centre razor sharp while the periphery melts into streaked blur." },
];

const APERTURE: CinemaOption[] = [
  { id: "ap-auto", name: "Auto", note: "Let the shot decide", prompt: "" },
  { id: "ap-f14", name: "f/1.4 wide open", note: "Paper-thin focus", prompt: "Shot wide open at f/1.4: a paper-thin plane of focus, the background dissolved into pure light and shape." },
  { id: "ap-f2", name: "f/2", note: "Separated but readable", prompt: "Shot at f/2: subject sharp, background softly separated but still readable." },
  { id: "ap-f28", name: "f/2.8", note: "Shallow, environment legible", prompt: "Shot at f/2.8: shallow depth with the environment still legible behind the subject." },
  { id: "ap-f56", name: "f/5.6", note: "Balanced", prompt: "Shot at f/5.6: balanced depth, the subject and their immediate surroundings all sharp." },
  { id: "ap-f11", name: "f/11 deep focus", note: "Everything sharp", prompt: "Shot at f/11 for deep focus: everything from the foreground to the horizon rendered sharp." },
  { id: "ap-f22", name: "f/22", note: "Total depth, sunstars", prompt: "Stopped down to f/22: total depth of field, every light source flaring into a pointed sunstar." },
];

// ---------------------------------------------------------------------------
// Colour and light.
// ---------------------------------------------------------------------------

const GRADE: CinemaOption[] = [
  { id: "grade-auto", name: "Auto", note: "Let the look decide", prompt: "" },
  { id: "grade-natural", name: "Plain Daylight", note: "Natural, true to life", prompt: "Naturalistic grade: true-to-life colour, accurate skin tones, no stylisation.", colors: ["#2b2f33", "#4c5a63", "#7d8b93", "#a9b3b6", "#c9c3b4", "#d8c9a8", "#b58f63", "#8a6540", "#5c4630", "#ece6da"] },
  { id: "grade-teal-orange", name: "Blockbuster Split", note: "Teal and orange", prompt: "Teal-and-orange grade: skin pushed warm and orange, every shadow and background pushed cool teal.", colors: ["#06171b", "#0d3138", "#155660", "#1f7d86", "#4ba3a8", "#d9a066", "#e5873c", "#c25f21", "#8a3c12", "#f6dfc2"] },
  { id: "grade-bleach", name: "The Iron Borough", note: "Bleach bypass, silver retained", prompt: "Bleach bypass: silver retained in the image, harsh contrast, colour drained toward metal grey.", colors: ["#0b0c0d", "#26292c", "#45494d", "#6a6e72", "#8e9296", "#b0b4b7", "#cfd2d4", "#e8eaeb", "#6b5f56", "#8c7a6a"] },
  { id: "grade-kodachrome", name: "Runaway Summer", note: "Kodachrome reds, deep blacks", prompt: "Kodachrome grade: rich saturated reds, deep true blacks, archival mid-century colour.", colors: ["#0d0b0a", "#2c1c14", "#7a3a22", "#c2441f", "#e0722f", "#d9a83f", "#3f6b4a", "#1f4e79", "#c9b48c", "#f2e6cd"] },
  { id: "grade-golden", name: "Amber Wasteland", note: "Honey through everything", prompt: "Golden grade: warm honey light through the whole frame, amber highlights, soft brown shadows.", colors: ["#1a1008", "#3b2410", "#6b431c", "#9c6a2a", "#c9913f", "#e5b463", "#f2d193", "#fbe9c4", "#7d6033", "#4a3418"] },
  { id: "grade-mono", name: "Static Noon", note: "Black and white, full range", prompt: "Black and white: full tonal range from clean white to deep black, colour removed entirely.", colors: ["#000000", "#1c1c1c", "#3a3a3a", "#585858", "#767676", "#949494", "#b2b2b2", "#d0d0d0", "#e9e9e9", "#ffffff"] },
  { id: "grade-high-con-mono", name: "No Mercy", note: "High-contrast black and white", prompt: "High-contrast black and white: blown whites, blacks with no detail at all, brutal graphic separation.", colors: ["#000000", "#000000", "#0a0a0a", "#1a1a1a", "#4a4a4a", "#b8b8b8", "#e4e4e4", "#f6f6f6", "#ffffff", "#ffffff"] },
  { id: "grade-sepia", name: "The Faded Fresco", note: "Aged brown monochrome", prompt: "Sepia: aged brown monochrome, paper-like warmth, the feeling of an old photograph.", colors: ["#140d06", "#2e2013", "#4d3722", "#6e5135", "#8f6f4c", "#af9068", "#cbb08b", "#e2ceb0", "#f2e6d0", "#fbf5e8"] },
  { id: "grade-neon-noir", name: "Neon Rain at Midnight", note: "Magenta against cyan", prompt: "Neon noir grade: saturated magenta and cyan against near-black, wet reflective surfaces carrying the colour.", colors: ["#05030a", "#12082a", "#2b0f52", "#6d1c8a", "#c22bb0", "#ff3dcd", "#0e5f78", "#17a6c4", "#4de6ff", "#f1d7ff"] },
  { id: "grade-pastel", name: "Bubblegum Boulevard", note: "Soft, low saturation", prompt: "Pastel grade: soft desaturated candy hues, lifted blacks, gentle even contrast.", colors: ["#6b5a78", "#8f7d9c", "#b7a4c2", "#d9c3dd", "#f3dbe6", "#f9e9d6", "#dfe8f5", "#c3dbe8", "#e7f0d9", "#fdf7f2"] },
  { id: "grade-steel", name: "The Grey Channel", note: "Cold, industrial, drained", prompt: "Steel grade: cold desaturated blue-grey throughout, industrial and clinical, warmth removed.", colors: ["#0a0e12", "#1a2128", "#2c3740", "#414e58", "#5a6872", "#78868f", "#98a5ad", "#b9c4ca", "#d7dee2", "#eef2f4"] },
  { id: "grade-technicolor", name: "A Dream in Color", note: "Impossible primaries", prompt: "Three-strip Technicolor: impossibly saturated primaries, glowing reds and blues, luminous skin.", colors: ["#0b1030", "#14349e", "#1f74d8", "#0e9a4a", "#7dcc2e", "#ffd23f", "#f28f1c", "#e0281f", "#a3125c", "#fff6cf"] },
  { id: "grade-faded", name: "The Earth Keeps Things", note: "Washed, lifted, magenta-shifted", prompt: "Faded film grade: washed-out colour, milky lifted blacks, a slight magenta shift from age.", colors: ["#3f3b38", "#57514b", "#6f6760", "#8a8078", "#a49890", "#bdb2a8", "#d3cabf", "#e5ded4", "#c7b0b6", "#f0eae2"] },
  { id: "grade-infrared", name: "The Crimson Orchard", note: "White foliage, black sky", prompt: "Infrared: foliage rendered white, skies near-black, skin luminous and waxy, an unreal alternate spectrum.", colors: ["#0a0518", "#1e0d33", "#48145c", "#8a1f6e", "#c73a86", "#ff8fc4", "#ffc0dd", "#ffe3f0", "#fff5fa", "#ffffff"] },
  { id: "grade-duotone", name: "Yellow Room", note: "Two colours and nothing else", prompt: "Duotone: the entire image mapped to two colours only, one for shadow and one for highlight, no other hue present.", colors: ["#0c0924", "#141140", "#231d6b", "#332b9e", "#4b3bd0", "#7a6ae0", "#b8a53a", "#d8c23f", "#ffd447", "#ffeea1"] },
  { id: "grade-moonlit", name: "Bioluminescent Night", note: "Night for night, silver edges", prompt: "Moonlit grade: deep blue night, silver highlights, shadows that keep just enough detail to read.", colors: ["#03060f", "#08111f", "#0e1d36", "#16304f", "#27456b", "#3d6090", "#6c8fbe", "#9db9de", "#c9dbf2", "#eef4fd"] },
  { id: "grade-earth", name: "Two Days to the Horizon", note: "Ochre, clay and olive", prompt: "Earth grade: ochre, clay and olive, sun-bleached and dusty, no cool tones anywhere in the frame.", colors: ["#1d1710", "#3b2e1c", "#5c4726", "#7f6435", "#a38548", "#c2a468", "#d8c18f", "#e9dcb8", "#6b6b3f", "#4d5230"] },
  { id: "grade-gasoline", name: "Gasoline Sunset", note: "Burnt orange over cold blue", prompt: "Gasoline sunset grade: a burning orange sky bleeding into cold blue shadow, high saturation at the horizon and almost none below it.", colors: ["#0a1626", "#12304d", "#1c5273", "#8a4a22", "#c75f1c", "#ef8a20", "#ffb347", "#ffd68a", "#2b1c14", "#fff0cf"] },
  { id: "grade-tropic", name: "Tropic Fever Dream", note: "Saturated green and hot pink", prompt: "Tropic fever grade: saturated jungle greens against hot pink and turquoise, humid and oversaturated, highlights blooming.", colors: ["#04160f", "#0b3b23", "#126b3c", "#2fa05c", "#6fd07f", "#17a2a2", "#3fd6d6", "#ff4f9a", "#ff93c2", "#fdf3d6"] },
  { id: "grade-industrial", name: "Industrial Fog", note: "Green-grey haze, no blacks", prompt: "Industrial fog grade: a flat green-grey haze over everything, no true black anywhere, contrast eaten by atmosphere.", colors: ["#23282a", "#333a39", "#454d4a", "#59615c", "#6e766f", "#858c84", "#9da39a", "#b7bcb2", "#d2d6cc", "#e9ece4"] },
  { id: "grade-overtime", name: "Overtime", note: "Tungsten office amber", prompt: "Tungsten office grade: warm sodium and fluorescent amber pooling over dark green-grey, the colour of a building nobody has left yet.", colors: ["#100d07", "#241d10", "#3d301a", "#5f4a23", "#87692c", "#b08a3b", "#d6ae5c", "#eed394", "#1e2a24", "#2f3c33"] },
  { id: "grade-circus", name: "The Circus", note: "Red and cyan, nothing between", prompt: "Circus grade: hard red and cyan pushed against each other with almost nothing in between, saturated to the edge of breaking.", colors: ["#0a0308", "#2b0410", "#6d0a1e", "#b8122c", "#ef2340", "#ff6b6b", "#0b4a58", "#1487a0", "#3fd0e8", "#fbe9e9"] },
];

const LIGHT: CinemaOption[] = [
  { id: "light-auto", name: "Auto", note: "Let the scene decide", prompt: "" },
  { id: "light-window", name: "Window", note: "One big soft source", prompt: "Lit by a single large window: soft directional daylight falling off across the subject, shadows filled only by the room." },
  { id: "light-golden-hour", name: "Golden hour", note: "Low sun, long shadows", prompt: "Golden hour: low warm sun raking across the scene, long shadows, hair and edges rimmed in amber." },
  { id: "light-blue-hour", name: "Blue hour", note: "After the sun, before dark", prompt: "Blue hour: the sky still glowing deep blue after sunset, practical lights just taking over, no hard shadows." },
  { id: "light-overcast", name: "Overcast", note: "The sky as a softbox", prompt: "Overcast daylight: the whole sky acting as one enormous softbox, shadowless, cool and even." },
  { id: "light-hard-noon", name: "Hard noon", note: "Sun straight down", prompt: "Hard noon sun: light straight overhead, short black shadows under brows and chins, brutal contrast, squinting." },
  { id: "light-neon", name: "Practicals", note: "The signs do the lighting", prompt: "Lit by neon practicals: coloured signs and tubes inside the frame doing all the lighting, hard saturated pools of magenta and cyan." },
  { id: "light-firelight", name: "Firelight", note: "Flickering and warm", prompt: "Firelight: flickering warm light from below and to one side, shadows dancing on surrounding surfaces." },
  { id: "light-candlelight", name: "Candlelight", note: "One tiny source", prompt: "Candlelight: a single tiny warm source, extremely rapid fall-off, everything a step away swallowed by darkness." },
  { id: "light-moonlight", name: "Moonlight", note: "Cool and directional", prompt: "Moonlight: cool blue directional light from high and behind, silver rims, deep blue-black shadows." },
  { id: "light-softbox", name: "Soft cross", note: "Controlled and clean", prompt: "Studio softbox lighting: controlled key with fill and a separating backlight, clean seamless background, no accidental shadows." },
  { id: "light-rembrandt", name: "Rembrandt", note: "Triangle on the cheek", prompt: "Rembrandt lighting: a hard key at 45 degrees leaving a small lit triangle on the shadowed cheek, the rest falling into darkness." },
  { id: "light-silhouette", name: "Contre jour", note: "Subject as shape", prompt: "Backlit silhouette: the subject rendered as a pure black shape against a bright background, no detail on the near side." },
  { id: "light-toplight", name: "Overhead fall", note: "Eyes in shadow", prompt: "Hard top light: light straight down from above, eyes lost in shadow, cheekbones and shoulders lit." },
  { id: "light-underlight", name: "Underlight", note: "Wrong direction, wrong feeling", prompt: "Underlighting: the source below the face throwing shadows upward, instantly unsettling." },
  { id: "light-strobe", name: "Strobe", note: "Stuttering, intermittent", prompt: "Intermittent strobe: the scene stuttering between blown-out light and total darkness, motion frozen in fragments." },
  { id: "light-caustics", name: "Water caustics", note: "Rippling light", prompt: "Water caustics: rippling refracted light moving across the subject and walls, as if lit through a pool." },
  { id: "light-bulb", name: "Single bulb", note: "One bare source", prompt: "A single bare bulb: hard warm light, a visible source in frame, heavy fall-off into the corners of the room." },
  { id: "light-headlights", name: "Headlights", note: "Two hard beams", prompt: "Car headlights: two hard beams cutting through dust or rain, the subject caught in them, everything behind in blackness." },
  { id: "light-screen", name: "Screen glow", note: "Lit by a display", prompt: "Lit only by a screen: cool flickering light from below the face, colour shifting with what is displayed, the room dark behind." },
];

// ---------------------------------------------------------------------------
// Style — the strongest line in the whole spec.
//
// Everything else here adjusts a photograph. A style replaces the medium: once
// the world is made of cut paper, the "35mm film" and the "fisheye lens" do not
// stop applying, they are simply expressed in paper. That is why cinemaContext
// prints this first and tells the model the style wins any argument.
//
// The `note` names the look the owner will recognise. The `prompt` never does:
// it describes the technique, because a model renders "flat cut-paper standees
// that turn edge-on and vanish to a line" far more reliably than a title it may
// never have been trained on, and the technique is what actually carries the
// look.
// ---------------------------------------------------------------------------

const STYLE_OPTIONS: CinemaOption[] = [
  { id: "style-auto", name: "Auto", note: "Live action, no stylisation", prompt: "", family: "None" },

  // Animation
  { id: "style-cel-anime", name: "Cel anime", note: "Hand-inked 2D animation", family: "Animation", prompt: "Traditional cel animation: every form bounded by a clean ink line of even weight, colour filled flat in two or three tones with hard-edged shadow shapes, no gradients on characters, painted background art behind them, motion on twos." },
  { id: "style-anime-film", name: "Anime film", note: "Painted backgrounds, cinematic", family: "Animation", prompt: "Feature anime: lavishly painted backgrounds with real atmospheric depth, characters drawn in a restrained line and flat-shaded against them, god rays and lens flare painted in by hand, wind moving grass and cloth." },
  { id: "style-saturday-cartoon", name: "Saturday cartoon", note: "Rubber-hose, bold outlines", family: "Animation", prompt: "Broad television cartoon: thick uniform outlines, rubber-hose limbs that bend without joints, squash and stretch on every movement, flat saturated fills, simple shapes readable at a glance." },
  { id: "style-cgi-family", name: "CGI family film", note: "Big-studio 3D animation", family: "Animation", prompt: "Modern CGI animated feature: appealing rounded character design with oversized eyes, soft subsurface skin, physically lit environments with bounce light, shallow depth of field, everything slightly idealised and clean." },
  { id: "style-cutout-satire", name: "Cutout satire", note: "Construction-paper comedy", family: "Animation", prompt: "Construction-paper cutout animation: characters built from flat coloured paper shapes with visible torn edges, moving in stiff hinged segments against a paper backdrop, deliberately crude and deadpan." },
  { id: "style-rotoscope", name: "Rotoscope", note: "Traced over live action", family: "Animation", prompt: "Rotoscoped animation: real human movement traced frame by frame, so the motion is uncannily lifelike while the drawing shifts and boils, outlines wavering, colour areas swimming slightly between frames." },
  { id: "style-motion-comic", name: "Motion comic", note: "Panels that move", family: "Animation", prompt: "Motion comic: flat comic-book artwork with the layers separated and parallaxing against each other, figures held still and moved as cutouts, panel borders and speed lines built into the frame." },

  // Game
  { id: "style-papercraft", name: "Papercraft world", note: "Flat paper heroes in a 3D world", family: "Game", prompt: "A fully three-dimensional world built entirely from cut paper and card: characters are flat 2D standees that turn edge-on and vanish to a thin line when they rotate, scenery is layered cardstock with visible fold creases and drop shadows, colours flat and unshaded, everything one millimetre thick." },
  { id: "style-kart-racer", name: "Kart racer", note: "Bright arcade kart game", family: "Game", prompt: "Bright arcade kart-racing game: chunky rounded low-detail 3D models in primary colours, wide cartoon proportions, a candy-coloured track with oversized decorative props, flat cheerful lighting with no real shadows, speed shown by streaking lines and a tilted horizon." },
  { id: "style-pixel-16bit", name: "16-bit pixel", note: "Sprite-era video game", family: "Game", prompt: "16-bit pixel art: everything resolved to large visible square pixels on a coarse grid, a strictly limited palette with dithered gradients, sprite characters animated in a handful of frames, parallax scrolling background layers." },
  { id: "style-low-poly-ps1", name: "Low-poly", note: "Early-3D console look", family: "Game", prompt: "Early polygonal 3D: models built from very few large flat triangles with visible faceting, low-resolution textures that warp and swim across surfaces, hard vertex lighting, no smooth shading anywhere, slight geometry jitter." },
  { id: "style-voxel", name: "Voxel", note: "Everything built from cubes", family: "Game", prompt: "Voxel world: every object in the scene built from identical cubes on a rigid grid, including characters, plants and clouds, flat per-face shading, hard stepped edges, no curves anywhere." },
  { id: "style-aaa-cinematic", name: "AAA game cinematic", note: "Big-budget engine render", family: "Game", prompt: "Big-budget real-time game cinematic: physically based materials, volumetric light shafts through atmosphere, detailed weathered surfaces, motion blur on fast movement, a look that is nearly photoreal but a shade too clean and too contrasty." },
  { id: "style-isometric-sim", name: "Isometric sim", note: "Tilted, tiny, orderly", family: "Game", prompt: "Isometric simulation game: a fixed tilted three-quarter view with no perspective convergence, small neat figures in a tile-built world, clean readable shapes, cheerful even lighting, everything visible at once." },
  { id: "style-fighting-game", name: "Fighting game", note: "Pose, impact, hit spark", family: "Game", prompt: "Arcade fighting game: characters in exaggerated committed poses against a flat side-on plane, heavy impact frames with radiating hit sparks and screen shake, hard rim lighting, an audience and signage crowding the background." },

  // Craft and stop-motion
  { id: "style-claymation", name: "Claymation", note: "Modelled in plasticine", family: "Craft", prompt: "Stop-motion clay animation: every surface modelled plasticine with visible thumbprints and tool marks, slightly lumpy asymmetric forms, characters with big simple features, stepped frame-by-frame movement, real studio lighting with soft shadows." },
  { id: "style-puppet-satire", name: "Puppet satire", note: "Action-figure comedy", family: "Craft", prompt: "Stop-motion with poseable toy figures: plastic bodies with visible joint seams and moulded hair, slightly wrong proportions, held on tiny sets built from everyday objects at the wrong scale, hard practical lighting, deadpan staging." },
  { id: "style-felt-stopmo", name: "Felt and fabric", note: "Sewn, soft, handmade", family: "Craft", prompt: "Stop-motion built from felt and fabric: characters sewn with visible stitching and fraying edges, fur and fibre catching the light, a set made of textile and yarn, warm soft lighting, gentle stepped motion." },
  { id: "style-brick-built", name: "Brick-built", note: "Made of toy bricks", family: "Craft", prompt: "Everything constructed from interlocking plastic toy bricks: glossy moulded surfaces with visible studs and seams, blocky stepped approximations of organic shapes, simple cylindrical hands and printed faces, stop-motion timing." },
  { id: "style-diorama", name: "Miniature diorama", note: "A tiny built world", family: "Craft", prompt: "A handmade miniature diorama shot macro: model-railway scale scenery, static grass and flock texture, tiny painted figures, an extremely shallow focus plane that gives away the true size, warm practical lighting." },
  { id: "style-marionette", name: "Marionette", note: "Strings and carved wood", family: "Craft", prompt: "Carved wooden marionettes on visible strings: jointed limbs swinging with real pendulum weight, painted wooden faces with fixed expressions, a small proscenium stage with painted flats and footlights." },

  // Illustration and comics
  { id: "style-comic-inks", name: "Comic book inks", note: "Brush, blacks, benday", family: "Illustration", prompt: "Comic book art: brush-inked linework with dramatic weight variation, heavy spotted blacks shaping the form, benday dot colour in a limited print palette, foreshortened heroic poses, hard graphic shadows." },
  { id: "style-manga", name: "Manga", note: "Screentone and speed lines", family: "Illustration", prompt: "Black and white manga: fine consistent linework, grey achieved entirely with adhesive screentone dots and hatching, radiating speed lines for movement and focus lines for emphasis, high-contrast dramatic angles." },
  { id: "style-watercolour", name: "Watercolour", note: "Wet edges and bleed", family: "Illustration", prompt: "Watercolour painting: transparent washes bleeding into each other with hard dried edges at the boundaries, white paper showing through the highlights, visible cold-press paper tooth, colour pooling where the brush lifted." },
  { id: "style-storybook", name: "Storybook", note: "Gentle picture-book art", family: "Illustration", prompt: "Children's picture-book illustration: soft pencil and gouache texture, warm friendly shapes, generous white space, a gentle limited palette, characters drawn with kindness and no hard edges." },
  { id: "style-oil-painting", name: "Oil painting", note: "Loaded brush, thick paint", family: "Illustration", prompt: "Oil painting: thick impasto strokes holding the mark of the brush, colour mixed on the canvas rather than the palette, warm underpainting glowing through thin passages, a deep varnished darkness in the shadows." },
  { id: "style-woodcut", name: "Woodcut", note: "Carved, printed, stark", family: "Illustration", prompt: "Woodcut print: form built only from carved parallel gouge marks, pure black ink on cream paper with no greys, bold simplified shapes, slight ink squash at the edges where the block pressed." },
  { id: "style-pencil-sketch", name: "Pencil sketch", note: "Graphite, unfinished", family: "Illustration", prompt: "Graphite sketch: confident searching lines with the construction still showing, hatched tone built up in layers, smudged shading, paper texture throughout, deliberately unfinished at the edges of the frame." },
  { id: "style-collage", name: "Cut-paper collage", note: "Torn magazine assembly", family: "Illustration", prompt: "Cut and torn paper collage: elements clipped from different printed sources at mismatched scales and halftone resolutions, hard scissor edges and torn fibrous ones, hand-placed with visible overlaps and shadows." },

  // Film movements
  { id: "style-folk-horror", name: "Folk horror", note: "Rural dread, 1970s", family: "Film movement", prompt: "1970s rural folk horror: grainy warm-brown film stock, open countryside that feels watchful rather than pretty, handmade masks and woven objects treated as ordinary, daylight that gives no comfort, no score." },
  { id: "style-giallo", name: "Giallo", note: "Lurid Italian thriller", family: "Film movement", prompt: "Italian giallo thriller: unmotivated saturated red, blue and green gels flooding whole rooms, extreme close-ups of eyes and gloved hands, baroque architecture, a camera that prowls with no clear point of view." },
  { id: "style-mockumentary", name: "Mockumentary", note: "The camera is in the room", family: "Film movement", prompt: "Mockumentary: a camera operator visibly present in the scene, reframing and refocusing a beat late, subjects glancing at the lens, available fluorescent or window light, a talking-head setup against an ordinary wall." },
  { id: "style-found-footage", name: "Found footage", note: "Whoever filmed it was there", family: "Film movement", prompt: "Found footage: a consumer camera held by a character inside the scene, lurching with their steps, a harsh on-camera light punching a cone into darkness, autofocus hunting, the frame dropping and swinging when they run." },
  { id: "style-silent-slapstick", name: "Silent slapstick", note: "Undercranked and fearless", family: "Film movement", prompt: "Silent-era slapstick: high-contrast black and white, undercranked so movement runs slightly too fast, physical comedy played wide and full-figure with nothing cut away, iris vignette at the edges, title cards between beats." },
  { id: "style-wuxia", name: "Wuxia", note: "Weightless, silk, bamboo", family: "Film movement", prompt: "Wuxia: fighters moving with no weight at all, drifting and alighting on branches and rooftops, silk robes and long sleeves trailing the motion, bamboo and mist, colour organised into one dominant hue per sequence." },

  // Graphic and abstract
  { id: "style-vaporwave", name: "Vaporwave", note: "Grid, sunset, statuary", family: "Graphic", prompt: "Vaporwave: a magenta-to-cyan gradient sky over an infinite glowing wireframe grid, chrome and marble objects floating with no explanation, VHS tracking artefacts, an oversized low sun with scanlines across it." },
  { id: "style-blueprint", name: "Blueprint", note: "Drawn, not photographed", family: "Graphic", prompt: "Technical blueprint: white line drawing on deep cyan, everything reduced to construction lines, section cuts and dimension arrows, hatched fills, annotation leaders pointing at parts, no shading of any kind." },
  { id: "style-xray", name: "X-ray", note: "Seen through", family: "Graphic", prompt: "X-ray imaging: everything semi-transparent and rendered in luminous blue-white on black, internal structure visible through outer surfaces, density read as brightness, edges glowing where material overlaps." },
  { id: "style-silhouette", name: "Silhouette theatre", note: "Shadow puppets", family: "Graphic", prompt: "Shadow-puppet theatre: pure black articulated cutout figures against a warmly lit translucent screen, all character carried by profile and gesture alone, visible rods, the screen texture showing through." },
  { id: "style-neon-outline", name: "Neon outline", note: "Drawn in glowing tube", family: "Graphic", prompt: "Neon tube illustration: every form drawn as a single continuous glowing tube of coloured light against black, the glow blooming into the surrounding darkness and reflecting faintly off a wet surface below." },
];

export const CINEMA_GROUPS: CinemaGroup[] = [
  {
    id: "film",
    label: "Film setup",
    hint: "The world the footage belongs to.",
    rails: [
      { id: "genre", label: "Genre", options: GENRE },
      { id: "era", label: "Era", options: ERA },
      { id: "tempo", label: "Tempo", options: TEMPO },
    ],
  },
  {
    id: "camera",
    label: "Camera",
    hint: "What it was shot on, and through what.",
    rails: [
      { id: "body", label: "Camera", options: BODY },
      { id: "lens", label: "Lens", options: LENS },
      { id: "aperture", label: "Aperture", options: APERTURE },
    ],
  },
  {
    id: "style",
    label: "Style",
    hint: "What the thing is made of. This outranks everything else here.",
    rails: [{ id: "style", label: "Style", options: STYLE_OPTIONS }],
  },
  {
    id: "color",
    label: "Color palette",
    hint: "How the image is graded.",
    rails: [{ id: "grade", label: "Palette", options: GRADE }],
  },
  {
    id: "lighting",
    label: "Lighting",
    hint: "Where the light comes from.",
    rails: [{ id: "light", label: "Light", options: LIGHT }],
  },
];

// ---------------------------------------------------------------------------
// Movement — the one rail that lives in the prompt box, because order is the
// shot: "#crane-up #rack-focus" is a different film from "#rack-focus #crane-up".
//
// `glyph` picks the diagram drawn on the tile (see CinemaTile); `family` is how
// the picker groups them when sorting by kind.
// ---------------------------------------------------------------------------

export type MoveGlyph =
  | "push"
  | "pull"
  | "pan-l"
  | "pan-r"
  | "tilt-u"
  | "tilt-d"
  | "truck-l"
  | "truck-r"
  | "boom-u"
  | "boom-d"
  | "arc-l"
  | "arc-r"
  | "orbit"
  | "focus"
  | "hold"
  | "shake"
  | "top"
  | "pov"
  | "roll"
  | "snap";

export type MoveFamily = "Push & pull" | "Pan & tilt" | "Track & slide" | "Crane & air" | "Focus & optics" | "Rig & POV" | "Hold";

export interface CinemaMove {
  id: string;
  name: string;
  note: string;
  prompt: string;
  glyph: MoveGlyph;
  family: MoveFamily;
}

export const MOVES: CinemaMove[] = [
  // Push & pull
  { id: "dolly-in", name: "Dolly in", note: "The camera walks toward them", prompt: "the camera dollies steadily in toward the subject, the background growing behind them", glyph: "push", family: "Push & pull" },
  { id: "dolly-out", name: "Dolly out", note: "Pulling away, revealing", prompt: "the camera dollies back away from the subject, the surrounding space opening up around them", glyph: "pull", family: "Push & pull" },
  { id: "slow-zoom-in", name: "Slow zoom in", note: "Creeping closer, no movement", prompt: "a very slow zoom in, the frame tightening on the subject without the camera itself moving", glyph: "push", family: "Push & pull" },
  { id: "slow-zoom-out", name: "Slow zoom out", note: "Creeping wider", prompt: "a very slow zoom out, gradually revealing how much space surrounds the subject", glyph: "pull", family: "Push & pull" },
  { id: "crash-zoom", name: "Crash zoom", note: "Snap to close-up", prompt: "a sudden crash zoom, snapping instantly from wide to close on the subject", glyph: "snap", family: "Push & pull" },
  { id: "crush-zoom", name: "Crush zoom", note: "All the way into the eye", prompt: "a relentless zoom crushing all the way into an extreme close-up, past the face and into the eye", glyph: "snap", family: "Push & pull" },
  { id: "dolly-zoom", name: "Dolly zoom", note: "The room stretches", prompt: "a dolly zoom: the camera pushes in while the lens zooms out, the subject held the same size while the background warps and stretches behind them", glyph: "push", family: "Push & pull" },
  { id: "aerial-pullback", name: "Aerial pullback", note: "Up and away", prompt: "the camera pulls back and rises away from the subject, the scene shrinking below into its wider landscape", glyph: "pull", family: "Crane & air" },
  { id: "reveal-pullback", name: "Reveal pullback", note: "Was it that all along", prompt: "the camera pulls back to reveal something about the scene that the tighter framing had concealed", glyph: "pull", family: "Push & pull" },

  // Pan & tilt
  { id: "pan-left", name: "Pan left", note: "Pivot to the left", prompt: "the camera pans smoothly left from a fixed position, sweeping the scene past the frame", glyph: "pan-l", family: "Pan & tilt" },
  { id: "pan-right", name: "Pan right", note: "Pivot to the right", prompt: "the camera pans smoothly right from a fixed position, sweeping the scene past the frame", glyph: "pan-r", family: "Pan & tilt" },
  { id: "whip-pan", name: "Whip pan", note: "Blur across", prompt: "a whip pan: the camera snaps sideways so fast the frame blurs into streaks before resolving", glyph: "pan-r", family: "Pan & tilt" },
  { id: "tilt-up", name: "Tilt up", note: "Look up the height", prompt: "the camera tilts up from low, climbing the subject's height to finish on their face or the space above them", glyph: "tilt-u", family: "Pan & tilt" },
  { id: "tilt-down", name: "Tilt down", note: "Look down", prompt: "the camera tilts down from above, descending to settle on the subject", glyph: "tilt-d", family: "Pan & tilt" },
  { id: "dutch-angle", name: "Dutch angle", note: "The horizon goes wrong", prompt: "the camera rolls into a dutch angle, the horizon tipping off level and holding there", glyph: "roll", family: "Pan & tilt" },

  // Track & slide
  { id: "tracking", name: "Tracking", note: "Moving with them", prompt: "the camera tracks with the subject as they move, holding them at a constant distance", glyph: "truck-r", family: "Track & slide" },
  { id: "side-tracking", name: "Side tracking", note: "Alongside, in profile", prompt: "the camera tracks alongside the subject in profile, matching their pace exactly while the background streaks past", glyph: "truck-r", family: "Track & slide" },
  { id: "follow-behind", name: "Follow behind", note: "Over the shoulder", prompt: "the camera follows close behind the subject, just over their shoulder, moving where they move", glyph: "push", family: "Track & slide" },
  { id: "truck-left", name: "Truck left", note: "Whole camera slides left", prompt: "the entire camera trucks left through the space, parallax shifting the foreground against the background", glyph: "truck-l", family: "Track & slide" },
  { id: "truck-right", name: "Truck right", note: "Whole camera slides right", prompt: "the entire camera trucks right through the space, parallax shifting the foreground against the background", glyph: "truck-r", family: "Track & slide" },
  { id: "slider-left", name: "Slider left", note: "Short, precise glide", prompt: "a short precise slider move to the left, a deliberate few feet of glide", glyph: "truck-l", family: "Track & slide" },
  { id: "slider-right", name: "Slider right", note: "Short, precise glide", prompt: "a short precise slider move to the right, a deliberate few feet of glide", glyph: "truck-r", family: "Track & slide" },
  { id: "arc-left", name: "Arc left", note: "Curving around them", prompt: "the camera arcs left around the subject, curving through the space while staying locked on them", glyph: "arc-l", family: "Track & slide" },
  { id: "arc-right", name: "Arc right", note: "Curving around them", prompt: "the camera arcs right around the subject, curving through the space while staying locked on them", glyph: "arc-r", family: "Track & slide" },
  { id: "orbit-360", name: "360 orbit", note: "All the way round", prompt: "the camera orbits a full circle around the subject, the entire background rotating past behind them", glyph: "orbit", family: "Track & slide" },

  // Crane & air
  { id: "crane-up", name: "Crane up", note: "Rising off the ground", prompt: "the camera cranes upward, rising off the ground and away, the subject shrinking below", glyph: "boom-u", family: "Crane & air" },
  { id: "crane-down", name: "Crane down", note: "Descending to them", prompt: "the camera cranes down from height, descending to settle at the subject's level", glyph: "boom-d", family: "Crane & air" },
  { id: "pedestal-up", name: "Pedestal up", note: "Straight up, level held", prompt: "the camera pedestals straight up, rising vertically with the lens held level", glyph: "boom-u", family: "Crane & air" },
  { id: "pedestal-down", name: "Pedestal down", note: "Straight down, level held", prompt: "the camera pedestals straight down, lowering vertically with the lens held level", glyph: "boom-d", family: "Crane & air" },
  { id: "drone-orbit", name: "Drone orbit", note: "Circling from the air", prompt: "a drone orbits the subject from above, circling wide and high while holding them centred", glyph: "orbit", family: "Crane & air" },
  { id: "overhead-topdown", name: "Overhead", note: "Straight down from above", prompt: "a straight-down overhead shot looking directly at the scene from above, everything read as a flat plan", glyph: "top", family: "Crane & air" },
  { id: "ground-level", name: "Ground level", note: "Lens on the floor", prompt: "the camera sits on the ground looking up, the floor filling the bottom of the frame and the subject towering", glyph: "tilt-u", family: "Crane & air" },

  // Focus & optics
  { id: "rack-focus", name: "Rack focus", note: "Attention moves, camera doesn't", prompt: "a rack focus: the focus pulls from the foreground to the background (or back), moving the viewer's attention without moving the camera", glyph: "focus", family: "Focus & optics" },
  { id: "focus-in", name: "Pull into focus", note: "Blur resolves", prompt: "the shot opens completely out of focus and resolves into sharpness on the subject", glyph: "focus", family: "Focus & optics" },
  { id: "bullet-time", name: "Bullet time", note: "Time stops, camera doesn't", prompt: "bullet time: the action freezes almost completely while the camera continues to travel around the subject", glyph: "orbit", family: "Focus & optics" },

  // Rig & POV
  { id: "handheld", name: "Handheld", note: "Human, unsteady", prompt: "handheld camera: a live human operator, small constant corrections, breathing in the frame, reacting rather than anticipating", glyph: "shake", family: "Rig & POV" },
  { id: "shoulder-rig", name: "Shoulder rig", note: "Steadier than handheld", prompt: "shoulder-mounted camera: weighted, steadier than handheld but still alive, moving with the operator's steps", glyph: "shake", family: "Rig & POV" },
  { id: "pov", name: "POV", note: "Through their eyes", prompt: "first-person point of view: the camera is the subject's eyes, hands entering frame from below, head movement driving the shot", glyph: "pov", family: "Rig & POV" },
  { id: "snorricam", name: "Snorricam", note: "Rigged to the body", prompt: "snorricam: the camera rigged rigidly to the subject's body so they stay perfectly fixed in frame while the entire world lurches around them", glyph: "pov", family: "Rig & POV" },
  { id: "robot-arm", name: "Robot arm", note: "Impossibly precise", prompt: "a motion-control robot arm: an impossibly precise and fast programmed move, repeating exactly, faster than a human could operate", glyph: "arc-r", family: "Rig & POV" },

  // Hold
  { id: "static", name: "Static shot", note: "Locked off", prompt: "a completely locked-off static shot: the camera does not move at all, the subject moving within a fixed frame", glyph: "hold", family: "Hold" },
];

const MOVE_BY_ID = new Map(MOVES.map((m) => [m.id, m]));

export const MOVE_FAMILIES: MoveFamily[] = [
  "Push & pull",
  "Pan & tilt",
  "Track & slide",
  "Crane & air",
  "Focus & optics",
  "Rig & POV",
  "Hold",
];

// ---------------------------------------------------------------------------
// The selection: one option per rail, plus the ordered moves from the text.
// ---------------------------------------------------------------------------

/** rail id ("genre", "body", "grade"…) → option id. */
export type CinemaSelection = Record<string, string>;

export const EMPTY_SELECTION: CinemaSelection = {};

const RAILS: CinemaRail[] = CINEMA_GROUPS.flatMap((g) => g.rails);
const OPTION_BY_ID = new Map(RAILS.flatMap((r) => r.options.map((o) => [o.id, { rail: r, option: o }] as const)));

export function railById(id: string): CinemaRail | undefined {
  return RAILS.find((r) => r.id === id);
}

export function optionById(id: string): CinemaOption | undefined {
  return OPTION_BY_ID.get(id)?.option;
}

export function moveById(id: string): CinemaMove | undefined {
  return MOVE_BY_ID.get(id);
}

/** Does this rail's current value actually say anything? ("Auto" does not.) */
export function isSet(selection: CinemaSelection, railId: string): boolean {
  const id = selection[railId];
  return Boolean(id && optionById(id)?.prompt);
}

/** What a group's chip reads: "Horror, 1990s" — or nothing when untouched. */
export function groupSummary(group: CinemaGroup, selection: CinemaSelection): string {
  return group.rails
    .filter((r) => isSet(selection, r.id))
    .map((r) => optionById(selection[r.id])!.name)
    .join(", ");
}

/** How many rails across the whole deck are saying something. */
export function selectionCount(selection: CinemaSelection): number {
  return RAILS.filter((r) => isSet(selection, r.id)).length;
}

/** Drop unknown rails and unknown options — the client is never trusted. */
export function cleanSelection(raw: unknown): CinemaSelection {
  const o = (raw ?? {}) as Record<string, unknown>;
  const out: CinemaSelection = {};
  for (const rail of RAILS) {
    const v = o[rail.id];
    if (typeof v !== "string") continue;
    const hit = OPTION_BY_ID.get(v);
    if (hit && hit.rail.id === rail.id) out[rail.id] = v;
  }
  return out;
}

export function cleanMoves(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((x): x is string => typeof x === "string"))]
    .filter((id) => MOVE_BY_ID.has(id))
    .slice(0, 8);
}

// ---------------------------------------------------------------------------
// "#dolly-in" in the prompt box.
// ---------------------------------------------------------------------------

export const MOVE_PATTERN = /(^|[\s(])#([a-z0-9-]+)/gi;

/** The known moves named in a message, in the order they were written. */
export function movesIn(text: string): CinemaMove[] {
  const out: CinemaMove[] = [];
  for (const m of text.matchAll(MOVE_PATTERN)) {
    const hit = MOVE_BY_ID.get(m[2].toLowerCase());
    if (hit && !out.some((o) => o.id === hit.id)) out.push(hit);
  }
  return out;
}

/** The half-typed "#cra" right before the caret, if any. */
export function moveQueryAt(text: string, caret: number): { start: number; query: string } | null {
  const m = /(^|[\s(])#([a-z0-9-]*)$/i.exec(text.slice(0, caret));
  if (!m) return null;
  return { start: caret - m[2].length - 1, query: m[2].toLowerCase() };
}

/** Menu matches: name prefixes first, then the note and family. */
export function searchMoves(query: string, limit = MOVES.length): CinemaMove[] {
  const q = query.toLowerCase().replace(/-/g, " ").trim();
  if (!q) return MOVES.slice(0, limit);
  const scored = MOVES.map((m) => {
    const name = m.name.toLowerCase();
    const hay = `${name} ${m.id.replace(/-/g, " ")} ${m.note} ${m.family}`.toLowerCase();
    const score = name.startsWith(q) ? 0 : name.includes(q) ? 1 : hay.includes(q) ? 2 : 9;
    return { m, score };
  }).filter((s) => s.score < 9);
  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, limit).map((s) => s.m);
}

/** Add a move to the end of the prompt text, the way the picker does. */
export function withMove(text: string, id: string): string {
  if (movesIn(text).some((m) => m.id === id)) return text;
  const body = text.replace(/\s+$/, "");
  return `${body}${body ? " " : ""}#${id} `;
}

/** Take a move back out of the prompt text. */
export function withoutMove(text: string, id: string): string {
  return text.replace(new RegExp(`(^|[\\s(])#${id}\\b\\s?`, "gi"), "$1").replace(/\s{2,}/g, " ").trimStart();
}

// ---------------------------------------------------------------------------
// What the model receives.
// ---------------------------------------------------------------------------

/**
 * The shot spec: the owner's camera-department decisions, as binding direction.
 *
 * It is deliberately written as instructions ABOUT writing prompts rather than
 * as a prompt fragment to paste, because a video model reads prose, not labels —
 * "#crane-up" means nothing to it, "the camera cranes upward, rising off the
 * ground and away" means everything.
 */
export function cinemaContext(
  selection: CinemaSelection,
  moves: CinemaMove[],
  output: CinemaOutput = {},
): string {
  const rails = CINEMA_GROUPS.flatMap((g) =>
    g.rails
      .filter((r) => isSet(selection, r.id))
      .map((r) => ({ group: g, rail: r, option: optionById(selection[r.id])! })),
  );
  const style = rails.find((r) => r.rail.id === "style");
  const rest = rails.filter((r) => r.rail.id !== "style");
  const delivery = outputBlock(output);
  if (!rails.length && !moves.length && !delivery.length) return "";

  const lines = [
    "SHOT SPEC — the owner set these in the Studio camera panel. They are binding.",
    "",
    "Rules for every prompt you write with studio_generate:",
    "- Render the spec as natural cinematographic prose inside the prompt. Never paste the labels",
    "  or the #tokens themselves; a video model reads description, not settings.",
    "- Order inside each prompt: the style first, then the shot's subject and action, then the",
    "  camera move(s), then the film look, lens and aperture, then the lighting, then the grade.",
    "  One flowing paragraph.",
    "- What is not listed here is your call — choose it to serve what IS listed, and keep it",
    "  consistent across every shot in the set.",
    "- If the owner's idea directly contradicts a line below, follow the owner's idea and say in your",
    "  message text which spec line you had to set aside and why.",
  ];

  if (style) {
    lines.push(
      "",
      `THE STYLE — ${style.option.name}. This is the strongest instruction in the spec:`,
      style.option.prompt,
      "",
      "The style decides what the world is MADE OF, so it outranks every other line here and it is",
      "the first thing in every prompt you write. When another setting seems to fight it, it almost",
      "never actually does — translate that setting into the style instead of dropping either one:",
      "a fisheye lens in a cut-paper world is a cut-paper fisheye; a 1970s era in a kart racer is a",
      "kart racer with 1970s cars and colours; golden-hour light in an anime is painted golden-hour.",
      "Only when a setting is genuinely impossible inside the style (film grain on a blueprint) do",
      "you drop it, and then you say which one and why in your message text, in one line. Never",
      "quietly render a photograph because the combination looked awkward.",
    );
  }

  if (rest.length) {
    lines.push("", style ? "The rest, expressed in that style:" : "The look:");
    for (const { group, rail, option } of rest) {
      lines.push(`- ${group.label} · ${rail.label} — ${option.name}: ${option.prompt}`);
    }
  }

  if (moves.length) {
    lines.push(
      "",
      moves.length === 1
        ? "The camera move:"
        : `The camera moves, in this order — order is the shot, so beat ${moves.length > 1 ? "1 happens before beat 2" : "1"}:`,
    );
    moves.forEach((m, i) => {
      lines.push(`${moves.length > 1 ? `${i + 1}. ` : "- "}${m.name}: ${m.prompt}.`);
    });
    if (moves.length > 1) {
      lines.push(
        "Blend them into one continuous camera behaviour within a shot where that is physically possible;",
        "where it is not, give each move its own shot, in this order.",
      );
    }
  }

  lines.push(...delivery);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Output — not a look, a delivery spec. These are not prose for the model to
// render; they are the exact arguments studio_generate must be called with, so
// they travel as their own block and say so.
// ---------------------------------------------------------------------------

export interface OutputChoice {
  id: string;
  label: string;
  note?: string;
}

/** Video renders only in the first three; images may use any of them. */
export const ASPECTS: OutputChoice[] = [
  { id: "16:9", label: "16:9", note: "Landscape" },
  { id: "9:16", label: "9:16", note: "Vertical" },
  { id: "1:1", label: "1:1", note: "Square" },
  { id: "4:5", label: "4:5", note: "Portrait \u00b7 images only" },
  { id: "21:9", label: "21:9", note: "Scope \u00b7 images only" },
];

export const VIDEO_ASPECTS = ["16:9", "9:16", "1:1"];

/**
 * How long the finished piece runs.
 *
 * One render is one clip of at most 15 seconds — that is a hard limit of both
 * engines, not a preference. So anything longer is a SEQUENCE: the model plans
 * several clips that cut together and add up to the target. The picker says so
 * rather than pretending a five-minute button produces a five-minute file.
 */
export const MAX_CLIP_SEC = 15;

export function prettyDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const r = sec % 60;
  return r ? `${m}:${String(r).padStart(2, "0")}` : `${m}:00`;
}

/** Roughly how many clips a target implies, at a readable shot length. */
export function clipsFor(sec: number): number {
  return sec <= MAX_CLIP_SEC ? 1 : Math.ceil(sec / 10);
}

export const DURATIONS: OutputChoice[] = [4, 5, 6, 8, 10, 12, 15, 20, 30, 45, 60, 90, 120, 180, 300].map((n) => ({
  id: String(n),
  label: prettyDuration(n),
  note: n <= MAX_CLIP_SEC ? "One clip" : `${clipsFor(n)} clips, cut together`,
}));

export interface CinemaOutput {
  aspect?: string;
  /** Seconds per clip. */
  duration?: number;
}

export function cleanOutput(raw: unknown): CinemaOutput {
  const o = (raw ?? {}) as Record<string, unknown>;
  const out: CinemaOutput = {};
  if (typeof o.aspect === "string" && ASPECTS.some((a) => a.id === o.aspect)) out.aspect = o.aspect;
  const d = Number(o.duration);
  if (Number.isFinite(d) && d >= 4 && d <= 300) out.duration = Math.round(d);
  return out;
}

export function outputSummary(output: CinemaOutput): string {
  return [output.aspect, output.duration ? prettyDuration(output.duration) : ""].filter(Boolean).join(" \u00b7 ");
}

function outputBlock(output: CinemaOutput): string[] {
  const lines: string[] = [];
  if (output.aspect) {
    lines.push(
      `- aspect_ratio: "${output.aspect}"` +
        (VIDEO_ASPECTS.includes(output.aspect)
          ? ""
          : " \u2014 images only; for video use the nearest of 16:9, 9:16 or 1:1 and say which you used."),
    );
  }
  if (output.duration) {
    if (output.duration <= MAX_CLIP_SEC) {
      lines.push(`- duration_sec: ${output.duration} (video only), one clip.`);
    } else {
      lines.push(
        `- The finished piece runs ${prettyDuration(output.duration)} (${output.duration} seconds). One render is one`,
        `  clip of at most ${MAX_CLIP_SEC} seconds, so plan a SEQUENCE: around ${clipsFor(output.duration)} clips whose`,
        "  duration_sec values add up to the target, each one its own job, written so they cut together — the same",
        "  subject description word for word, continuous light and grade, and each shot picking up where the last",
        "  one left off. Say the clip count and the total queue time before rendering.",
      );
    }
  }
  if (!lines.length) return [];
  return ["", "Output settings the owner chose. Pass these to studio_generate exactly:", ...lines];
}
