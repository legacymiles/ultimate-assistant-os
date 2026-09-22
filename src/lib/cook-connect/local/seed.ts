"use client";

// The demo world.
//
// Against real Supabase, Cook Connect starts genuinely empty — the first
// person to sign up sees their own blank slate. Demo mode cannot do that and
// still be worth looking at: an empty feed, an empty directory and two empty
// leaderboards teach nothing. So without keys we seed six members who already
// have cookbooks, saves, follows and a season of finished matches behind them,
// and the guest joins a community that is already running.

import { recipeImageUrl } from "@/components/cookbook/imageGen";
import { loadDB, saveDB, uuid, nowIso, userIdForEmail, type Row } from "./db";

export const demoEmail = (key: string) => `${key}@cookconnect.local`;
export const demoId = (key: string) => userIdForEmail(demoEmail(key));

interface SeedRecipe {
  title: string;
  description: string;
  tags: string[];
  prep: number;
  cook: number;
}

interface SeedMember {
  key: string;
  name: string;
  handle: string;
  city: string;
  bio: string;
  cookbook: string;
  cookbookDesc: string;
  recipes: SeedRecipe[];
  /** Finished match results, oldest first — drives the players leaderboard. */
  spades: ("win" | "loss")[];
  chess: ("win" | "loss" | "draw")[];
}

const MEMBERS: SeedMember[] = [
  {
    key: "aiko", name: "Aiko Tanaka", handle: "aiko", city: "Tokyo",
    bio: "Ramen obsessive. I will bid nil on anything.",
    cookbook: "Tokyo Noodle Bar", cookbookDesc: "Slurp-worthy ramen and noodle bowls, built for a weeknight.",
    recipes: [
      { title: "Tonkotsu Ramen", description: "Rich pork-bone broth with springy noodles and chashu.", tags: ["dinner", "pork", "Japanese"], prep: 30, cook: 480 },
      { title: "Cold Soba Noodles", description: "Chilled buckwheat noodles with a savoury dipping sauce.", tags: ["lunch", "vegetarian", "Japanese"], prep: 10, cook: 8 },
      { title: "Shoyu Tare", description: "The soy base every bowl in this book is built on.", tags: ["basics", "Japanese"], prep: 5, cook: 25 },
    ],
    spades: ["win", "win", "loss", "win", "win", "win", "loss"],
    chess: ["win", "draw", "win", "loss"],
  },
  {
    key: "marco", name: "Marco Rossi", handle: "marco", city: "Bologna",
    bio: "Nonna-approved. Chess between courses.",
    cookbook: "Cucina di Nonna", cookbookDesc: "Classic Italian comfort food from my grandmother's kitchen.",
    recipes: [
      { title: "Spaghetti Carbonara", description: "Silky egg and pancetta pasta. No cream, ever.", tags: ["dinner", "pork", "Italian"], prep: 10, cook: 15 },
      { title: "Ragu alla Bolognese", description: "Four hours of patience and a glass of milk.", tags: ["dinner", "beef", "Italian"], prep: 20, cook: 240 },
    ],
    spades: ["loss", "win", "loss", "loss", "win"],
    chess: ["win", "win", "win", "loss", "win", "draw"],
  },
  {
    key: "priya", name: "Priya Sharma", handle: "priya", city: "Mumbai",
    bio: "Spice-forward vegetarian cooking. Ruthless at spades.",
    cookbook: "Spice Route", cookbookDesc: "Bold vegetarian curries and street food worth the queue.",
    recipes: [
      { title: "Chana Masala", description: "Chickpeas simmered in a fragrant tomato-onion masala.", tags: ["dinner", "vegan", "Indian"], prep: 15, cook: 40 },
      { title: "Paneer Tikka", description: "Charred marinated paneer skewers.", tags: ["dinner", "vegetarian", "Indian"], prep: 20, cook: 15 },
      { title: "Pav Bhaji", description: "Buttery mashed vegetables and a soft roll.", tags: ["street food", "vegetarian", "Indian"], prep: 15, cook: 35 },
    ],
    spades: ["win", "win", "win", "win", "loss", "win", "win", "win"],
    chess: ["loss", "loss", "win"],
  },
  {
    key: "sofia", name: "Sofia Morales", handle: "sofia", city: "Mexico City",
    bio: "Salsa first, everything else second.",
    cookbook: "Mercado", cookbookDesc: "Tacos, salsas and everything that tastes better outdoors.",
    recipes: [
      { title: "Al Pastor Tacos", description: "Marinated pork with pineapple on warm corn tortillas.", tags: ["dinner", "pork", "Mexican"], prep: 25, cook: 20 },
      { title: "Salsa Verde Cruda", description: "Raw tomatillo, serrano and coriander. Two minutes.", tags: ["basics", "vegan", "Mexican"], prep: 5, cook: 0 },
    ],
    spades: ["loss", "loss", "win", "loss"],
    chess: ["win", "loss", "loss", "loss", "win"],
  },
  {
    key: "theo", name: "Theo Baptiste", handle: "theo", city: "New Orleans",
    bio: "Gumbo, and a standing spades invitation.",
    cookbook: "Sunday Pot", cookbookDesc: "One big pot, all afternoon, everybody eats.",
    recipes: [
      { title: "Chicken and Andouille Gumbo", description: "Dark roux, the trinity, and no shortcuts.", tags: ["dinner", "chicken", "Creole"], prep: 30, cook: 150 },
      { title: "Red Beans and Rice", description: "Monday food, worth making on any day.", tags: ["dinner", "pork", "Creole"], prep: 15, cook: 180 },
    ],
    spades: ["win", "win", "win", "loss", "win", "win"],
    chess: ["loss", "win"],
  },
  {
    key: "nadia", name: "Nadia Haddad", handle: "nadia", city: "Beirut",
    bio: "Mezze for twelve, always.",
    cookbook: "The Long Table", cookbookDesc: "Mezze, grills and everything meant to be shared.",
    recipes: [
      { title: "Muhammara", description: "Roasted red pepper and walnut, sharp with pomegranate.", tags: ["mezze", "vegan", "Lebanese"], prep: 15, cook: 25 },
      { title: "Chicken Shish Taouk", description: "Yoghurt-garlic marinade, hot grill, soft flatbread.", tags: ["dinner", "chicken", "Lebanese"], prep: 20, cook: 12 },
    ],
    spades: ["loss", "win", "loss"],
    chess: ["draw", "win", "win", "win", "loss", "win"],
  },
];

