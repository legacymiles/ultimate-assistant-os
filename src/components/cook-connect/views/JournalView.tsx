"use client";

// The food journal: the cities you have eaten in, the places worth going back
// to, and the dishes you do not want to forget. Cities and restaurants feed
// the city board on Leaderboards; dishes stay yours alone.

import { useCallback, useEffect, useState } from "react";
import { useCook } from "../CookConnect";
import { Columns, PageHead } from "../Columns";
import { addCity, addDish, addRestaurant, buildCityBoard, loadJournal, removeFrom } from "@/lib/cook-connect/journal";
import type { FavoriteCity, FavoriteDish, FavoriteRestaurant } from "@/lib/cook-connect/types";
import {
  Button, EmptyState, Field, Input, Loading, Panel, SectionHead, Select, Tag, cx,
} from "../ui";
import { BookIcon, CloseIcon, PlusIcon, TrophyIcon } from "../icons";

export function JournalView() {
  const { sb, userId, navigate, notify } = useCook();
  const [cities, setCities] = useState<FavoriteCity[]>([]);
  const [restaurants, setRestaurants] = useState<FavoriteRestaurant[]>([]);
  const [dishes, setDishes] = useState<FavoriteDish[]>([]);
  const [loading, setLoading] = useState(true);
  const [openCity, setOpenCity] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    const j = await loadJournal(sb, userId);
    setCities(j.cities);
    setRestaurants(j.restaurants);
    setDishes(j.dishes);
    setOpenCity((prev) => prev ?? j.cities[0]?.id ?? null);
    setLoading(false);
  }, [sb, userId]);

  useEffect(() => { void load(); }, [load]);

  const myBoard = buildCityBoard(cities, restaurants);

  if (loading) return <Columns><Loading label="Opening your journal" /></Columns>;

  return (
    <Columns rail={<JournalRail cities={cities} restaurants={restaurants} dishes={dishes} board={myBoard} />}>
      <PageHead
        title="Journal"
        subtitle="Where you have eaten and what was worth it. Cities and restaurants count towards the city board everyone shares; the dishes you write down stay private."
      />

      <AddCity
        onAdd={async (name, country) => {
          if (!userId) return;
          const { city, error } = await addCity(sb, userId, name, country);
          if (error) { notify(`Could not add ${name}: ${error.message}`); return; }
          notify(`${name} added.`);
          if (city) setOpenCity(city.id);
          await load();
        }}
      />

      {cities.length === 0 ? (
        <Panel className="mt-4">
          <EmptyState
            icon={<BookIcon size={26} />}
            title="Nothing written down yet"
            body="Start with a city you have eaten well in. Then add the places, and the plates you would order again."
          />
        </Panel>
      ) : (
        <div className="mt-4 space-y-3">
          {cities.map((city) => {
            const here = restaurants.filter((r) => r.city_id === city.id);
            const open = openCity === city.id;
            return (
              <Panel key={city.id}>
                <div className="flex items-center justify-between gap-3 border-b border-[var(--cc-line)] px-3 py-2">
                  <button
                    type="button"
                    onClick={() => setOpenCity(open ? null : city.id)}
                    aria-expanded={open}
                    className="flex min-w-0 flex-1 items-baseline gap-2 text-left"
                  >
                    <span className="text-[14px] font-semibold">{city.name}</span>
                    {city.country && (
                      <span className="text-[11px] text-[var(--cc-ink-faint)]">{city.country}</span>
                    )}
                    <span className="cc-num text-[11px] text-[var(--cc-ink-faint)]">
                      {here.length} place{here.length === 1 ? "" : "s"}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await removeFrom(sb, "favorite_cities", city.id);
                      notify(`${city.name} removed.`);
                      await load();
                    }}
                    aria-label={`Remove ${city.name}`}
                    className="shrink-0 rounded-md p-1 text-[var(--cc-ink-faint)] transition-colors hover:text-[var(--cc-loss)]"
                  >
                    <CloseIcon size={14} />
                  </button>
                </div>

                {open && (
                  <>
                    {here.length > 0 && (
                      <ul>
                        {here.map((r, i) => {
                          const theirDishes = dishes.filter((d) => d.restaurant_id === r.id);
                          return (
                            <li
                              key={r.id}
                              className={cx("px-3 py-2", i > 0 && "border-t border-[var(--cc-line-soft)]")}
                            >
                              <div className="flex items-center gap-3">
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-[13px] font-semibold">{r.name}</span>
                                  <span className="block truncate text-[11px] text-[var(--cc-ink-faint)]">
                                    {r.cuisine_type ?? "—"}
                                    {r.notes && <span className="text-[var(--cc-ink-muted)]"> · {r.notes}</span>}
                                  </span>
                                </span>
                                <Stars rating={r.rating} />
                                <button
                                  type="button"
                                  onClick={async () => {
                                    await removeFrom(sb, "favorite_restaurants", r.id);
                                    await load();
                                  }}
                                  aria-label={`Remove ${r.name}`}
                                  className="shrink-0 rounded-md p-1 text-[var(--cc-ink-faint)] transition-colors hover:text-[var(--cc-loss)]"
                                >
                                  <CloseIcon size={13} />
                                </button>
                              </div>

                              {theirDishes.length > 0 && (
                                <ul className="mt-1 flex flex-wrap gap-1 pl-1">
                                  {theirDishes.map((d) => (
                                    <li key={d.id}>
                                      <button
                                        type="button"
                                        onClick={async () => {
                                          await removeFrom(sb, "favorite_dishes", d.id);
                                          await load();
                                        }}
                                        title={d.notes ?? "Remove"}
                                        className="inline-flex items-center gap-1 rounded-md border border-[#4a2e17]
                                                   bg-[var(--cc-ember-wash)] px-1.5 py-0.5 text-[11px] text-[var(--cc-ember)]
                                                   transition-colors hover:border-[var(--cc-loss)] hover:text-[var(--cc-loss)]"
                                      >
                                        {d.name}
                                        <CloseIcon size={10} />
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              )}

                              <AddDish
                                onAdd={async (name, rating) => {
                                  if (!userId) return;
                                  await addDish(sb, userId, { restaurantId: r.id, name, rating });
                                  await load();
                                }}
                              />
                            </li>
                          );
                        })}
                      </ul>
                    )}

                    <AddRestaurant
                      onAdd={async (entry) => {
                        if (!userId) return;
                        const { error } = await addRestaurant(sb, userId, { ...entry, cityId: city.id });
                        if (error) { notify(`Could not add it: ${error.message}`); return; }
                        await load();
                      }}
                    />
                  </>
                )}
              </Panel>
            );
          })}
        </div>
      )}

      <p className="mt-4 text-[12px] leading-relaxed text-[var(--cc-ink-faint)]">
        The places you log count towards the{" "}
        <button
          type="button"
          onClick={() => navigate({ page: "leaderboards" })}
          className="font-semibold text-[var(--cc-ember)] underline underline-offset-2"
        >
          city board
        </button>
        , which ranks a city&rsquo;s restaurants by how many different people have written them down.
      </p>
    </Columns>
  );
}

