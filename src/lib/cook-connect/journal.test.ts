import { describe, it, expect } from "vitest";
import { buildCityBoard } from "./journal";
import type { FavoriteCity, FavoriteRestaurant } from "./types";

let seq = 0;
const city = (userId: string, name: string): FavoriteCity => ({
  id: `city-${++seq}`, user_id: userId, name, country: null, notes: null, created_at: "",
});
const resto = (
  userId: string, cityId: string, name: string, rating?: number, cuisine?: string,
): FavoriteRestaurant => ({
  id: `r-${++seq}`, user_id: userId, city_id: cityId, name,
  cuisine_type: cuisine ?? null, rating: rating ?? null, notes: null, created_at: "",
});

describe("the city restaurant board", () => {
  it("counts one fan per person for a place", () => {
    const a = city("ann", "Tokyo");
    const b = city("bob", "Tokyo");
    const board = buildCityBoard([a, b], [
      resto("ann", a.id, "Ichiran", 5),
      resto("bob", b.id, "Ichiran", 4),
    ]);
    expect(board).toHaveLength(1);
    expect(board[0].city).toBe("Tokyo");
    expect(board[0].restaurants[0].fans).toBe(2);
  });

  it("does not let one person be two fans of the same place", () => {
    const a = city("ann", "Tokyo");
    const board = buildCityBoard([a], [
      resto("ann", a.id, "Ichiran", 5),
      resto("ann", a.id, "Ichiran", 3),
    ]);
    expect(board[0].restaurants[0].fans).toBe(1);
  });

  it("matches places whose names and cities are written differently", () => {
    const a = city("ann", "New York");
    const b = city("bob", "new york ");
    const board = buildCityBoard([a, b], [
      resto("ann", a.id, "Katz's Delicatessen"),
      resto("bob", b.id, "katzs delicatessen"),
    ]);
    expect(board).toHaveLength(1);
    expect(board[0].restaurants).toHaveLength(1);
    expect(board[0].restaurants[0].fans).toBe(2);
  });

  it("keeps the same name in different cities apart", () => {
    const a = city("ann", "Tokyo");
    const b = city("bob", "Osaka");
    const board = buildCityBoard([a, b], [
      resto("ann", a.id, "Ichiran"),
      resto("bob", b.id, "Ichiran"),
    ]);
    expect(board).toHaveLength(2);
  });

  it("averages the ratings it was given and ignores the blanks", () => {
    const a = city("ann", "Paris");
    const b = city("bob", "Paris");
    const c = city("cat", "Paris");
    const board = buildCityBoard([a, b, c], [
      resto("ann", a.id, "Septime", 5),
      resto("bob", b.id, "Septime", 4),
      resto("cat", c.id, "Septime"),
    ]);
    expect(board[0].restaurants[0].avgRating).toBe(4.5);
    expect(board[0].restaurants[0].fans).toBe(3);
  });

  it("ranks the most-loved place in a city first", () => {
    const a = city("ann", "Rome");
    const b = city("bob", "Rome");
    const board = buildCityBoard([a, b], [
      resto("ann", a.id, "Quiet Place", 5),
      resto("ann", a.id, "Busy Place"),
      resto("bob", b.id, "Busy Place"),
    ]);
    expect(board[0].restaurants.map((r) => r.name)).toEqual(["Busy Place", "Quiet Place"]);
  });

  it("ranks cities by how many entries they carry", () => {
    const a = city("ann", "Rome");
    const b = city("ann", "Lima");
    const c = city("bob", "Lima");
    const board = buildCityBoard([a, b, c], [
      resto("ann", a.id, "One"),
      resto("ann", b.id, "Two"),
      resto("bob", c.id, "Two"),
    ]);
    expect(board[0].city).toBe("Lima");
  });

  it("picks up a cuisine from whichever entry recorded one", () => {
    const a = city("ann", "Seoul");
    const b = city("bob", "Seoul");
    const board = buildCityBoard([a, b], [
      resto("ann", a.id, "Jungsik"),
      resto("bob", b.id, "Jungsik", 5, "Korean"),
    ]);
    expect(board[0].restaurants[0].cuisine).toBe("Korean");
  });

  it("drops a restaurant whose city is gone rather than inventing one", () => {
    const board = buildCityBoard([], [resto("ann", "missing-city", "Nowhere")]);
    expect(board).toEqual([]);
  });

  it("returns nothing for an empty journal", () => {
    expect(buildCityBoard([], [])).toEqual([]);
  });
});
