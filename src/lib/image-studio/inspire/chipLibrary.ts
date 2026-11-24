// ---------------------------------------------------------------------------
// The Prompt Builder's chip library: real ingredients, each with the one line
// that says what it does to a picture. The same list doubles as the
// extractor's dictionary (extract.ts) and the recommender's vocabulary, so a
// chip described here is described the same way everywhere it shows up.
// ---------------------------------------------------------------------------

import type { ChipCategoryId } from "./taxonomy";
import type { Chip } from "./types";

type Row = [text: string, why: string];

const LIB: Record<ChipCategoryId, Row[]> = {
  character: [
    ["cyberpunk warrior", "A combat-ready figure with tech augmentations; sets a sci-fi action tone."],
    ["astronaut", "A suited explorer; brings scale, isolation and a sense of the unknown."],
    ["samurai", "A disciplined swordsman; adds ritual, honour and sharp silhouettes."],
    ["mech pilot", "A young pilot with a flight suit; pairs naturally with giant robots."],
    ["street skater", "Youthful, kinetic, urban; good for streetwear energy."],
    ["wizard", "A robed spellcaster; signals fantasy and arcane light."],
    ["android", "A humanlike machine; invites seams, joints and uncanny calm."],
    ["knight in ornate armor", "Heavy metal plate; gives weight, reflections and heroism."],
    ["old fisherman", "Weathered face, deep wrinkles; rewards detailed portrait lighting."],
    ["fashion model", "Poised and styled; pushes toward editorial photography."],
    ["forest spirit", "A gentle mythic being; softens the scene with folklore."],
    ["stone golem", "A massive creature of rock; adds scale and ancient texture."],
  ],
  subject: [
    ["koi fish", "A graceful, curving subject that reads well as a single graphic."],
    ["tiger", "Power and stripes; strong pattern for illustration and print."],
    ["sugar skull", "Decorative, symmetrical, instantly readable on apparel."],
    ["ringed planet", "A cosmic shape that works as an icon or a backdrop."],
    ["vintage convertible", "Nostalgia on wheels; anchors retro and travel scenes."],
    ["perfume bottle", "A luxury object built for reflections and refraction."],
    ["running sneaker", "A product hero with curves and material contrast."],
    ["marble bust", "Classical sculpture; a vaporwave and art-history staple."],
    ["bowl of ramen", "Steam, broth and toppings; rich food-photo detail."],
    ["oni mask", "A bold Japanese demon face; strong symmetry for prints."],
    ["glowing doorway", "A threshold of light; instantly surreal and narrative."],
    ["fox head", "Sharp, friendly geometry; a classic for logo marks."],
  ],
  wardrobe: [
    ["oversized hoodie", "Relaxed streetwear silhouette with soft folds."],
    ["flight suit", "Utility one-piece with patches; reads as pilot or crew."],
    ["trench coat", "Long dramatic line; noir and rainy-city energy."],
    ["varsity jacket", "Chenille patches and contrast sleeves; collegiate retro."],
    ["techwear cargo pants", "Straps, buckles and pockets; future-utility look."],
    ["kimono", "Wide sleeves and patterned silk; elegant traditional lines."],
    ["leather biker jacket", "Hard sheen and zips; rebellious edge."],
    ["tailored suit", "Clean shoulders and lapels; polished and powerful."],
    ["armored plating", "Segmented protective shell; sci-fi or fantasy armour."],
    ["silk evening gown", "Liquid drape and sheen; glamour and movement."],
  ],
  accessories: [
    ["retro sunglasses", "Instant attitude; a vaporwave and 80s shorthand."],
    ["clear umbrella", "Rain reflections and framing; romantic city nights."],
    ["katana", "A curved blade; adds tension and a strong diagonal line."],
    ["holographic visor", "A glowing face band; futuristic and anonymous."],
    ["chunky headphones", "Music culture and a strong side silhouette."],
    ["gold chain", "Hip-hop luxury; catches highlights."],
    ["helmet held under arm", "A pilot's pause; humanises a sci-fi character."],
    ["backpack with patches", "Adventure and personal story in one object."],
    ["neon tattoos", "Glowing body art; cyberpunk detail on skin."],
    ["face mask", "Hides the lower face; mystery and street style."],
  ],
  pose: [
    ["standing confidently", "An upright, centred stance that reads as strength."],
    ["kneeling", "A lowered pose; humility, weight or exhaustion."],
    ["walking toward camera", "Motion and intent; the subject comes to the viewer."],
    ["looking over shoulder", "A backward glance; intrigue and narrative."],
    ["mid-air leap", "Frozen action; energy and dynamism."],
    ["floating weightlessly", "Zero gravity; dreamy or cosmic feel."],
    ["three-quarter view", "The classic character angle; shows face and form."],
    ["hands in pockets", "Relaxed and cool; casual streetwear attitude."],
    ["sitting at a counter", "Grounded, quiet storytelling moment."],
    ["arms crossed", "Closed, confident, guarded body language."],
  ],
  scene: [
    ["neon-lit Tokyo street", "Dense signage and wet asphalt; the cyberpunk canvas."],
    ["rainy city night", "Reflections, bokeh and mood in one phrase."],
    ["misty redwood forest", "Towering trunks and haze; scale and calm."],
    ["Mars surface at dusk", "Red dust and alien sky; isolated sci-fi."],
    ["sand dunes at sunset", "Sweeping curves and long shadows."],
    ["robot hangar", "Gantries and giant machines; industrial sci-fi."],
    ["checkered floor with palm trees", "The vaporwave set, ready-made."],
    ["still lake at twilight", "Mirror reflections and quiet blue hour."],
    ["cozy bedroom studio", "Lived-in warmth; plants, lamps, gear."],
    ["concrete wall", "A raw backdrop for graffiti and street work."],
  ],
  environment: [
    ["plain white background", "Isolates the subject; essential for print and cutouts."],
    ["deep black background", "Pure dark void; makes highlights and chrome pop."],
    ["pastel gradient background", "Soft colour wash; clean product and 3D looks."],
    ["studio backdrop", "Seamless paper sweep; controlled and professional."],
    ["dark wooden counter", "Warm natural surface for food and objects."],
    ["volcanic rock", "Rough black texture against polished products."],
    ["solarpunk city", "Green architecture; hopeful future."],
    ["outer space with stars", "Infinite dark with points of light."],
    ["hanging gardens", "Lush greenery cascading off structures."],
    ["dust storm on the horizon", "Distant threat and atmospheric depth."],
  ],
  camera: [
    ["85mm lens", "Flattering portrait compression with a soft background."],
    ["50mm lens", "Natural, human field of view; honest perspective."],
    ["wide angle", "Expansive view that exaggerates depth and space."],
    ["macro", "Extreme close-up that reveals tiny surface detail."],
    ["low angle shot", "Camera looks up; the subject feels powerful."],
    ["overhead shot", "Top-down flat lay; graphic and orderly."],
    ["aerial view", "Bird's-eye scale over a whole landscape or city."],
    ["shallow depth of field", "Sharp subject, melted background; isolates focus."],
    ["isometric view", "Angled orthographic view; diorama and game-art look."],
    ["flat front view", "Straight-on and undistorted; best for type and graphics."],
    ["tilt-shift", "Miniature effect from a narrow band of focus."],
    ["35mm film", "Film-camera character: grain and gentle colour."],
  ],
  lighting: [
    ["cinematic lighting", "Directed, high-contrast light that feels like a film still."],
    ["dramatic shadows", "Deep, sculpting shadows that add tension and depth."],
    ["soft studio lighting", "Even, diffused light; clean and commercial."],
    ["rim light", "A bright edge outlining the subject against the background."],
    ["golden hour sunlight", "Warm, low sun; long shadows and glowing skin."],
    ["neon glow", "Coloured light from signs; saturated night look."],
    ["god rays", "Visible light beams through haze or canopy."],
    ["soft window light", "Natural side light; gentle and believable."],
    ["backlit", "Light from behind; halos and silhouettes."],
    ["warm lamp light", "Small, cosy pools of tungsten light."],
    ["global illumination", "Light bouncing softly around a 3D scene."],
    ["high contrast", "Bright highlights against deep darks; punchy."],
  ],
  style: [
    ["3D rendering", "A computer-rendered look with realistic depth and surface."],
    ["octane render", "Glossy, physically-based 3D look with crisp light."],
    ["claymorphism 3D render", "Soft rounded shapes like matte clay; friendly and toy-like."],
    ["concept art", "Painterly production design; story-first imagery."],
    ["watercolor painting", "Transparent washes, blooms and paper texture."],
    ["screen print style", "Flat inks, limited colours, slight misregistration."],
    ["flat vector", "Clean geometric shapes with no texture; logo-ready."],
    ["cel shading", "Hard-edged anime shadows; illustrated look."],
    ["tattoo flash line art", "Bold outlines and classic tattoo motifs."],
    ["matte painting", "Film-style painted environment; vast and cinematic."],
    ["product photography", "Commercial, clean, detail-focused photo look."],
    ["vaporwave aesthetic", "80s/90s nostalgia, statues, grids and sunsets."],
    ["y2k aesthetic", "Chrome, bubbles and early-2000s futurism."],
    ["anime", "Japanese animation style: expressive eyes, clean lines."],
    ["gouache illustration", "Opaque, matte paint; storybook warmth."],
    ["swiss grid layout", "Strict modernist grid; ordered graphic design."],
  ],
  typography: [
    ["bold condensed sans-serif", "Tall, tight letters that dominate a layout."],
    ["liquid chrome lettering", "Reflective, melting metal type; y2k signature."],
    ["graffiti wildstyle", "Interlocking, arrowed street letters."],
    ["retro script", "Flowing vintage handwriting; diners and sports."],
    ["blackletter", "Gothic calligraphy; heritage and streetwear edge."],
    ["outlined type", "Hollow letters; light and graphic."],
    ["stacked headline", "Words stacked tight; poster impact."],
    ["embossed lettering", "Raised, tactile letters catching light."],
    ["neon sign lettering", "Glowing tube letters on a dark wall."],
    ["varsity block letters", "Collegiate slab letters with outlines."],
  ],
  composition: [
    ["centered composition", "Subject dead centre; strong, iconic, symmetrical."],
    ["symmetrical composition", "Mirror balance; ceremonial and bold."],
    ["rule of thirds", "Subject off-centre; natural and dynamic."],
    ["negative space", "Generous empty area; calm, elegant, room for text."],
    ["minimal composition", "Few elements, nothing extra; clean focus."],
    ["wide composition", "Panoramic layout with room to breathe."],
    ["isolated subject", "Nothing touching the subject; ready to cut out."],
    ["cutaway view", "A sliced-open structure showing the inside."],
    ["leading lines", "Lines that pull the eye to the subject."],
    ["full body shot", "The whole figure in frame, head to toe."],
    ["close-up portrait", "Face fills the frame; intimate and detailed."],
  ],
  color: [
    ["neon pink and cyan", "Electric complementary pair; synthwave signature."],
    ["burnt orange and teal", "Warm/cool cinematic pairing; travel-poster classic."],
    ["vermilion and cream", "Japanese print palette; warm and graphic."],
    ["monochrome", "One hue in many values; focused and moody."],
    ["black ink only", "Single colour; cheap to print, strong contrast."],
    ["pastel colors", "Soft, low-saturation tints; gentle and playful."],
    ["deep emerald and gold", "Rich jewel tones; luxury."],
    ["acid green and black", "Toxic, rave, brutalist energy."],
    ["muted ochre and indigo", "Earthy natural pigments; painterly calm."],
    ["navy and amber", "Trustworthy blue with a warm accent."],
    ["cool blue palette", "Calm, cold, twilight feeling."],
    ["warm earth tones", "Browns and terracotta; grounded and organic."],
  ],
  texture: [
    ["ultra-detailed", "Pushes the model to render fine detail everywhere."],
    ["film grain", "Analogue noise; organic, photographic feel."],
    ["halftone texture", "Printed dot pattern; retro comic and poster look."],
    ["distressed texture", "Worn, cracked print; vintage apparel feel."],
    ["subsurface scattering", "Light passing through skin, wax or plastic; softness."],
    ["reflective metallic surface", "Mirror-like metal that picks up its surroundings."],
    ["textured paper", "Visible paper tooth; handmade quality."],
    ["detailed fabric texture", "Stitches, weave and pile you can almost feel."],
    ["grainy photocopy texture", "Toner noise and contrast; zine aesthetic."],
    ["sharp focus", "Crisp edges and clean detail on the subject."],
    ["intricate details", "Dense ornamental detail that rewards zooming in."],
  ],
  effects: [
    ["volumetric fog", "Light-catching fog that adds depth and atmosphere."],
    ["bokeh", "Soft out-of-focus light orbs behind the subject."],
    ["glitch effect", "Digital distortion and RGB split; broken-signal look."],
    ["lens flare", "Streaks and orbs from bright light hitting the lens."],
    ["rising steam", "Wisps of vapour; warmth and freshness."],
    ["water splash frozen in motion", "High-speed liquid caught mid-air; drama."],
    ["particles", "Floating specks or embers; life in the air."],
    ["lightning", "Electric bolts; raw energy and contrast."],
    ["ink splatter", "Loose drops and flicks of paint; expressive energy."],
    ["dripping edges", "Liquid running off shapes; melting effect."],
    ["motion blur", "Streaked movement; speed and action."],
    ["atmospheric haze", "Distance softened by air; depth and scale."],
  ],
  mood: [
    ["moody", "Dark, reflective, emotional tone."],
    ["dreamy", "Soft, floaty, slightly unreal."],
    ["cozy", "Warm, safe, inviting."],
    ["epic", "Grand scale and heroic weight."],
    ["mysterious", "Things half-hidden; invites curiosity."],
    ["whimsical", "Playful, light, a little magical."],
    ["melancholic", "Quiet sadness and longing."],
    ["energetic", "Loud, fast, full of motion."],
    ["serene", "Calm, still and balanced."],
    ["luxurious", "Expensive, refined, exclusive."],
    ["lonely", "A small subject in a big empty space."],
    ["ominous", "Something bad is about to happen."],
  ],
};