/* ── Pieces ────────────────────────────────────────────────────── */

function Stars({ rating }: { rating: number | null }) {
  if (!rating) return <span className="cc-num w-[54px] shrink-0 text-right text-[11px] text-[var(--cc-ink-faint)]">—</span>;
  return (
    <span className="w-[54px] shrink-0 text-right" title={`${rating} out of 5`}>
      <span className="cc-num text-[12px] font-semibold text-[var(--cc-gold)]">{rating}</span>
      <span className="text-[11px] text-[var(--cc-ink-faint)]">/5</span>
    </span>
  );
}

function AddCity({ onAdd }: { onAdd: (name: string, country?: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [country, setCountry] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    await onAdd(name, country);
    setName("");
    setCountry("");
    setBusy(false);
  };

  return (
    <Panel>
      <SectionHead title="Add a city" />
      <div className="flex flex-wrap items-end gap-2 p-3">
        <div className="min-w-[160px] flex-1">
          <Field label="City">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
              placeholder="Lisbon"
            />
          </Field>
        </div>
        <div className="w-[160px]">
          <Field label="Country">
            <Input
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
              placeholder="Portugal"
            />
          </Field>
        </div>
        <Button variant="primary" disabled={!name.trim() || busy} onClick={() => void submit()}>
          <PlusIcon size={14} />
          Add
        </Button>
      </div>
    </Panel>
  );
}

function AddRestaurant({
  onAdd,
}: { onAdd: (entry: { name: string; cuisine?: string; rating?: number; notes?: string }) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [cuisine, setCuisine] = useState("");
  const [rating, setRating] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    await onAdd({ name, cuisine, rating: rating ? Number(rating) : undefined, notes });
    setName(""); setCuisine(""); setRating(""); setNotes("");
    setBusy(false);
    setOpen(false);
  };

  if (!open) {
    return (
      <div className="border-t border-[var(--cc-line-soft)] p-2">
        <Button variant="ghost" onClick={() => setOpen(true)}>
          <PlusIcon size={13} />
          Add a place
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-end gap-2 border-t border-[var(--cc-line-soft)] bg-[var(--cc-panel-2)] p-3">
      <div className="min-w-[150px] flex-1">
        <Field label="Restaurant">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
            placeholder="Cervejaria Ramiro"
            autoFocus
          />
        </Field>
      </div>
      <div className="w-[130px]">
        <Field label="Cuisine">
          <Input value={cuisine} onChange={(e) => setCuisine(e.target.value)} placeholder="Seafood" />
        </Field>
      </div>
      <div className="w-[90px]">
        <Field label="Rating">
          <Select value={rating} onChange={(e) => setRating(e.target.value)}>
            <option value="">—</option>
            {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} / 5</option>)}
          </Select>
        </Field>
      </div>
      <div className="min-w-[150px] flex-1">
        <Field label="Note">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Go early, the queue is real" />
        </Field>
      </div>
      <Button variant="primary" disabled={!name.trim() || busy} onClick={() => void submit()}>Add</Button>
      <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
    </div>
  );
}

