"use client";

// The food journal, and the city restaurant board built out of it.
//
// A journal entry is personal — the places you liked, in the cities you liked
// them in. The board is what falls out when everybody's entries are counted
// together: the restaurants the most different people have written down.
// Dishes never take part; they stay private to whoever logged them.

import type {
  CityStanding, FavoriteCity, FavoriteDish, FavoriteRestaurant, RestaurantStanding,
} from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Backend = any;

export async function loadJournal(sb: Backend, userId: string) {
  const [cities, restaurants, dishes] = await Promise.all([
    sb.from("favorite_cities").select("*").eq("user_id", userId).order("name"),
    sb.from("favorite_restaurants").select("*").eq("user_id", userId).order("name"),
    sb.from("favorite_dishes").select("*").eq("user_id", userId).order("name"),
  ]);
  return {
    cities: (cities.data ?? []) as FavoriteCity[],
    restaurants: (restaurants.data ?? []) as FavoriteRestaurant[],
    dishes: (dishes.data ?? []) as FavoriteDish[],
  };
}

export async function addCity(sb: Backend, userId: string, name: string, country?: string) {
  const { data, error } = await sb.from("favorite_cities")
    .insert({ user_id: userId, name: name.trim(), country: country?.trim() || null })
    .select("*").single();
  return { city: data as FavoriteCity | null, error };
}

export async function addRestaurant(
  sb: Backend,
  userId: string,
  entry: { cityId: string; name: string; cuisine?: string; rating?: number; notes?: string },
) {
  const { data, error } = await sb.from("favorite_restaurants").insert({
    user_id: userId,
    city_id: entry.cityId,
    name: entry.name.trim(),
    cuisine_type: entry.cuisine?.trim() || null,
    rating: entry.rating ?? null,
    notes: entry.notes?.trim() || null,
  }).select("*").single();
  return { restaurant: data as FavoriteRestaurant | null, error };
}

export async function addDish(
  sb: Backend,
  userId: string,
  entry: { restaurantId?: string | null; name: string; rating?: number; notes?: string },
) {
  const { data, error } = await sb.from("favorite_dishes").insert({
    user_id: userId,
    restaurant_id: entry.restaurantId ?? null,
    name: entry.name.trim(),
    rating: entry.rating ?? null,
    notes: entry.notes?.trim() || null,
  }).select("*").single();
  return { dish: data as FavoriteDish | null, error };
}

export async function removeFrom(sb: Backend, table: string, id: string) {
  await sb.from(table).delete().eq("id", id);
}

/**
 * The city board. Restaurants are matched on a normalised name within a
 * normalised city, so "Katz's Delicatessen" and "katzs delicatessen" in
 * "New York" and "new york " count as one place with two fans.
 */
export function buildCityBoard(
  cities: FavoriteCity[],
  restaurants: FavoriteRestaurant[],
): CityStanding[] {
  const cityById = new Map(cities.map((c) => [c.id, c]));
  // Apostrophes are dropped rather than turned into a separator, so "Katz's"
  // and "Katzs" are the same place. Everything else collapses to one space.
  const key = (s: string) => s
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  interface Bucket {
    city: string;
    name: string;
    cuisine: string | null;
    fans: Set<string>;
    ratings: number[];
  }
  const buckets = new Map<string, Bucket>();

  for (const r of restaurants) {
    const city = cityById.get(r.city_id);
    if (!city) continue;
    const id = `${key(city.name)}::${key(r.name)}`;
    let bucket = buckets.get(id);
    if (!bucket) {
      bucket = { city: city.name.trim(), name: r.name.trim(), cuisine: r.cuisine_type, fans: new Set(), ratings: [] };
      buckets.set(id, bucket);
    }
    bucket.fans.add(r.user_id);
    if (r.rating) bucket.ratings.push(r.rating);
    if (!bucket.cuisine && r.cuisine_type) bucket.cuisine = r.cuisine_type;
  }

  const byCity = new Map<string, RestaurantStanding[]>();
  for (const b of buckets.values()) {
    const standing: RestaurantStanding = {
      name: b.name,
      city: b.city,
      cuisine: b.cuisine,
      fans: b.fans.size,
      avgRating: b.ratings.length
        ? Math.round((b.ratings.reduce((a, n) => a + n, 0) / b.ratings.length) * 10) / 10
        : 0,
    };
    const list = byCity.get(key(b.city));
    if (list) list.push(standing);
    else byCity.set(key(b.city), [standing]);
  }

  return [...byCity.values()]
    .map((list) => ({
      city: list[0].city,
      // Most people first, then the better rating, then alphabetical.
      restaurants: list.sort((a, b) => (
        b.fans - a.fans || b.avgRating - a.avgRating || a.name.localeCompare(b.name)
      )),
      fans: list.reduce((a, r) => a + r.fans, 0),
    }))
    .sort((a, b) => b.fans - a.fans || a.city.localeCompare(b.city));
}

/** The board across everybody, not just this user. */
export async function loadCityBoard(sb: Backend): Promise<CityStanding[]> {
  const [cities, restaurants] = await Promise.all([
    sb.from("favorite_cities").select("*"),
    sb.from("favorite_restaurants").select("*"),
  ]);
  return buildCityBoard(
    (cities.data ?? []) as FavoriteCity[],
    (restaurants.data ?? []) as FavoriteRestaurant[],
  );
}
