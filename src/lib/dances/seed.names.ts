// ---------------------------------------------------------------------------
// The editorial layer of the seed.
//
// This file holds what a resolver CANNOT produce: the name people actually say,
// the song it is set to, who choreographed it, and how hard it is. A YouTube
// search result gives none of that reliably — its title is whatever the
// uploader typed.
//
// It holds NO video links. Links are resolved and verified by
// `scripts/dances-resolve.mjs`, which writes `seed.generated.ts`. A name here
// that resolves to nothing playable is dropped rather than shipped as an empty
// tile.
//
// Facts left unknown are left absent. An empty field is honest; a guessed
// choreographer credit is not, and mis-crediting a dance is the one mistake
// this app must never make.
// ---------------------------------------------------------------------------

export interface SeedDance {
  name: string;
  aka?: string[];
  song?: string;
  artist?: string;
  /** The choreographer, where it is genuinely documented. */
  creator?: string;
  /** The year it broke, not the year the song came out. */
  year?: number;
  tags: string[];
  /** 1 = anyone can do it, 5 = you cannot do it. */
  difficulty?: number;
  /**
   * Search override. The default query is `<name> tiktok dance`, which is
   * ambiguous for one-word names — "Maps" and "Apple" and "Disco" all collide
   * with the rest of the internet.
   */
  query?: string;
}

