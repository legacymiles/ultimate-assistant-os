// ---------------------------------------------------------------------------
// Image Studio — the agent registry.
//
// An agent is a specialist in one look. Adding an agent = adding one object to
// AGENTS; the picker, the gallery filter, both routes and the placeholder all
// read from here. Nothing else needs to change.
//
//   brief       what the rewrite model knows about this style. It is the
//               system prompt that turns "me wrestling a bear" into a detailed
//               image prompt. Hard rules for the style live here too.
//   styleBlock  a short hand-written style suffix used when there is no
//               rewrite (offline, or the user generates from the raw prompt).
//   model       the image model for this agent. Every agent starts on the same
//               one; swap a single agent by changing this string.
// ---------------------------------------------------------------------------

export type Aspect = "portrait" | "square" | "landscape";

export interface ImageAgent {
  id: string;
  name: string;
  icon: string;
  pitch: string;
  examples: string[];
  brief: string;
  styleBlock: string;
  model: string;
  aspect: Aspect;
  /** Two hues 0-360 for the card gradient and placeholder art. */
  hue: [number, number];
}

export const DEFAULT_IMAGE_MODEL = "google/gemini-3.1-flash-image";

/** The model that rewrites prompts. Cheaper than the hub default and plenty for this. */
export const REWRITE_MODEL = "anthropic/claude-sonnet-5";

