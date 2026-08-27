"use client";

import { useState, useEffect } from "react";
import { useCookbook } from "../CookbookGenie";

interface City { id: string; name: string; country: string | null; notes: string | null }
interface Restaurant { id: string; name: string; cuisine_type: string | null; rating: number | null; notes: string | null }
interface Dish { id: string; name: string; notes: string | null }

export function FavoritesView() {
  const { sb, user } = useCookbook();
  const [cities, setCities] = useState<City[]>([]);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [selCity, setSelCity] = useState<string | null>(null);
  const [selRest, setSelRest] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [modal, setModal] = useState<"city" | "restaurant" | "dish" | null>(null);
  const [cityForm, setCityForm] = useState({ name: "", country: "", notes: "" });
  const [restForm, setRestForm] = useState({ name: "", cuisine_type: "", notes: "", rating: 5 });
  const [dishForm, setDishForm] = useState({ name: "", notes: "" });

  const loadCities = async () => {
    const { data } = await sb.from("favorite_cities").select("*").order("name");
    setCities(data || []);
    setLoading(false);
  };
  const loadRestaurants = async (cityId: string) => {
    const { data } = await sb.from("favorite_restaurants").select("*").eq("city_id", cityId).order("name");
    setRestaurants(data || []);
  };
  const loadDishes = async (restId: string) => {
    const { data } = await sb.from("favorite_dishes").select("*").eq("restaurant_id", restId).order("name");
    setDishes(data || []);
  };

  useEffect(() => { if (user) loadCities(); }, [user]);
  useEffect(() => { if (selCity) loadRestaurants(selCity); }, [selCity]);
  useEffect(() => { if (selRest) loadDishes(selRest); }, [selRest]);

  const addCity = async () => {
    if (!cityForm.name.trim() || !user) return;
    await sb.from("favorite_cities").insert({ ...cityForm, user_id: user.id });
    setCityForm({ name: "", country: "", notes: "" });
    setModal(null);
    loadCities();
  };
  const addRestaurant = async () => {
    if (!restForm.name.trim() || !user || !selCity) return;
    await sb.from("favorite_restaurants").insert({ ...restForm, city_id: selCity, user_id: user.id });
    setRestForm({ name: "", cuisine_type: "", notes: "", rating: 5 });
    setModal(null);
    loadRestaurants(selCity);
  };
  const addDish = async () => {
    if (!dishForm.name.trim() || !user || !selRest) return;
    await sb.from("favorite_dishes").insert({ ...dishForm, restaurant_id: selRest, user_id: user.id });
    setDishForm({ name: "", notes: "" });
    setModal(null);
    loadDishes(selRest);
  };
  const delCity = async (id: string) => { await sb.from("favorite_cities").delete().eq("id", id); if (selCity === id) { setSelCity(null); setSelRest(null); } loadCities(); };
  const delRest = async (id: string) => { await sb.from("favorite_restaurants").delete().eq("id", id); if (selRest === id) setSelRest(null); if (selCity) loadRestaurants(selCity); };
  const delDish = async (id: string) => { await sb.from("favorite_dishes").delete().eq("id", id); if (selRest) loadDishes(selRest); };

  const cityData = cities.find((c) => c.id === selCity);
  const restData = restaurants.find((r) => r.id === selRest);

  const stars = (n: number) => (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => <StarIcon key={i} filled={i <= n} />)}
    </div>
  );

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-8 flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#e67e22]/10"><MapPinIcon /></div>
        <div>
          <h1 className="text-2xl font-bold" style={{ fontFamily: "Georgia, serif" }}>Favorite Places</h1>
          <p className="text-sm text-ink-muted">Your personal food journal — cities, restaurants &amp; dishes</p>
        </div>
      </div>

      {/* Breadcrumb */}
      {(selCity || selRest) && (
        <div className="mb-6 flex items-center gap-2 text-sm">
          <button onClick={() => { setSelCity(null); setSelRest(null); }} className="text-[#e67e22] hover:underline">Cities</button>
          {selCity && (<>
            <span className="text-ink-muted">/</span>
            <button onClick={() => setSelRest(null)} className={selRest ? "text-[#e67e22] hover:underline" : "font-medium"}>{cityData?.name}</button>
          </>)}
          {selRest && (<>
            <span className="text-ink-muted">/</span>
            <span className="font-medium">{restData?.name}</span>
          </>)}
        </div>
      )}

      {/* Cities view */}
      {!selCity && (
        <>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold" style={{ fontFamily: "Georgia, serif" }}>My Cities</h2>
            <button onClick={() => setModal("city")} className="flex items-center gap-1 rounded-lg bg-[#e67e22] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#d35400]"><PlusIcon /> Add City</button>
          </div>
          {loading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{[1, 2, 3].map((i) => <div key={i} className="h-28 animate-pulse rounded-xl bg-elevated" />)}</div>
          ) : cities.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {cities.map((c) => (
                <div key={c.id} onClick={() => setSelCity(c.id)} className="group cursor-pointer rounded-xl border border-line bg-panel p-4 transition-all hover:border-[#e67e22]/30 hover:shadow-lg">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2"><MapPinIcon small /><h3 className="font-semibold">{c.name}</h3></div>
                    <button onClick={(e) => { e.stopPropagation(); delCity(c.id); }} className="text-red-400 opacity-0 transition-opacity group-hover:opacity-100"><TrashIcon /></button>
                  </div>
                  {c.country && <p className="mt-1 text-xs text-ink-muted">{c.country}</p>}
                  {c.notes && <p className="mt-2 line-clamp-2 text-sm text-ink-muted">{c.notes}</p>}
                </div>
              ))}
            </div>
          ) : (
            <Empty icon={<MapPinIcon big />} title="No cities yet" sub="Add your first favorite city to get started" onAdd={() => setModal("city")} label="Add City" />
          )}
        </>
      )}

      {/* Restaurants view */}
      {selCity && !selRest && (
        <>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold" style={{ fontFamily: "Georgia, serif" }}>Restaurants in {cityData?.name}</h2>
            <button onClick={() => setModal("restaurant")} className="flex items-center gap-1 rounded-lg bg-[#e67e22] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#d35400]"><PlusIcon /> Add Restaurant</button>
          </div>
          {restaurants.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {restaurants.map((r) => (
                <div key={r.id} onClick={() => setSelRest(r.id)} className="group cursor-pointer rounded-xl border border-line bg-panel p-4 transition-all hover:border-[#e67e22]/30 hover:shadow-lg">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2"><StoreIcon /><h3 className="font-semibold">{r.name}</h3></div>
                      {r.cuisine_type && <span className="mt-1 inline-block rounded-full bg-blue-900/40 px-2 py-0.5 text-xs text-blue-300">{r.cuisine_type}</span>}
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); delRest(r.id); }} className="text-red-400 opacity-0 transition-opacity group-hover:opacity-100"><TrashIcon /></button>
                  </div>
                  {r.rating && <div className="mt-2">{stars(r.rating)}</div>}
                  {r.notes && <p className="mt-2 line-clamp-2 text-sm text-ink-muted">{r.notes}</p>}
                </div>
              ))}
            </div>
          ) : (
            <Empty icon={<StoreIcon big />} title="No restaurants yet" sub={`Add your favorite spots in ${cityData?.name}`} onAdd={() => setModal("restaurant")} label="Add Restaurant" />
          )}
        </>
      )}

      {/* Dishes view */}
      {selRest && (
        <>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold" style={{ fontFamily: "Georgia, serif" }}>Dishes at {restData?.name}</h2>
            <button onClick={() => setModal("dish")} className="flex items-center gap-1 rounded-lg bg-[#e67e22] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#d35400]"><PlusIcon /> Add Dish</button>
          </div>
          {restData?.notes && <p className="mb-4 text-sm italic text-ink-muted">&quot;{restData.notes}&quot;</p>}
          {dishes.length > 0 ? (
            <div className="space-y-3">
              {dishes.map((d) => (
                <div key={d.id} className="group flex items-start gap-3 rounded-lg border border-line bg-panel p-3">
                  <UtensilIcon />
                  <div className="flex-1">
                    <h4 className="text-sm font-medium">{d.name}</h4>
                    {d.notes && <p className="mt-1 text-xs text-ink-muted">{d.notes}</p>}
                  </div>
                  <button onClick={() => delDish(d.id)} className="text-red-400 opacity-0 transition-opacity group-hover:opacity-100"><TrashIcon small /></button>
                </div>
              ))}
            </div>
          ) : (
            <Empty icon={<UtensilIcon big />} title="No dishes saved" sub="Remember what you loved here" onAdd={() => setModal("dish")} label="Add Dish" />
          )}
        </>
      )}

      {/* Modals */}
      {modal === "city" && (
        <ModalBox title="Add a City" onClose={() => setModal(null)}>
          <Field placeholder="City name *" value={cityForm.name} onChange={(v) => setCityForm({ ...cityForm, name: v })} />
          <Field placeholder="Country (optional)" value={cityForm.country} onChange={(v) => setCityForm({ ...cityForm, country: v })} />
          <Area placeholder="Notes (optional)" value={cityForm.notes} onChange={(v) => setCityForm({ ...cityForm, notes: v })} />
          <SubmitBtn onClick={addCity} disabled={!cityForm.name.trim()} label="Add City" />
        </ModalBox>
      )}
      {modal === "restaurant" && (
        <ModalBox title="Add a Restaurant" onClose={() => setModal(null)}>
          <Field placeholder="Restaurant name *" value={restForm.name} onChange={(v) => setRestForm({ ...restForm, name: v })} />
          <Field placeholder="Cuisine type (e.g. Italian, Sushi)" value={restForm.cuisine_type} onChange={(v) => setRestForm({ ...restForm, cuisine_type: v })} />
          <div>
            <label className="mb-1 block text-sm font-medium">Rating</label>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((i) => (
                <button key={i} onClick={() => setRestForm({ ...restForm, rating: i })}><StarIcon filled={i <= restForm.rating} big /></button>
              ))}
            </div>
          </div>
          <Area placeholder="Notes (optional)" value={restForm.notes} onChange={(v) => setRestForm({ ...restForm, notes: v })} />
          <SubmitBtn onClick={addRestaurant} disabled={!restForm.name.trim()} label="Add Restaurant" />
        </ModalBox>
      )}
      {modal === "dish" && (
        <ModalBox title="Add a Dish" onClose={() => setModal(null)}>
          <Field placeholder="Dish name *" value={dishForm.name} onChange={(v) => setDishForm({ ...dishForm, name: v })} />
          <Area placeholder="Notes — what you liked, what to order again..." value={dishForm.notes} onChange={(v) => setDishForm({ ...dishForm, notes: v })} />
          <SubmitBtn onClick={addDish} disabled={!dishForm.name.trim()} label="Add Dish" />
        </ModalBox>
      )}
    </div>
  );
}