function AddDish({ onAdd }: { onAdd: (name: string, rating?: number) => Promise<void> }) {
  const [name, setName] = useState("");

  const submit = async () => {
    if (!name.trim()) return;
    await onAdd(name);
    setName("");
  };

  return (
    <div className="mt-1.5 flex items-center gap-1.5 pl-1">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
        placeholder="A dish worth remembering…"
        aria-label="Add a dish"
        className="h-7 py-0 text-[12px]"
      />
      <Button variant="ghost" disabled={!name.trim()} onClick={() => void submit()}>Add</Button>
    </div>
  );
}

function JournalRail({
  cities, restaurants, dishes, board,
}: {
  cities: FavoriteCity[];
  restaurants: FavoriteRestaurant[];
  dishes: FavoriteDish[];
  board: ReturnType<typeof buildCityBoard>;
}) {
  return (
    <>
      <Panel>
        <SectionHead title="Your journal" />
        <dl className="space-y-1.5 p-3 text-[12px]">
          {[
            ["Cities", cities.length],
            ["Restaurants", restaurants.length],
            ["Dishes", dishes.length],
          ].map(([label, n]) => (
            <div key={String(label)} className="flex items-baseline justify-between gap-3">
              <dt className="text-[var(--cc-ink-muted)]">{label}</dt>
              <dd className="cc-num font-semibold">{n}</dd>
            </div>
          ))}
        </dl>
      </Panel>

      {board.length > 0 && (
        <Panel>
          <SectionHead title="Your best of" />
          <ul>
            {board.slice(0, 5).map((city, i) => (
              <li
                key={city.city}
                className={cx("px-3 py-2", i > 0 && "border-t border-[var(--cc-line-soft)]")}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[12px] font-semibold">{city.city}</span>
                  <span className="cc-num shrink-0 text-[11px] text-[var(--cc-ink-faint)]">
                    {city.restaurants.length}
                  </span>
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[var(--cc-ink-muted)]">
                  <TrophyIcon size={11} />
                  <span className="truncate">{city.restaurants[0]?.name}</span>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel>
        <SectionHead title="Why this exists" />
        <p className="px-3 py-3 text-[12px] leading-relaxed text-[var(--cc-ink-muted)]">
          <Tag>Shared</Tag> Cities and restaurants are readable by everyone, so a place several
          people love rises on the city board. <Tag>Private</Tag> Dishes are only ever yours.
        </p>
      </Panel>
    </>
  );
}