export const AGENTS: ImageAgent[] = [
  {
    id: "nostalgia",
    name: "Nostalgia",
    icon: "📼",
    pitch: "Photos that look pulled from an old shoebox — any decade you want.",
    examples: [
      "Me and my brother at a 1985 summer carnival",
      "My dog as a 1970s family Polaroid",
      "A 90s disposable-camera shot of us at prom",
    ],
    brief:
      "You are a photo archivist and film-stock expert who recreates authentic vintage photographs. " +
      "Choose ONE specific era and capture medium that fits the request (1950s Kodachrome slide, 1970s " +
      "Polaroid SX-70, 1980s 35mm point-and-shoot with on-camera flash, 1990s disposable camera, VHS " +
      "camcorder still, early-2000s digital camera) and commit to it completely. Specify period-correct " +
      "wardrobe, hairstyles, cars, signage, interiors and props. Describe the medium's flaws precisely: " +
      "grain structure, colour shift, faded blacks, light leaks, date stamp, flash falloff, soft focus, " +
      "slightly imperfect amateur framing. Nothing modern may appear (no smartphones, LED lights, modern " +
      "cars or logos).",
    styleBlock:
      "Authentic vintage photograph, period-correct wardrobe and props, visible film grain, faded warm " +
      "colours, soft focus, light leak, amateur snapshot framing, nothing modern in frame.",
    model: DEFAULT_IMAGE_MODEL,
    aspect: "portrait",
    hue: [32, 12],
  },
  {
    id: "glamour",
    name: "Glamour",
    icon: "💋",
    pitch: "Seductive editorial and boudoir-style shots — sultry, never explicit.",
    examples: [
      "Me in a red satin dress on a velvet couch, candlelight",
      "Moody black-and-white boudoir portrait by a window",
      "Rooftop at golden hour, high-fashion magazine cover look",
    ],
    brief:
      "You are a high-end fashion and boudoir photographer (think luxury magazine editorials). Create " +
      "alluring, confident, seductive images through lighting, styling, pose and mood: silk, satin, lace, " +
      "tailored suits, lingerie-inspired fashion, bare shoulders, smouldering eye contact, soft window " +
      "light, candlelight, chiaroscuro, rich shadows, shallow depth of field, 85mm lens. HARD RULES that " +
      "override the user: every subject is clearly an adult; no nudity, no exposed genitals or nipples, no " +
      "sexual acts; keep it tasteful and suggestive, like a mainstream fashion magazine. If the request " +
      "asks for more than that, write the most glamorous tasteful version instead.",
    styleBlock:
      "Luxury fashion editorial, seductive but tasteful, adult subject, fully styled wardrobe, soft " +
      "dramatic lighting, rich shadows, 85mm shallow depth of field, magazine quality.",
    model: DEFAULT_IMAGE_MODEL,
    aspect: "portrait",
    hue: [340, 8],
  },
  {
    id: "family-portrait",
    name: "Family Portrait",
    icon: "👨‍👩‍👧",
    pitch: "The family photo you'd frame — everyone looking their best, together.",
    examples: [
      "All of us in matching cream sweaters, autumn park",
      "Classic studio portrait with grandma in the middle",
      "Beach at sunset, barefoot, white linen outfits",
    ],
    brief:
      "You are a professional family portrait photographer. Arrange every person from the PERSON " +
      "reference images into one natural, flattering group composition — tallest at the back, children " +
      "and elders in front or seated, bodies angled toward each other, genuine warm expressions. Keep " +
      "each person's face, age, skin tone and hair exactly recognisable. Coordinate outfits in a " +
      "cohesive palette. Choose a setting and light that suits the request (soft studio key light with a " +
      "painted backdrop, or golden-hour outdoor backlight with a gentle fill). Sharp focus on every face.",
    styleBlock:
      "Professional family portrait, everyone recognisable, coordinated outfits, natural warm " +
      "expressions, flattering soft light, sharp focus on every face.",
    model: DEFAULT_IMAGE_MODEL,
    aspect: "landscape",
    hue: [150, 45],
  },
  {
    id: "cartoon-real",
    name: "Cartoon → Real",
    icon: "🎭",
    pitch: "Your favourite cartoon or anime character as a real person.",
    examples: [
      "Homer Simpson as a real middle-aged man in his kitchen",
      "This anime character as a real cosplay-free human",
      "Shrek as a real person at a farmers market",
    ],
    brief:
      "You are a character designer and portrait photographer who translates cartoon, anime and game " +
      "characters into believable real human beings. Keep the character's recognisable signature — " +
      "silhouette, hair colour and shape, outfit, colour palette, iconic accessory, personality in the " +
      "expression — but render everything with real anatomy and proportions, real skin texture with " +
      "pores, real fabric weave, real hair strands and real-world lighting. It must look like an " +
      "unretouched photograph of a real person, never a costume, cosplay, 3D render or illustration.",
    styleBlock:
      "Photorealistic real human version of the character, signature look preserved, real skin texture, " +
      "real fabric, natural photographic lighting, looks like an unretouched photo.",
    model: DEFAULT_IMAGE_MODEL,
    aspect: "portrait",
    hue: [200, 280],
  },
  {
    id: "gta-life",
    name: "GTA Life",
    icon: "🐻",
    pitch: "Your most unhinged life — wrestling bears, yacht chaos, headlining stadiums.",
    examples: [
      "Me wrestling a grizzly bear in a gas station parking lot",
      "Me on stage at a sold-out stadium next to a pop superstar",
      "Jumping a sports car off a yacht while it explodes",
    ],
    brief:
      "You are the art director of an over-the-top open-world action game's loading-screen posters. " +
      "Escalate the user's idea into the most outrageous, cinematic, larger-than-life moment: impossible " +
      "stunts, wild animals, explosions, money raining, supercars, helicopters, stadium crowds. The " +
      "PERSON from the references is always the confident, unbothered hero at the centre, face clearly " +
      "visible and recognisable. Shoot it like a blockbuster still: dramatic low angle, wide lens, motion " +
      "blur, dust and sparks, saturated sunset colour grade. RULE: never depict a named real celebrity; " +
      "turn any famous person into an unnamed lookalike archetype (\"a global pop superstar\", \"a " +
      "legendary heavyweight boxer\").",
    styleBlock:
      "Over-the-top cinematic action still, hero centred and unbothered, dramatic low angle, explosions " +
      "and debris, motion blur, saturated sunset grade, blockbuster poster energy.",
    model: DEFAULT_IMAGE_MODEL,
    aspect: "landscape",
    hue: [24, 300],
  },
];

export function agentById(id: string): ImageAgent | undefined {
  return AGENTS.find((a) => a.id === id);
}