/* ── Small helpers ─────────────────────────────────────────────── */
function Empty({ icon, title, sub, onAdd, label }: { icon: React.ReactNode; title: string; sub: string; onAdd: () => void; label: string }) {
  return (
    <div className="py-16 text-center">
      <div className="mx-auto mb-3">{icon}</div>
      <h3 className="mb-1 font-semibold">{title}</h3>
      <p className="mb-4 text-sm text-ink-muted">{sub}</p>
      <button onClick={onAdd} className="inline-flex items-center gap-1 rounded-lg bg-[#e67e22] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#d35400]"><PlusIcon /> {label}</button>
    </div>
  );
}
function ModalBox({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative z-10 w-full max-w-md rounded-xl border border-line bg-panel p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-4 text-lg font-semibold">{title}</h3>
        <div className="space-y-3">{children}</div>
      </div>
    </div>
  );
}
function Field({ placeholder, value, onChange }: { placeholder: string; value: string; onChange: (v: string) => void }) {
  return <input placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)}
    className="w-full rounded-lg border border-line bg-elevated px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-[#e67e22] focus:outline-none" />;
}
function Area({ placeholder, value, onChange }: { placeholder: string; value: string; onChange: (v: string) => void }) {
  return <textarea placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} rows={2}
    className="w-full resize-none rounded-lg border border-line bg-elevated px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-[#e67e22] focus:outline-none" />;
}
function SubmitBtn({ onClick, disabled, label }: { onClick: () => void; disabled: boolean; label: string }) {
  return <button onClick={onClick} disabled={disabled}
    className="w-full rounded-lg bg-[#e67e22] px-3 py-2 text-sm font-medium text-white hover:bg-[#d35400] disabled:opacity-50">{label}</button>;
}

