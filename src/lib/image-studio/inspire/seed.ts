// ---------------------------------------------------------------------------
// The starter set: the images Explore opens on before anyone has published.
//
// Every picture here was drawn locally with Flux 2 Klein on WanGP from the
// exact prompt beside it (scripts/inspire-seed.mjs), so each prompt really is
// the prompt behind its image — which is the whole point of the app. The files
// live in /public/image-studio/inspire/seed/<id>.webp (+ -thumb.webp).
//
// Creators are studio handles, shown with a "Starter set" mark, never people.
// Chips are filled in by the extractor at load (see seedImages()).
// ---------------------------------------------------------------------------

import type { ChipCategoryId, GalleryCategoryId } from "./taxonomy";

export interface SeedSpec {
  id: string;
  title: string;
  description: string;
  creator: string;
  category: GalleryCategoryId;
  style: string;
  subject: string;
  aspect: "portrait" | "square" | "landscape" | "wide";
  prompt: string;
  /** Shown in the Explore hero, where the prompt scans into the picture. */
  featured?: boolean;
  /** Hero chips pinned to the part of the picture they describe: [text, category, x, y] in image fractions. */
  pins?: [string, ChipCategoryId, number, number][];
  /** Days before launch it was "published", so Newest has a real order. */
  age: number;
}