export const SEED_NAMES: SeedDance[] = [
  // --- currently trending -------------------------------------------------
  {
    name: "Não Percibi",
    aka: ["Nao Percibi"],
    song: "Não Percibi",
    year: 2026,
    tags: ["trend-2026", "budots", "footwork"],
    difficulty: 3,
    query: "Nao Percibi tiktok dance trend",
  },
  {
    name: "Chiki Sha",
    song: "Chiki Sha",
    year: 2026,
    tags: ["trend-2026", "brazil", "group"],
    difficulty: 2,
    query: "Chiki Sha brazil dance trend tiktok",
  },
  {
    name: "Smooth Criminal Challenge",
    song: "Smooth Criminal",
    artist: "Michael Jackson",
    year: 2026,
    tags: ["trend-2026", "lean", "duo"],
    difficulty: 4,
    query: "smooth criminal tiktok dance challenge trend",
  },
  {
    name: "Face Hands Legs",
    year: 2026,
    tags: ["trend-2026", "trio", "quick-steps"],
    difficulty: 2,
    query: "face hands legs dance challenge tiktok",
  },
  {
    name: "Quiet On The Creek",
    aka: ["Cuz I Be Quiet On The Creek"],
    year: 2026,
    tags: ["trend-2026", "solo", "easy"],
    difficulty: 1,
    query: "quiet on the creek dance trend tiktok",
  },
  {
    name: "Lights On",
    aka: ["I Think It Look Better With The Lights On"],
    year: 2026,
    tags: ["trend-2026", "duo"],
    difficulty: 2,
    query: "look better with the lights on dance trend tiktok",
  },
  {
    name: "Resenha na Laje",
    year: 2026,
    tags: ["trend-2026", "brazil", "funk"],
    difficulty: 2,
    query: "Resenha na Laje dance tiktok",
  },

  // --- 2024–2025 ----------------------------------------------------------
  {
    name: "Espresso",
    song: "Espresso",
    artist: "Sabrina Carpenter",
    year: 2024,
    tags: ["pop", "arms", "summer"],
    difficulty: 2,
  },
  {
    name: "Apple",
    song: "Apple",
    artist: "Charli xcx",
    creator: "Kelley Heyer",
    year: 2024,
    tags: ["pop", "arms-only", "easy", "brat"],
    difficulty: 2,
    query: "apple dance charli xcx tiktok kelley heyer",
  },
  {
    name: "APT.",
    aka: ["Apateu"],
    song: "APT.",
    artist: "ROSÉ & Bruno Mars",
    year: 2024,
    tags: ["kpop", "duo", "easy"],
    difficulty: 2,
    query: "APT rose bruno mars dance challenge",
  },
  {
    name: "Maps",
    aka: ["Wait They Don't Love You Like I Love You"],
    song: "Maps (Jersey Club Remix)",
    artist: "Yeah Yeah Yeahs",
    creator: "@southernbellesuzie",
    year: 2025,
    tags: ["hands", "nostalgia", "jersey-club"],
    difficulty: 2,
    query: "maps jersey club dance trend tiktok hands",
  },
  {
    name: "Nasty",
    song: "Nasty",
    artist: "Tinashe",
    year: 2024,
    tags: ["rnb", "hips"],
    difficulty: 3,
    query: "nasty tinashe dance challenge tiktok",
  },
  {
    name: "Barbara's Rhubarb Bar",
    aka: ["Barbaras Rhabarberbar"],
    song: "Barbaras Rhabarberbar",
    artist: "Bodo Wartke & Marti Fischer",
    year: 2024,
    tags: ["tongue-twister", "hands", "german"],
    difficulty: 3,
    query: "Barbaras Rhabarberbar dance tiktok",
  },
  {
    name: "Emergency Budots",
    song: "Dr. Beat (Budots Remix)",
    artist: "Miami Sound Machine",
    year: 2024,
    tags: ["budots", "footwork", "philippines"],
    difficulty: 3,
    query: "emergency budots dance tiktok",
  },
  {
    name: "Alibi",
    song: "Alibi",
    artist: "Sevdaliza, Pabllo Vittar & Yseult",
    year: 2024,
    tags: ["group", "sharp"],
    difficulty: 3,
    query: "alibi sevdaliza dance challenge tiktok",
  },
  {
    name: "No Pole",
    song: "No Pole",
    artist: "Don Toliver",
    year: 2024,
    tags: ["smooth", "slow"],
    difficulty: 2,
    query: "no pole don toliver dance tiktok",
  },
  {
    name: "Hoopla",
    song: "HOOPLA",
    artist: "@kyleyoumadethat",
    year: 2024,
    tags: ["bounce", "group"],
    difficulty: 2,
    query: "hoopla dance challenge tiktok",
  },
  {
    name: "Pikki Pikki",
    year: 2025,
    tags: ["afro", "group"],
    difficulty: 2,
    query: "pikki pikki dance challenge tiktok",
  },

  // --- 2021–2023 ----------------------------------------------------------
  {
    name: "Bloody Mary",
    aka: ["Dance With Your Hands", "Wednesday Dance"],
    song: "Bloody Mary",
    artist: "Lady Gaga",
    creator: "Jenna Ortega",
    year: 2022,
    tags: ["arms-only", "goth", "iconic"],
    difficulty: 3,
    query: "wednesday bloody mary dance tiktok",
  },
  {
    name: "Bejeweled",
    song: "Bejeweled",
    artist: "Taylor Swift",
    creator: "Mikael Arellano",
    year: 2022,
    tags: ["hands", "pop"],
    difficulty: 2,
    query: "bejeweled dance mikael arellano tiktok",
  },
  {
    name: "Gimme More",
    song: "Gimme More",
    artist: "Britney Spears",
    year: 2023,
    tags: ["sharp", "pop"],
    difficulty: 3,
    query: "gimme more dance trend tiktok",
  },
  {
    name: "From Tha Back",
    song: "From Tha Back",
    artist: "lil eaarl",
    creator: "avadeblassie",
    year: 2023,
    tags: ["bounce"],
    difficulty: 3,
    query: "from tha back dance tiktok",
  },
  {
    name: "Disco",
    song: "Disco",
    artist: "Surf Curse",
    year: 2022,
    tags: ["indie", "jumpy"],
    difficulty: 2,
    query: "disco surf curse dance trend tiktok",
  },
  {
    name: "Da' Dip",
    song: "Da' Dip",
    artist: "Freak Nasty",
    year: 2023,
    tags: ["retro", "easy"],
    difficulty: 1,
    query: "da dip dance trend tiktok",
  },
  {
    name: "Woman",
    song: "Woman",
    artist: "Doja Cat",
    creator: "Tracy Joseph",
    year: 2021,
    tags: ["hips", "afro"],
    difficulty: 3,
    query: "woman doja cat dance tracy joseph tiktok",
  },
  {
    name: "Corvette Corvette",
    song: "Corvette Corvette",
    artist: "Popp Hunna",
    creator: "Yvng Homie",
    year: 2021,
    tags: ["arms", "easy"],
    difficulty: 2,
  },
  {
    name: "Fancy Like",
    song: "Fancy Like",
    artist: "Walker Hayes",
    year: 2021,
    tags: ["duo", "country", "easy"],
    difficulty: 1,
  },
  {
    name: "Whip My Hair",
    song: "Whip My Hair",
    artist: "Willow Smith",
    year: 2021,
    tags: ["hair", "energetic"],
    difficulty: 2,
    query: "whip my hair dance trend tiktok",
  },
  {
    name: "Not Around",
    song: "Not Around",
    artist: "Nova",
    creator: "famoustaytay",
    year: 2021,
    tags: ["smooth"],
    difficulty: 3,
    query: "not around dance tiktok",
  },
  {
    name: "Yeah Yeah",
    song: "Yeah Yeah",
    artist: "Young Nudy",
    creator: "JayDan McCauley",
    year: 2021,
    tags: ["sharp"],
    difficulty: 3,
    query: "yeah yeah young nudy dance tiktok",
  },
  {
    name: "Cha Cha Slide",
    song: "Cha Cha Slide",
    artist: "DJ Casper",
    year: 2021,
    tags: ["line-dance", "classic", "party"],
    difficulty: 1,
    query: "cha cha slide dance tiktok",
  },
  {
    name: "Snowman",
    song: "Snowman",
    artist: "Sia",
    year: 2021,
    tags: ["holiday", "easy"],
    difficulty: 2,
    query: "snowman sia dance challenge tiktok",
  },
  {
    name: "Jingle Bell Rock",
    song: "Jingle Bell Rock",
    artist: "Bobby Helms",
    year: 2021,
    tags: ["holiday", "group"],
    difficulty: 2,
    query: "jingle bell rock dance trend tiktok",
  },

  // --- the classics -------------------------------------------------------
  {
    name: "Renegade",
    song: "Lottery",
    artist: "K Camp",
    creator: "Jalaiah Harmon",
    year: 2019,
    tags: ["iconic", "arms", "hard"],
    difficulty: 5,
  },
  {
    name: "Savage",
    song: "Savage",
    artist: "Megan Thee Stallion",
    creator: "Keara Wilson",
    year: 2020,
    tags: ["iconic", "full-body"],
    difficulty: 4,
    query: "savage megan thee stallion dance keara wilson tiktok",
  },
  {
    name: "Say So",
    song: "Say So",
    artist: "Doja Cat",
    creator: "Haley Sharpe",
    year: 2020,
    tags: ["iconic", "retro", "arms"],
    difficulty: 3,
    query: "say so doja cat dance haley sharpe tiktok",
  },
  {
    name: "Blinding Lights",
    song: "Blinding Lights",
    artist: "The Weeknd",
    year: 2020,
    tags: ["family", "group", "easy", "iconic"],
    difficulty: 2,
    query: "blinding lights dance challenge tiktok",
  },
  {
    name: "Savage Love",
    song: "Savage Love",
    artist: "Jason Derulo & Jawsh 685",
    year: 2020,
    tags: ["easy", "arms"],
    difficulty: 2,
  },
  {
    name: "Laxed (Siren Beat)",
    aka: ["Siren Beat"],
    song: "Laxed (Siren Beat)",
    artist: "Jawsh 685",
    year: 2020,
    tags: ["culture", "group"],
    difficulty: 2,
    query: "laxed siren beat dance tiktok",
  },
  {
    name: "Supalonely",
    song: "Supalonely",
    artist: "BENEE",
    year: 2020,
    tags: ["bouncy", "easy"],
    difficulty: 2,
  },
  {
    name: "Toosie Slide",
    song: "Toosie Slide",
    artist: "Drake",
    year: 2020,
    tags: ["footwork", "easy", "iconic"],
    difficulty: 1,
  },
  {
    name: "Out West",
    song: "Out West",
    artist: "JACKBOYS & Travis Scott ft. Young Thug",
    year: 2020,
    tags: ["group", "hype"],
    difficulty: 3,
    query: "out west dance challenge tiktok",
  },
  {
    name: "WAP",
    song: "WAP",
    artist: "Cardi B ft. Megan Thee Stallion",
    creator: "Brian Esperon",
    year: 2020,
    tags: ["hard", "floor", "iconic"],
    difficulty: 5,
    query: "WAP dance challenge brian esperon tiktok",
  },
  {
    name: "The Git Up",
    song: "The Git Up",
    artist: "Blanco Brown",
    year: 2019,
    tags: ["line-dance", "country"],
    difficulty: 2,
  },
  {
    name: "Tap In",
    song: "Tap In",
    artist: "Saweetie",
    year: 2020,
    tags: ["bounce"],
    difficulty: 2,
    query: "tap in saweetie dance challenge tiktok",
  },
];