/* ── Icons ─────────────────────────────────────────────────────── */
function MapPinIcon({ small, big }: { small?: boolean; big?: boolean }) { const s = big ? "h-12 w-12 text-ink-faint/30 mx-auto" : small ? "h-5 w-5 text-[#e67e22]" : "h-6 w-6 text-[#e67e22]"; return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={s}><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" /><circle cx="12" cy="10" r="3" /></svg>; }
function StoreIcon({ big }: { big?: boolean }) { const s = big ? "h-12 w-12 text-ink-faint/30 mx-auto" : "h-4 w-4 text-[#e67e22]"; return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={s}><path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7" /><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" /><path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4" /><path d="M2 7h20" /><path d="M22 7v3a2 2 0 0 1-2 2a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 16 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 12 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 8 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 4 12a2 2 0 0 1-2-2V7" /></svg>; }
function UtensilIcon({ big }: { big?: boolean }) { const s = big ? "h-10 w-10 text-ink-faint/30 mx-auto" : "mt-0.5 h-4 w-4 shrink-0 text-[#e67e22]"; return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={s}><path d="m16 2-2.3 2.3a3 3 0 0 0 0 4.2l1.8 1.8a3 3 0 0 0 4.2 0L22 8" /><path d="M15 15 3.3 3.3a4.2 4.2 0 0 0 0 6l7.3 7.3c.7.7 2 .7 2.8 0L15 15Zm0 0 7 7" /><path d="m2.1 21.8 6.4-6.3" /><path d="m19 5-7 7" /></svg>; }
function PlusIcon() { return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M5 12h14" /><path d="M12 5v14" /></svg>; }
function TrashIcon({ small }: { small?: boolean }) { const s = small ? "h-3.5 w-3.5" : "h-4 w-4"; return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={s}><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></svg>; }
function StarIcon({ filled, big }: { filled: boolean; big?: boolean }) { const s = big ? "h-6 w-6" : "h-3 w-3"; return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill={filled ? "#eab308" : "none"} stroke={filled ? "#eab308" : "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`${s} ${filled ? "" : "text-ink-faint/30"}`}><path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.29a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" /></svg>; }