export const SEED: SeedSpec[] = [
  {
    id: "seed-neon-ronin",
    title: "Neon Ronin",
    description: "A study in wet neon and long lenses.",
    creator: "lumen.lab",
    category: "character",
    style: "Cyberpunk",
    subject: "Person",
    aspect: "portrait",
    prompt:
      "A futuristic cyberpunk warrior standing in a neon-lit Tokyo street, cinematic lighting, ultra-detailed 3D rendering, dramatic shadows, volumetric fog, 85mm lens",
    age: 1,
  },
  {
    id: "seed-koi-tee",
    title: "Koi Wave Tee",
    description: "Front-print artwork, flat colour, made to screen print.",
    creator: "inkfoundry",
    category: "tshirt",
    style: "Line Art",
    subject: "Animal",
    aspect: "square",
    prompt:
      "Vintage japanese koi fish leaping over a great wave, bold black outlines, limited palette of vermilion and cream, screen print style, isolated on plain white background, centered t-shirt graphic",
    age: 2,
  },
  {
    id: "seed-orbit-mark",
    title: "Orbit Coffee Mark",
    description: "A minimal mark for a late-night coffee bar.",
    creator: "vectorkid",
    category: "logo",
    style: "Minimalist",
    subject: "Object",
    aspect: "square",
    prompt:
      "Minimalist flat vector logo of a coffee cup with a ringed planet orbit for steam, geometric shapes, two-color navy and amber, clean negative space, centered on white background",
    age: 3,
  },
  {
    id: "seed-chrome-type",
    title: "LIQUID",
    description: "Chrome lettering, melting at the edges.",
    creator: "softmachine",
    category: "typography",
    style: "Y2K",
    subject: "Lettering",
    aspect: "landscape",
    prompt:
      "The word LIQUID in bold liquid chrome 3D lettering, reflective metallic surface, iridescent highlights, dripping edges, y2k aesthetic, studio lighting, deep black background",
    age: 4,
  },
  {
    id: "seed-moss-golem",
    title: "Moss Golem",
    description: "A forest guardian for a tabletop campaign.",
    creator: "grainhouse",
    category: "character",
    style: "Surreal",
    subject: "Creature",
    aspect: "portrait",
    prompt:
      "Ancient moss-covered stone golem kneeling in a misty redwood forest, glowing amber runes carved into its chest, god rays through the canopy, fantasy concept art, highly detailed textures, low angle shot",
    age: 5,
  },
  {
    id: "seed-sneaker-float",
    title: "Zero-G Runner",
    description: "Product hero shot for a launch page.",
    creator: "lumen.lab",
    category: "product",
    style: "3D Render",
    subject: "Object",
    aspect: "landscape",
    prompt:
      "Futuristic translucent running sneaker floating in mid-air, soft studio lighting, pastel gradient background, subsurface scattering, product photography, sharp focus, minimal composition",
    age: 6,
  },
  {
    id: "seed-desert-poster",
    title: "Dune Cruise",
    description: "Travel poster, mid-century screen print.",
    creator: "inkfoundry",
    category: "poster",
    style: "Retro / Vintage",
    subject: "Landscape",
    aspect: "portrait",
    prompt:
      "Retro travel poster of a vintage convertible driving through towering sand dunes at sunset, flat colors, halftone texture, burnt orange and teal palette, 1960s screen print style, wide composition",
    age: 7,
  },
  {
    id: "seed-rain-portrait",
    title: "After the Rain",
    description: "Street portrait, shot wide open.",
    creator: "grainhouse",
    category: "photography",
    style: "Photorealistic",
    subject: "Person",
    aspect: "portrait",
    prompt:
      "Candid street portrait of a young woman under a clear umbrella on a rainy night, bokeh city lights, shallow depth of field, 50mm lens, kodak portra film grain, moody cinematic color grading",
    age: 8,
  },
  {
    id: "seed-iso-room",
    title: "Tiny Studio",
    description: "An isometric room you want to live in.",
    creator: "softmachine",
    category: "3d",
    style: "3D Render",
    subject: "Architecture",
    aspect: "square",
    prompt:
      "Isometric cutaway of a cozy music producer bedroom at night, warm lamp light, synthesizers and plants, soft global illumination, claymorphism 3D render, pastel colors, tiny details",
    age: 9,
  },
  {
    id: "seed-ink-tiger",
    title: "Ink Tiger",
    description: "Loose brush, heavy water.",
    creator: "inkfoundry",
    category: "illustration",
    style: "Watercolor",
    subject: "Animal",
    aspect: "portrait",
    prompt:
      "Expressive watercolor painting of a tiger walking through tall grass, loose brush strokes, ink splatter, muted ochre and indigo palette, textured cold press paper, negative space",
    age: 10,
  },
  {
    id: "seed-oni-hoodie",
    title: "Oni Back Print",
    description: "Oversized back print for a streetwear drop.",
    creator: "vectorkid",
    category: "streetwear",
    style: "Anime",
    subject: "Creature",
    aspect: "portrait",
    prompt:
      "Streetwear hoodie back print of an oni mask surrounded by lightning and cherry blossoms, bold anime linework, red black and white palette, distressed texture, symmetrical composition, isolated on black background",
    age: 11,
  },
  {
    id: "seed-vapor-bust",
    title: "Marble Sunset",
    description: "Vaporwave still life.",
    creator: "softmachine",
    category: "digital-art",
    style: "Vaporwave",
    subject: "Abstract",
    aspect: "square",
    prompt:
      "Classical marble bust wearing retro sunglasses on a checkered floor, palm trees, giant setting sun with horizontal stripes, vaporwave aesthetic, pink and cyan palette, glitch effect",
    age: 12,
  },
  {
    id: "seed-astro-diner",
    title: "Last Diner on Mars",
    description: "Environment concept for a short film.",
    creator: "lumen.lab",
    category: "digital-art",
    style: "Surreal",
    subject: "Architecture",
    aspect: "landscape",
    prompt:
      "A lonely retro 1950s diner on the surface of Mars at dusk, glowing neon sign, astronaut sitting at the counter seen through the window, dust storm on the horizon, wide angle, cinematic matte painting",
    age: 13,
  },
  {
    id: "seed-mech-pilot",
    title: "Pilot 07",
    description: "Character sheet portrait.",
    creator: "vectorkid",
    category: "character",
    style: "Anime",
    subject: "Person",
    aspect: "portrait",
    prompt:
      "Anime mech pilot girl in a white and orange flight suit, holding her helmet, hangar background with giant robot, cel shading, crisp line art, soft rim light, three-quarter view",
    age: 14,
  },
  {
    id: "seed-brutal-poster",
    title: "SIGNAL / NOISE",
    description: "Event poster, Swiss grid gone loud.",
    creator: "softmachine",
    category: "poster",
    style: "Brutalist",
    subject: "Lettering",
    aspect: "portrait",
    prompt:
      "Brutalist typographic poster with huge condensed sans-serif letters reading SIGNAL NOISE, swiss grid layout, acid green and black, halftone photo of a satellite dish, grainy photocopy texture",
    age: 15,
  },
  {
    id: "seed-perfume",
    title: "Nocturne Eau",
    description: "Fragrance still for a campaign.",
    creator: "grainhouse",
    category: "product",
    style: "Photorealistic",
    subject: "Object",
    aspect: "portrait",
    prompt:
      "Luxury perfume bottle on black volcanic rock, splashing water frozen in motion, dramatic rim lighting, deep emerald and gold palette, macro product photography, high contrast, ultra sharp",
    age: 16,
  },
  {
    id: "seed-skull-tee",
    title: "Bloom Skull",
    description: "Single-colour tee graphic.",
    creator: "inkfoundry",
    category: "tshirt",
    style: "Line Art",
    subject: "Object",
    aspect: "square",
    prompt:
      "Sugar skull made of blooming roses and peonies, intricate tattoo flash line art, black ink only, high contrast, centered composition, isolated on plain white background, print ready t-shirt graphic",
    age: 17,
  },
  {
    id: "seed-fox-mark",
    title: "Fox Lab Badge",
    description: "Badge mark for a dev studio.",
    creator: "vectorkid",
    category: "logo",
    style: "Minimalist",
    subject: "Animal",
    aspect: "square",
    prompt:
      "Geometric fox head emblem logo made of sharp triangles, gradient from orange to magenta, flat vector, badge style, clean edges, centered on dark charcoal background",
    age: 18,
  },
  {
    id: "seed-glass-city",
    title: "Glass Garden City",
    description: "Solarpunk skyline at golden hour.",
    creator: "lumen.lab",
    category: "3d",
    style: "3D Render",
    subject: "Architecture",
    aspect: "landscape",
    prompt:
      "Solarpunk city of glass towers covered in hanging gardens, golden hour sunlight, waterfalls between buildings, aerial view, octane render, lush greens and warm gold, atmospheric haze",
    age: 19,
  },
  {
    id: "seed-ramen",
    title: "Midnight Ramen",
    description: "Food photography, steam and all.",
    creator: "grainhouse",
    category: "photography",
    style: "Photorealistic",
    subject: "Food",
    aspect: "square",
    prompt:
      "Overhead shot of a steaming bowl of tonkotsu ramen on a dark wooden counter, soft window light from the left, rising steam, shallow depth of field, rich warm tones, food photography",
    age: 20,
  },
  {
    id: "seed-graffiti-type",
    title: "WILD",
    description: "Wildstyle lettering on a clean wall.",
    creator: "vectorkid",
    category: "typography",
    style: "Y2K",
    subject: "Lettering",
    aspect: "landscape",
    prompt:
      "Graffiti wildstyle lettering spelling WILD, interlocking arrows, electric purple and lime green fill with white highlights, spray paint drips, on a clean concrete wall, flat front view",
    age: 21,
  },
  {
    id: "seed-cat-astronaut",
    title: "Space Cadet",
    description: "Kids-book spread.",
    creator: "softmachine",
    category: "illustration",
    style: "Watercolor",
    subject: "Animal",
    aspect: "landscape",
    prompt:
      "Whimsical children's book illustration of a ginger cat astronaut floating among planets and stars, soft gouache texture, warm pastel palette, gentle rim light, dreamy atmosphere",
    age: 22,
  },
  {
    id: "seed-varsity",
    title: "Varsity Drop",
    description: "Jacket mockup with chenille patches.",
    creator: "inkfoundry",
    category: "streetwear",
    style: "Retro / Vintage",
    subject: "Object",
    aspect: "portrait",
    prompt:
      "Vintage varsity jacket with chenille patches and embroidered tiger on the back, hanging on a wall, soft daylight, detailed fabric texture, cream and forest green colors, fashion product shot",
    age: 23,
  },
  {
    id: "seed-portal",
    title: "The Quiet Portal",
    description: "A doorway that should not be there.",
    creator: "lumen.lab",
    category: "digital-art",
    style: "Surreal",
    subject: "Landscape",
    aspect: "portrait",
    prompt:
      "A glowing doorway standing alone in a still lake at twilight, reflection on mirror-like water, tiny silhouette of a person walking toward it, surreal minimalism, cool blue palette with a warm light spill",
    age: 24,
  },
  {
    id: "seed-jellyfish",
    title: "Deep Lanterns",
    description: "Bioluminescence study.",
    creator: "lumen.lab",
    category: "digital-art",
    style: "Surreal",
    subject: "Animal",
    aspect: "portrait",
    prompt:
      "Giant bioluminescent jellyfish drifting through a dark ocean trench, glowing cyan and violet tentacles, tiny diver for scale, particles floating in the water, volumetric light from above, mysterious atmosphere",
    age: 25,
  },
  {
    id: "seed-robot-tee",
    title: "Tin Pal",
    description: "Retro toy robot, two-colour print.",
    creator: "inkfoundry",
    category: "tshirt",
    style: "Retro / Vintage",
    subject: "Object",
    aspect: "square",
    prompt:
      "Retro 1950s tin toy robot waving, bold outlines, halftone shading, two-color red and navy, distressed texture, centered t-shirt graphic isolated on plain white background",
    age: 26,
  },
  {
    id: "seed-peak-type",
    title: "PEAK",
    description: "Lettering carved out of a mountain range.",
    creator: "softmachine",
    category: "typography",
    style: "Photorealistic",
    subject: "Lettering",
    aspect: "landscape",
    prompt:
      "Giant letters spelling PEAK carved into snowy mountain ridges, aerial view, golden hour sunlight, long shadows, crisp alpine air, epic scale, photorealistic",
    age: 27,
  },
  {
    id: "seed-samurai-cat",
    title: "Ronin Cat",
    description: "A stray with a code.",
    creator: "vectorkid",
    category: "character",
    style: "Anime",
    subject: "Animal",
    aspect: "portrait",
    prompt:
      "Anthropomorphic black cat samurai in a worn indigo kimono holding a katana, standing in falling cherry blossoms, anime style, cel shading, dramatic rim light, full body shot",
    age: 28,
  },
  {
    id: "seed-headphones",
    title: "Halo Cans",
    description: "Launch render for wireless headphones.",
    creator: "lumen.lab",
    category: "product",
    style: "3D Render",
    subject: "Object",
    aspect: "landscape",
    prompt:
      "Sleek matte white wireless headphones floating above a glossy pedestal, soft studio lighting, subtle orange accent glow, minimal composition, octane render, sharp focus, light grey background",
    age: 29,
  },
  {
    id: "seed-noir",
    title: "Night Shift",
    description: "Black-and-white noir still.",
    creator: "grainhouse",
    category: "photography",
    style: "Photorealistic",
    subject: "Person",
    aspect: "portrait",
    prompt:
      "Film noir portrait of a detective in a trench coat lighting a cigarette under a street lamp, black and white, hard side light, venetian blind shadows, 35mm film grain, high contrast, moody",
    age: 30,
  },
  {
    id: "seed-mushroom-house",
    title: "Toadstool Home",
    description: "A tiny house you could hold.",
    creator: "softmachine",
    category: "3d",
    style: "3D Render",
    subject: "Architecture",
    aspect: "square",
    prompt:
      "Tiny mushroom house with glowing round windows on a mossy tree stump, claymorphism 3D render, soft global illumination, pastel colors, tilt-shift, cozy whimsical mood",
    age: 31,
  },
  {
    id: "seed-wolf-logo",
    title: "Northpack",
    description: "Outdoor brand mark.",
    creator: "vectorkid",
    category: "logo",
    style: "Minimalist",
    subject: "Animal",
    aspect: "square",
    prompt:
      "Minimalist line logo of a howling wolf inside a circle with mountain peaks, single weight line art, forest green on cream background, flat vector, centered, clean negative space",
    age: 32,
  },
  {
    id: "seed-jazz-poster",
    title: "Blue Note Night",
    description: "Art deco gig poster.",
    creator: "inkfoundry",
    category: "poster",
    style: "Retro / Vintage",
    subject: "Person",
    aspect: "portrait",
    prompt:
      "Art deco jazz poster of a saxophone player silhouette, geometric sunburst rays, gold and deep navy palette, elegant stacked headline lettering, textured paper, symmetrical composition",
    age: 33,
  },
  {
    id: "seed-techwear-flatlay",
    title: "Kit 03",
    description: "Techwear drop, laid flat.",
    creator: "grainhouse",
    category: "streetwear",
    style: "Minimalist",
    subject: "Object",
    aspect: "landscape",
    prompt:
      "Overhead flat lay of a black techwear outfit, cargo pants, utility vest with straps and buckles, chunky sneakers and a cap, neatly arranged on concrete, soft daylight, minimal composition, fashion photography",
    age: 34,
  },
  {
    id: "seed-botanical",
    title: "Fern Study",
    description: "Botanical plate in fine line.",
    creator: "inkfoundry",
    category: "illustration",
    style: "Line Art",
    subject: "Object",
    aspect: "portrait",
    prompt:
      "Vintage botanical illustration of ferns and wild orchids, fine ink line art with delicate watercolor wash, muted sage and dusty rose palette, aged textured paper, scientific plate layout",
    age: 35,
  },
  {
    id: "seed-hover-car",
    title: "Hover Commute",
    description: "Morning traffic, 2099.",
    creator: "lumen.lab",
    category: "digital-art",
    style: "Cyberpunk",
    subject: "Vehicle",
    aspect: "landscape",
    prompt:
      "Sleek hover car speeding between neon skyscrapers at night, motion blur, rain streaks, holographic billboards, pink and cyan neon glow, low angle shot, cinematic lighting, cyberpunk city",
    age: 36,
  },
  {
    id: "seed-sky-whale",
    title: "The Sky Whale",
    description: "A night migration over the city.",
    creator: "lumen.lab",
    category: "digital-art",
    style: "Surreal",
    subject: "Animal",
    aspect: "wide",
    prompt:
      "A colossal bioluminescent whale gliding through moonlit clouds above a sleeping neon city, aurora ribbons trailing from its fins, tiny glowing windows far below, cinematic wide shot, volumetric moonlight, ultra-detailed, deep teal and magenta palette, sense of awe",
    age: 0.20,
    featured: true,
    pins: [["bioluminescent whale", "character", 0.6, 0.33], ["moonlit clouds", "environment", 0.3, 0.6], ["sleeping neon city", "scene", 0.52, 0.84], ["aurora ribbons", "effects", 0.88, 0.2], ["volumetric moonlight", "lighting", 0.16, 0.14], ["cinematic wide shot", "camera", 0.82, 0.66], ["deep teal and magenta palette", "color", 0.12, 0.78], ["sense of awe", "mood", 0.42, 0.18]],
  },
  {
    id: "seed-desert-cathedral",
    title: "Cathedral of Dust",
    description: "Architecture at the edge of the world.",
    creator: "grainhouse",
    category: "photography",
    style: "Photorealistic",
    subject: "Architecture",
    aspect: "wide",
    prompt:
      "Monumental brutalist cathedral carved into towering red desert cliffs at golden hour, a single tiny pilgrim walking toward the entrance, long dramatic shadows, drifting dust haze, epic scale, architectural photography, warm earth tones",
    age: 0.25,
    featured: true,
    pins: [["brutalist cathedral", "subject", 0.47, 0.32], ["single tiny pilgrim", "character", 0.49, 0.86], ["red desert cliffs", "scene", 0.13, 0.4], ["golden hour", "lighting", 0.8, 0.14], ["drifting dust haze", "effects", 0.78, 0.58], ["architectural photography", "style", 0.3, 0.72], ["epic scale", "mood", 0.64, 0.8]],
  },
  {
    id: "seed-drowned-library",
    title: "The Drowned Library",
    description: "Light through water through glass.",
    creator: "softmachine",
    category: "digital-art",
    style: "Surreal",
    subject: "Architecture",
    aspect: "wide",
    prompt:
      "A flooded ancient library deep underwater, shafts of sunlight pouring through a broken stained glass dome, schools of silver fish drifting between tall bookshelves, floating pages, cinematic, volumetric light rays, turquoise and gold palette, serene",
    age: 0.30,
    featured: true,
    pins: [["broken stained glass dome", "subject", 0.5, 0.1], ["shafts of sunlight", "lighting", 0.56, 0.42], ["tall bookshelves", "scene", 0.1, 0.5], ["schools of silver fish", "subject", 0.36, 0.58], ["floating pages", "effects", 0.66, 0.86], ["turquoise and gold palette", "color", 0.86, 0.6], ["serene", "mood", 0.28, 0.86]],
  },
  {
    id: "seed-rain-samurai",
    title: "Red Bridge, Midnight",
    description: "Stillness inside the storm.",
    creator: "vectorkid",
    category: "character",
    style: "Cyberpunk",
    subject: "Person",
    aspect: "wide",
    prompt:
      "Lone samurai standing on a red lacquered bridge in torrential rain at night, paper lanterns glowing, raindrops frozen mid-air, neon reflections on wet wood, cinematic anamorphic lens, dramatic backlight, mist, deep red and electric blue",
    age: 0.35,
    featured: true,
    pins: [["lone samurai", "character", 0.52, 0.42], ["paper lanterns glowing", "lighting", 0.16, 0.2], ["red lacquered bridge", "scene", 0.3, 0.76], ["torrential rain", "effects", 0.76, 0.3], ["neon reflections on wet wood", "effects", 0.64, 0.9], ["cinematic anamorphic lens", "camera", 0.86, 0.62], ["deep red and electric blue", "color", 0.12, 0.58]],
  },
  {
    id: "seed-moon-ridge",
    title: "Moonrise Ridge",
    description: "One climber, one moon.",
    creator: "grainhouse",
    category: "photography",
    style: "Photorealistic",
    subject: "Landscape",
    aspect: "wide",
    prompt:
      "A gigantic full moon rising behind a lone climber standing on a knife-edge snowy ridge, blue hour, extreme telephoto compression, 600mm lens, crisp alpine air, minimal composition, cool blue and silver palette, epic",
    age: 0.40,
    featured: true,
    pins: [["gigantic full moon", "subject", 0.5, 0.3], ["lone climber", "character", 0.6, 0.48], ["knife-edge snowy ridge", "scene", 0.72, 0.78], ["blue hour", "lighting", 0.16, 0.2], ["600mm lens", "camera", 0.84, 0.22], ["minimal composition", "composition", 0.2, 0.7], ["cool blue and silver palette", "color", 0.36, 0.88]],
  },
  {
    id: "seed-chrome-gown",
    title: "Liquid Couture",
    description: "Editorial, poured not sewn.",
    creator: "softmachine",
    category: "photography",
    style: "Photorealistic",
    subject: "Person",
    aspect: "portrait",
    prompt:
      "Editorial fashion portrait of a model wearing a sculptural liquid chrome gown that flows like mercury, soft beauty lighting, pastel lilac seamless backdrop, high fashion photography, magazine cover composition, reflective metallic surface, elegant",
    age: 0.45,
  },
  {
    id: "seed-visor-nova",
    title: "Supernova Visor",
    description: "The last thing she saw.",
    creator: "lumen.lab",
    category: "character",
    style: "Photorealistic",
    subject: "Person",
    aspect: "portrait",
    prompt:
      "Close-up portrait of an astronaut whose cracked glass visor reflects an exploding supernova, iridescent frost on the helmet, rim light, 85mm lens, shallow depth of field, film grain, deep space background, cinematic",
    age: 0.50,
  },
  {
    id: "seed-koi-dragon",
    title: "Thousand Koi Dragon",
    description: "Ink, gold and motion.",
    creator: "inkfoundry",
    category: "illustration",
    style: "Surreal",
    subject: "Creature",
    aspect: "portrait",
    prompt:
      "A Japanese dragon formed from hundreds of swirling koi fish spiraling up into a storm, sumi-e ink brushwork fused with gold leaf, vermilion and gold on deep black, dynamic diagonal composition, intricate details, epic",
    age: 0.55,
  },
  {
    id: "seed-geisha-neon",
    title: "Holo Geisha",
    description: "Tradition, rewired.",
    creator: "vectorkid",
    category: "character",
    style: "Cyberpunk",
    subject: "Person",
    aspect: "portrait",
    prompt:
      "Cyberpunk geisha in a holographic kimono with glowing circuit tattoos under falling neon kanji rain, shallow depth of field, cinematic lighting, pink and cyan neon glow, wet street reflections, ultra-detailed",
    age: 0.60,
  },
  {
    id: "seed-candy-planet",
    title: "Sugar World",
    description: "A planet you could eat.",
    creator: "softmachine",
    category: "3d",
    style: "3D Render",
    subject: "Landscape",
    aspect: "square",
    prompt:
      "Miniature candy planet floating in pastel space with ice cream mountains, chocolate rivers and lollipop trees, claymorphism 3D render, tilt-shift, soft global illumination, pastel colors, whimsical",
    age: 0.65,
  },
  {
    id: "seed-phoenix-mark",
    title: "Phoenix Mark",
    description: "A rebirth, in one line.",
    creator: "vectorkid",
    category: "logo",
    style: "Minimalist",
    subject: "Creature",
    aspect: "square",
    prompt:
      "Phoenix emblem logo made of flowing flame lines rising from a circle, gold gradient on deep black background, flat vector, symmetrical composition, premium brand mark, clean negative space",
    age: 0.70,
  },
  {
    id: "seed-fly-poster",
    title: "FLY",
    description: "A drop poster that shatters.",
    creator: "inkfoundry",
    category: "poster",
    style: "Brutalist",
    subject: "Object",
    aspect: "portrait",
    prompt:
      "Explosive sneaker launch poster, a neon basketball sneaker bursting through shattered glass with paint splashes, huge bold condensed letters reading FLY, high contrast, acid yellow and black, dynamic composition",
    age: 0.75,
  },
];

export const SEED_DIR = "/image-studio/inspire/seed";

export function seedSize(aspect: SeedSpec["aspect"]): { width: number; height: number } {
  if (aspect === "portrait") return { width: 832, height: 1216 };
  if (aspect === "landscape") return { width: 1216, height: 832 };
  if (aspect === "wide") return { width: 1344, height: 768 };
  return { width: 1024, height: 1024 };
}