export interface LibraryChipDef extends Chip {
  id: string;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export const CHIP_LIBRARY: LibraryChipDef[] = (Object.entries(LIB) as [ChipCategoryId, Row[]][]).flatMap(([category, rows]) =>
  rows.map(([text, why]) => ({ id: `${category}:${slug(text)}`, text, category, why })),
);

const BY_TEXT = new Map(CHIP_LIBRARY.map((c) => [c.text.toLowerCase(), c]));

/** The library entry for a phrase, matched case-insensitively. */
export function libraryChip(text: string): LibraryChipDef | undefined {
  return BY_TEXT.get(text.trim().toLowerCase());
}

/** Search across every category: text first, then the description. */
export function searchLibrary(query: string, category?: ChipCategoryId | "all"): LibraryChipDef[] {
  const q = query.trim().toLowerCase();
  const pool = category && category !== "all" ? CHIP_LIBRARY.filter((c) => c.category === category) : CHIP_LIBRARY;
  if (!q) return pool;
  const words = q.split(/\s+/);
  const scored = pool
    .map((c) => {
      const t = c.text.toLowerCase();
      const w = (c.why ?? "").toLowerCase();
      let score = 0;
      if (t === q) score += 100;
      if (t.startsWith(q)) score += 40;
      if (t.includes(q)) score += 25;
      for (const word of words) {
        if (t.includes(word)) score += 8;
        else if (w.includes(word)) score += 3;
      }
      return { c, score };
    })
    .filter((s) => s.score > 0);
  return scored.sort((a, b) => b.score - a.score).map((s) => s.c);
}