function makeRecipe(cookbookId: string, authorId: string, r: SeedRecipe, position: number): Row {
  return {
    id: uuid(),
    cookbook_id: cookbookId,
    author_id: authorId,
    title: r.title,
    description: r.description,
    ingredients: [
      { name: "main ingredient", amount: "500", unit: "g" },
      { name: "aromatics", amount: "2", unit: "tbsp" },
      { name: "seasoning", amount: "1", unit: "tsp" },
      { name: "fresh garnish", amount: "2", unit: "tbsp" },
    ],
    instructions: [
      { step: 1, text: "Prepare and measure everything before the pan goes on." },
      { step: 2, text: "Build the base: aromatics first, then the main ingredient." },
      { step: 3, text: "Cook until done, tasting and seasoning as you go." },
      { step: 4, text: "Finish with the garnish and serve straight away." },
    ],
    tags: r.tags,
    image_url: recipeImageUrl(r.title, r.description),
    prep_time: r.prep,
    cook_time: r.cook,
    servings: 4,
    position,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
}

/** Back-date a result so the feed and streaks read as a season, not one moment. */
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

export function seedDemoWorld() {
  const db = loadDB();
  const profiles = (db.profiles ||= []);
  if (profiles.some((p) => p.handle === "aiko")) return; // already seeded

  const cookbooks = (db.cookbooks ||= []);
  const recipes = (db.recipes ||= []);
  const saves = (db.cookbook_saves ||= []);
  const follows = (db.follows ||= []);
  const matches = (db.matches ||= []);
  const matchPlayers = (db.match_players ||= []);
  const activity = (db.activity ||= []);
  const messages = (db.messages ||= []);

  const cookbookIdFor: Record<string, string> = {};
  let day = 60;

  for (const m of MEMBERS) {
    const uid = demoId(m.key);
    profiles.push({
      id: uid, handle: m.handle, display_name: m.name, avatar_url: null,
      bio: m.bio, city: m.city, created_at: daysAgo(day),
    });

    const cbId = uuid();
    cookbookIdFor[m.key] = cbId;
    cookbooks.push({
      id: cbId, owner_id: uid, title: m.cookbook, description: m.cookbookDesc,
      cover_url: null, privacy: "public", created_at: daysAgo(day - 1), updated_at: daysAgo(day - 1),
    });
    activity.push({
      id: uuid(), kind: "cookbook_published", actor_id: uid, subject_id: cbId,
      summary: `published ${m.cookbook}`, created_at: daysAgo(day - 1),
    });

    m.recipes.forEach((r, i) => {
      recipes.push(makeRecipe(cbId, uid, r, i));
      activity.push({
        id: uuid(), kind: "recipe_added", actor_id: uid, subject_id: cbId,
        summary: `added ${r.title} to ${m.cookbook}`, created_at: daysAgo(day - 2 - i),
      });
    });
    day -= 6;
  }

  // Saves. Priya's book is the community favourite; Aiko's is close behind.
  const save = (bookKey: string, byKeys: string[]) => {
    byKeys.forEach((k, i) => {
      saves.push({
        id: uuid(), cookbook_id: cookbookIdFor[bookKey], user_id: demoId(k),
        created_at: daysAgo(20 - i),
      });
      activity.push({
        id: uuid(), kind: "cookbook_saved", actor_id: demoId(k), subject_id: cookbookIdFor[bookKey],
        summary: `saved ${MEMBERS.find((m) => m.key === bookKey)!.cookbook}`, created_at: daysAgo(20 - i),
      });
    });
  };
  save("priya", ["aiko", "marco", "sofia", "theo", "nadia"]);
  save("aiko", ["marco", "priya", "sofia", "theo"]);
  save("theo", ["aiko", "sofia", "nadia"]);
  save("marco", ["aiko", "nadia"]);
  save("nadia", ["priya", "theo"]);
  save("sofia", ["marco"]);

  const follow = (from: string, to: string) =>
    follows.push({ id: uuid(), follower_id: demoId(from), following_id: demoId(to), created_at: daysAgo(30) });
  follow("aiko", "marco"); follow("aiko", "priya"); follow("aiko", "theo");
  follow("marco", "aiko"); follow("marco", "nadia");
  follow("priya", "aiko"); follow("priya", "sofia"); follow("priya", "theo");
  follow("sofia", "marco"); follow("sofia", "priya");
  follow("theo", "aiko"); follow("theo", "nadia");
  follow("nadia", "priya"); follow("nadia", "theo");

  // Finished matches. Each result gets its own match row so the leaderboard is
  // computed from the record rather than from a stored tally.
  let matchDay = 45;
  for (const m of MEMBERS) {
    const uid = demoId(m.key);
    const record: [("spades" | "chess"), ("win" | "loss" | "draw")][] = [
      ...m.spades.map((r) => ["spades", r] as ["spades", "win" | "loss"]),
      ...m.chess.map((r) => ["chess", r] as ["chess", "win" | "loss" | "draw"]),
    ];
    for (const [game, result] of record) {
      const matchId = uuid();
      const when = daysAgo(matchDay);
      matchDay = Math.max(1, matchDay - 1);
      matches.push({
        id: matchId, game, status: "done", created_by: uid,
        winner_id: result === "win" ? uid : null,
        winning_team: null, is_public: true,
        created_at: when, updated_at: when, finished_at: when,
      });
      matchPlayers.push({
        id: uuid(), match_id: matchId, user_id: uid, seat: 0,
        team: game === "spades" ? 1 : null, is_bot: false, result,
      });
      if (result === "win") {
        activity.push({
          id: uuid(), kind: "match_won", actor_id: uid, subject_id: matchId,
          summary: `won a game of ${game}`, created_at: when,
        });
      }
    }
  }

  messages.push(
    { id: uuid(), room: "lounge", user_id: demoId("theo"), content: "Gumbo is on. Who is up for spades in twenty?", created_at: daysAgo(1) },
    { id: uuid(), room: "lounge", user_id: demoId("priya"), content: "In. Bringing the chana masala recipe you asked for.", created_at: daysAgo(1) },
    { id: uuid(), room: "lounge", user_id: demoId("marco"), content: "I will take the loser at chess afterwards.", created_at: daysAgo(1) },
  );

  saveDB(db);
}

/** The guest's own starter cookbook, so their profile is not blank either. */
export function seedGuest(userId: string, displayName: string) {
  const db = loadDB();
  const cookbooks = (db.cookbooks ||= []);
  if (cookbooks.some((c) => c.owner_id === userId)) return;

  const cbId = uuid();
  cookbooks.push({
    id: cbId, owner_id: userId, title: "My Weeknight Dinners",
    description: "Quick, satisfying meals for busy evenings.",
    cover_url: null, privacy: "public", created_at: nowIso(), updated_at: nowIso(),
  });
  const recipes = (db.recipes ||= []);
  recipes.push(
    makeRecipe(cbId, userId, {
      title: "Garlic Butter Chicken",
      description: "Juicy pan-seared chicken in a rich garlic butter sauce.",
      tags: ["dinner", "chicken"], prep: 10, cook: 20,
    }, 0),
  );
  (db.activity ||= []).push({
    id: uuid(), kind: "cookbook_published", actor_id: userId, subject_id: cbId,
    summary: `published My Weeknight Dinners`, created_at: nowIso(),
  });
  saveDB(db);
  void displayName;
}
