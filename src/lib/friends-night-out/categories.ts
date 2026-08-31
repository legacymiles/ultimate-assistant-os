// ---------------------------------------------------------------------------
// Friends Night Out — the Always On tag table.
//
// The first version of this file asked OpenStreetMap for ice rinks, climbing
// gyms, stables, zip lines, kayak launches and mini golf. Run against a real
// 2.5-million-person metro, that returns roughly twenty-seven named venues —
// and they are the three rinks and ten gyms everyone who lives there can
// already name. It is the autocomplete suggestion set. A board built from it is
// a directory, and a directory cannot produce "I had no idea that was here".
//
// So the table below asks for something different. The activity verbs are still
// here, but they sit alongside the tags that actually carry surprise: ruins,
// lookout towers, lava tubes, geoglyphs, moored ships, beehive kilns, hot
// springs, planetariums, drive-ins, hackerspaces, curling sheets. The proof
// this works is that Atlas Obscura's single most famous entry in Portland — the
// Witch's Castle — is already sitting in OSM as `tourism=attraction` +
// `historic=ruins` + a Wikipedia link. The data was always reachable; the old
// query just wasn't asking for it.
//
// Three rules learned the hard way, each encoded below:
//
//   `name` is required almost everywhere. 29% of raw elements have no name, and
//   `man_made=water_tower` alone returns 99 elements locally of which 2 are
//   named. Nine blank cards between the user and the good thing is how a
//   discovery feed dies. The exceptions are types where the kind IS the draw —
//   a cave entrance needs no name.
//
//   `sport` must be matched by regex, never equality. OSM allows semicolon
//   multi-values, and real data contains `sport=ice_skating;ice_hockey`. An
//   equality match drops those silently, which is invisible in testing because
//   the common case works.
//
//   Lifecycle prefixes mean closed. `disused:amenity` has 121k uses; OSM marks
//   closure by prefixing the key rather than deleting the element. Sending
//   someone to a venue that shut in 2019 is the failure that kills trust.
//
// Every tag here was verified against taginfo. Tags that sound right but do not
// exist are listed at the bottom so they do not get re-added: `sport=zipline`,
// `leisure=adventure_park`, `attraction=corn_maze`, `natural=waterfall`.
// ---------------------------------------------------------------------------

import type {
  ActivityCategory,
  Season,
  SeasonEvidence,
  SeasonWindow,
} from "./types";

type Tags = Record<string, string>;

export interface ActivityTag {
  /** Human label, also the card's tag chip. */
  label: string;
  /** Overpass filter fragment, appended to `nwr`. Includes ["name"] if required. */
  filter: string;
  /**
   * Additional filters that map to this same activity.
   *
   * This exists because of a bug worth naming: `matches` and `filter` are two
   * different things, and it is easy to write a `matches` that accepts a tag
   * the query never asked Overpass for. Bowling is a real example — it is
   * tagged `leisure=bowling_alley` on some elements and `sport=10pin` on
   * others, and querying only the first silently loses the second. Anything
   * `matches` accepts must be reachable from `filter` or `altFilters`.
   */
  altFilters?: string[];
  category: ActivityCategory;
  /** Confirms a returned element really is this thing. */
  matches: (tags: Tags) => boolean;
  /** One line describing the type, when the tags support one. */
  describe: (tags: Tags) => string | undefined;
  /**
   * 0-100 starting point before rarity and notability adjust it. Encodes only
   * what the CATEGORY is worth — being the sole example nearby is handled
   * separately, because that can only be known from the whole result set.
   */
  base: number;
  /**
   * Seasonal by nature, for the short allowlist where that is defensible: a ski
   * piste, an alpine slide, a pick-your-own orchard. Never applied to venues
   * that are commonly indoors.
   */
  typicalSeason?: SeasonWindow;
}

// Match a semicolon-separated OSM multi-value safely.
const multi = (key: string, value: string) => `["${key}"~"(^|;)${value}(;|$)"]`;
const hasMulti = (key: string, value: string) => (tags: Tags) =>
  new RegExp(`(^|;)${value}(;|$)`).test(tags[key] ?? "");
const eq = (key: string, value: string) => (tags: Tags) => tags[key] === value;

const WINTER: SeasonWindow = { from: "11-15", to: "03-10" };
const WARM: SeasonWindow = { from: "04-15", to: "10-15" };
const SUMMER: SeasonWindow = { from: "05-15", to: "09-15" };
const HARVEST: SeasonWindow = { from: "09-10", to: "11-05" };

export const ACTIVITY_TAGS: ActivityTag[] = [
  // =========================================================================
  // ODDITIES — the surprise engine. Highest yield per query.
  // =========================================================================
  {
    label: "Gasometer",
    filter: '["man_made"="gasometer"]["name"]',
    category: "Oddities",
    matches: eq("man_made", "gasometer"),
    describe: () => "Industrial gas holder",
    base: 90,
  },
  {
    label: "Obelisk",
    filter: '["man_made"="obelisk"]["name"]',
    category: "Oddities",
    matches: eq("man_made", "obelisk"),
    describe: () => "Obelisk",
    base: 76,
  },
  {
    label: "Hackerspace",
    filter: '["leisure"="hackerspace"]["name"]',
    category: "Oddities",
    matches: eq("leisure", "hackerspace"),
    describe: () => "Makerspace — most run open nights",
    base: 90,
  },
  {
    label: "Miniature railway",
    filter: '["railway"="miniature"]["name"]',
    category: "Oddities",
    matches: eq("railway", "miniature"),
    describe: () => "Ridable miniature railway",
    base: 93,
    typicalSeason: WARM,
  },
  {
    label: "Sundial",
    filter: '["amenity"="clock"]["display"="sundial"]["name"]',
    category: "Oddities",
    matches: (t) => t.amenity === "clock" && t.display === "sundial",
    describe: () => "Sundial",
    base: 88,
  },
  {
    // The catch-all for "somebody thought this was worth pointing at". Highest
    // yield and highest noise, so shops and restaurants wearing the tag are
    // rejected rather than filed as attractions.
    label: "Roadside attraction",
    filter: '["tourism"="attraction"]["name"]',
    category: "Oddities",
    matches: (t) =>
      t.tourism === "attraction" && !t.shop && !t.amenity && !t.office,
    describe: () => "Local curiosity",
    base: 74,
  },
  {
    label: "Public artwork",
    filter: '["tourism"="artwork"]["artwork_type"~"^(mural|sculpture|installation|statue)$"]["name"]',
    category: "Oddities",
    matches: (t) =>
      t.tourism === "artwork" &&
      /^(mural|sculpture|installation|statue)$/.test(t.artwork_type ?? ""),
    describe: (t) => `${(t.artwork_type ?? "artwork").replace(/_/g, " ")}`,
    base: 72,
  },

  {
    // 4,534 US elements — far more than expected, and every one is a hole in a
    // hillside somebody can stand in front of.
    label: "Mine adit",
    filter: '["man_made"="adit"]',
    altFilters: ['["man_made"="mineshaft"]'],
    category: "Oddities",
    matches: (t) => t.man_made === "adit" || t.man_made === "mineshaft",
    describe: (t) => (t.man_made === "adit" ? "Mine adit" : "Mine shaft"),
    base: 92,
  },
  {
    label: "Maritime heritage",
    filter: '["historic"="maritime"]["name"]',
    category: "Oddities",
    matches: eq("historic", "maritime"),
    describe: () => "Maritime heritage site",
    base: 84,
  },
  {
    label: "Curiosity shop",
    filter: '["shop"~"^(antiques|collector)$"]["name"]',
    category: "Oddities",
    matches: (t) => /^(antiques|collector)$/.test(t.shop ?? ""),
    describe: (t) => (t.shop === "collector" ? "Collectors' shop" : "Antique shop"),
    base: 62,
  },

  // =========================================================================
  // NATURE
  // =========================================================================
  {
    // Almost entirely a US tag — 144 of 151 uses worldwide.
    label: "Nature centre",
    filter: '["tourism"="nature_centre"]["name"]',
    category: "Nature",
    matches: eq("tourism", "nature_centre"),
    describe: () => "Nature centre",
    base: 74,
  },
  {
    // Name not required: "a cave entrance" is the whole draw on its own.
    label: "Cave",
    filter: '["natural"="cave_entrance"]',
    category: "Nature",
    matches: eq("natural", "cave_entrance"),
    describe: () => "Cave entrance",
    base: 92,
  },
  {
    label: "Natural arch",
    filter: '["natural"="arch"]',
    category: "Nature",
    matches: eq("natural", "arch"),
    describe: () => "Natural rock arch",
    base: 94,
  },
  {
    label: "Waterfall",
    filter: '["waterway"="waterfall"]',
    category: "Nature",
    matches: eq("waterway", "waterfall"),
    describe: () => "Waterfall",
    base: 80,
  },
  {
    label: "Hot spring",
    filter: '["natural"="hot_spring"]',
    category: "Wellness",
    matches: eq("natural", "hot_spring"),
    describe: () => "Natural hot spring",
    base: 95,
  },
  {
    label: "Geyser",
    filter: '["natural"="geyser"]',
    category: "Nature",
    matches: eq("natural", "geyser"),
    describe: () => "Geyser",
    base: 96,
  },
  {
    label: "Volcano",
    filter: '["natural"="volcano"]["name"]',
    category: "Nature",
    matches: eq("natural", "volcano"),
    describe: () => "Volcanic peak",
    base: 88,
  },
  {
    label: "Sinkhole",
    filter: '["natural"="sinkhole"]["name"]',
    category: "Nature",
    matches: eq("natural", "sinkhole"),
    describe: () => "Sinkhole",
    base: 90,
  },
  {
    label: "Standing stone",
    // natural=stone is a single notable standing stone. A boulder or outcrop
    // is natural=rock, which is a different and much noisier tag.
    filter: '["natural"="stone"]["name"]',
    category: "Nature",
    matches: eq("natural", "stone"),
    describe: () => "Standing stone",
    base: 88,
  },
  {
    label: "Viewpoint",
    // Name not required — the highest-volume free surprise category there is,
    // and an unnamed overlook is still a place to watch the sun go down.
    filter: '["tourism"="viewpoint"]',
    category: "Nature",
    matches: eq("tourism", "viewpoint"),
    describe: () => "Overlook",
    base: 70,
  },
  {
    label: "Bird hide",
    filter: '["leisure"="bird_hide"]',
    category: "Nature",
    matches: eq("leisure", "bird_hide"),
    describe: () => "Wildlife blind — quiet, and always free",
    base: 88,
  },
  {
    label: "Nature reserve",
    filter: '["leisure"="nature_reserve"]["name"]',
    category: "Nature",
    matches: eq("leisure", "nature_reserve"),
    describe: () => "Nature reserve",
    base: 58,
  },
  {
    label: "Botanical garden",
    filter: '["garden:type"~"^(botanical|arboretum)$"]["name"]',
    category: "Nature",
    matches: (t) => /^(botanical|arboretum)$/.test(t["garden:type"] ?? ""),
    describe: (t) => (t["garden:type"] === "arboretum" ? "Arboretum" : "Botanical garden"),
    base: 62,
  },
  {
    label: "Campground",
    filter: '["tourism"="camp_site"]["name"]',
    category: "Nature",
    matches: eq("tourism", "camp_site"),
    describe: () => "Campground",
    base: 52,
    typicalSeason: WARM,
  },
  {
    label: "Picnic site",
    filter: '["tourism"="picnic_site"]["name"]',
    category: "Nature",
    matches: eq("tourism", "picnic_site"),
    describe: () => "Picnic site",
    base: 50,
  },
  {
    label: "Zoo",
    filter: '["tourism"="zoo"]["name"]',
    category: "Nature",
    matches: eq("tourism", "zoo"),
    describe: (t) => (t.zoo === "petting_zoo" ? "Petting zoo" : t.zoo === "wildlife_park" ? "Wildlife park" : "Zoo"),
    base: 30,
  },
  {
    label: "Aquarium",
    filter: '["tourism"="aquarium"]["name"]',
    category: "Nature",
    matches: eq("tourism", "aquarium"),
    describe: () => "Aquarium",
    base: 34,
  },

  // =========================================================================
  // AIR & HEIGHTS
  // =========================================================================
  {
    // The correct zip-line tag. `sport=zipline` and `attraction=zip_line` both
    // look right and are both fictional — a query on either returns nothing,
    // which would have silently emptied a flagship category.
    label: "Zip line",
    filter: '["aerialway"="zip_line"]',
    category: "Air & Heights",
    matches: eq("aerialway", "zip_line"),
    describe: () => "Zip line",
    base: 82,
    typicalSeason: WARM,
  },
  {
    label: "Ropes course",
    filter: multi("sport", "climbing_adventure"),
    category: "Air & Heights",
    matches: hasMulti("sport", "climbing_adventure"),
    describe: () => "Aerial adventure course",
    base: 84,
    typicalSeason: WARM,
  },
  {
    label: "Paragliding site",
    filter: multi("sport", "free_flying"),
    category: "Air & Heights",
    matches: hasMulti("sport", "free_flying"),
    describe: () => "Paragliding / hang-gliding launch",
    base: 92,
    typicalSeason: WARM,
  },
  {
    label: "Scenic lift",
    filter: '["aerialway"~"^(cable_car|gondola|chair_lift)$"]["name"]',
    category: "Air & Heights",
    matches: (t) => /^(cable_car|gondola|chair_lift)$/.test(t.aerialway ?? ""),
    describe: () => "Scenic aerial lift",
    base: 72,
  },
  {
    label: "Lookout tower",
    // `tower:type=fire_observation` reads as the obvious tag for a fire lookout
    // and has ZERO uses worldwide — the clause it was in returned nothing at
    // all. Fire lookouts are tagged `tower:type=observation` like any other
    // lookout, so the operator is what distinguishes them.
    filter: '["tower:type"="observation"]["name"]',
    category: "Air & Heights",
    matches: (t) => t["tower:type"] === "observation",
    describe: (t) =>
      /forest service|national forest|park service/i.test(t.operator ?? "") ||
      t.building === "fire_lookout"
        ? "Fire lookout tower"
        : "Climbable lookout",
    base: 88,
  },
  {
    label: "RC flying field",
    filter: multi("sport", "model_aerodrome"),
    category: "Air & Heights",
    matches: hasMulti("sport", "model_aerodrome"),
    describe: () => "Model aircraft field — free to watch",
    base: 90,
    typicalSeason: WARM,
  },

  // =========================================================================
  // GAMES
  // =========================================================================
  {
    label: "Escape room",
    filter: '["leisure"="escape_game"]["name"]',
    category: "Games",
    matches: eq("leisure", "escape_game"),
    describe: () => "Escape room",
    base: 68,
  },
  {
    label: "Arcade",
    filter: '["leisure"="amusement_arcade"]["name"]',
    category: "Games",
    matches: eq("leisure", "amusement_arcade"),
    describe: () => "Arcade or barcade",
    base: 62,
  },
  {
    label: "Axe throwing",
    filter: multi("sport", "axe_throwing"),
    // Split almost evenly between the two keys in the US — query both.
    altFilters: ['["leisure"="axe_throwing"]'],
    category: "Games",
    matches: hasMulti("sport", "axe_throwing"),
    describe: () => "Axe throwing",
    base: 80,
  },
  {
    label: "Curling",
    filter: multi("sport", "curling"),
    category: "On Ice",
    matches: hasMulti("sport", "curling"),
    describe: () => "Curling club — most run learn-to-curl nights",
    base: 92,
  },
  {
    label: "Roller rink",
    filter: multi("sport", "roller_skating"),
    category: "On Ice",
    matches: hasMulti("sport", "roller_skating"),
    describe: () => "Roller skating rink",
    base: 78,
  },
  {
    label: "Laser tag",
    filter: multi("sport", "laser_tag"),
    category: "Games",
    matches: hasMulti("sport", "laser_tag"),
    describe: () => "Laser tag",
    base: 64,
  },
  {
    label: "Paintball",
    filter: multi("sport", "paintball"),
    category: "Games",
    matches: hasMulti("sport", "paintball"),
    describe: () => "Paintball",
    base: 66,
    typicalSeason: WARM,
  },
  {
    label: "Archery",
    filter: multi("sport", "archery"),
    category: "Games",
    matches: hasMulti("sport", "archery"),
    describe: () => "Archery range",
    base: 76,
  },
  {
    label: "Disc golf",
    filter: '["leisure"="disc_golf_course"]',
    // sport=disc_golf actually outnumbers the leisure tag in the US.
    altFilters: ['["sport"~"(^|;)disc_golf(;|$)"]'],
    category: "Games",
    matches: (t) => t.leisure === "disc_golf_course" || /(^|;)disc_golf(;|$)/.test(t.sport ?? ""),
    describe: () => "Disc golf course",
    base: 70,
  },
  {
    label: "Maze",
    filter: '["attraction"="maze"]',
    category: "Games",
    matches: eq("attraction", "maze"),
    describe: () => "Hedge or corn maze",
    base: 88,
    typicalSeason: HARVEST,
  },
  {
    label: "Mini golf",
    filter: '["leisure"="miniature_golf"]["name"]',
    category: "Games",
    matches: eq("leisure", "miniature_golf"),
    describe: () => "Mini golf",
    base: 40,
  },
  {
    label: "Bowling",
    filter: '["leisure"="bowling_alley"]["name"]',
    altFilters: ['["sport"~"(^|;)10pin(;|$)"]["name"]'],
    category: "Games",
    matches: (t) => t.leisure === "bowling_alley" || /(^|;)10pin(;|$)/.test(t.sport ?? ""),
    describe: () => "Bowling alley",
    base: 24,
  },
  {
    label: "Trampoline park",
    filter: '["leisure"="trampoline_park"]["name"]',
    category: "Games",
    matches: eq("leisure", "trampoline_park"),
    describe: () => "Trampoline park",
    base: 44,
  },
  {
    label: "Skate park",
    filter: '["leisure"="skatepark"]["name"]',
    altFilters: ['["sport"~"(^|;)(skateboard|bmx)(;|$)"]["name"]'],
    category: "Games",
    matches: (t) => t.leisure === "skatepark" || /(^|;)(skateboard|bmx)(;|$)/.test(t.sport ?? ""),
    describe: () => "Skate park",
    base: 52,
  },
  {
    label: "Amusement park",
    filter: '["tourism"="theme_park"]["name"]',
    category: "Games",
    matches: eq("tourism", "theme_park"),
    describe: () => "Amusement park",
    base: 26,
    typicalSeason: WARM,
  },
  {
    label: "Indoor skydiving",
    filter: multi("sport", "indoor_skydiving"),
    category: "Air & Heights",
    matches: hasMulti("sport", "indoor_skydiving"),
    describe: () => "Vertical wind tunnel",
    base: 90,
  },
  {
    label: "Driving range",
    // 4,479 US elements, and the Topgolf-style venues sit here.
    filter: '["golf"="driving_range"]["name"]',
    category: "Games",
    matches: eq("golf", "driving_range"),
    describe: () => "Driving range",
    base: 38,
  },
  {
    label: "Alpine coaster",
    filter: '["attraction"="alpine_coaster"]',
    category: "Games",
    matches: eq("attraction", "alpine_coaster"),
    describe: () => "Alpine coaster",
    base: 88,
    typicalSeason: WARM,
  },
  {
    label: "Alpine slide",
    filter: '["attraction"="summer_toboggan"]',
    category: "Games",
    matches: eq("attraction", "summer_toboggan"),
    describe: () => "Alpine slide",
    base: 90,
    typicalSeason: WARM,
  },
  {
    label: "Carousel",
    filter: '["attraction"~"^(carousel|big_wheel|dark_ride)$"]["name"]',
    category: "Games",
    matches: (t) => /^(carousel|big_wheel|dark_ride)$/.test(t.attraction ?? ""),
    describe: (t) => (t.attraction ?? "ride").replace(/_/g, " "),
    base: 74,
  },

  // =========================================================================
  // CLIMBING
  // =========================================================================
  {
    label: "Climbing",
    filter: multi("sport", "climbing"),
    category: "Climbing",
    matches: hasMulti("sport", "climbing"),
    describe: (t) =>
      t.climbing === "boulder" ? "Bouldering" : t["climbing:sport"] === "yes" ? "Sport climbing" : "Climbing",
    base: 44,
  },
  {
    label: "Crag",
    filter: '["climbing"="crag"]',
    category: "Climbing",
    matches: eq("climbing", "crag"),
    describe: () => "Outdoor climbing crag",
    base: 82,
    typicalSeason: WARM,
  },
  {
    label: "Via ferrata",
    filter: '["highway"="via_ferrata"]',
    category: "Climbing",
    matches: eq("highway", "via_ferrata"),
    describe: () => "Cabled mountain route",
    base: 94,
    typicalSeason: WARM,
  },

  // =========================================================================
  // WATER
  // =========================================================================
  {
    label: "Boat rental",
    filter: '["amenity"="boat_rental"]["name"]',
    category: "Water",
    matches: eq("amenity", "boat_rental"),
    describe: () => "Kayak, canoe & boat rental",
    base: 60,
    typicalSeason: WARM,
  },
  {
    label: "Paddling launch",
    // `canoe=yes` narrows this to almost nothing; a named slipway IS the launch.
    filter: '["leisure"="slipway"]["name"]',
    category: "Water",
    matches: eq("leisure", "slipway"),
    describe: () => "Boat & paddling launch",
    base: 78,
    typicalSeason: WARM,
  },
  {
    label: "Whitewater put-in",
    filter: '["whitewater"="put_in"]',
    category: "Water",
    matches: eq("whitewater", "put_in"),
    describe: () => "Whitewater put-in",
    base: 88,
    typicalSeason: WARM,
  },
  {
    label: "Swimming hole",
    filter: '["leisure"="swimming_area"]',
    category: "Water",
    matches: eq("leisure", "swimming_area"),
    describe: () => "Natural swimming area",
    base: 86,
    typicalSeason: SUMMER,
  },
  {
    label: "Beach",
    filter: '["natural"="beach"]["name"]',
    category: "Water",
    matches: eq("natural", "beach"),
    describe: () => "Beach",
    base: 44,
    typicalSeason: SUMMER,
  },
  {
    label: "Fishing spot",
    filter: '["leisure"="fishing"]["name"]',
    category: "Water",
    matches: eq("leisure", "fishing"),
    describe: () => "Fishing access",
    base: 70,
  },
  {
    label: "Dive centre",
    filter: '["amenity"="dive_centre"]["name"]',
    category: "Water",
    matches: eq("amenity", "dive_centre"),
    describe: () => "Scuba diving",
    base: 82,
  },
  {
    label: "Surf spot",
    filter: multi("sport", "surfing"),
    category: "Water",
    matches: hasMulti("sport", "surfing"),
    describe: () => "Surf break",
    base: 78,
  },
  {
    label: "Water park",
    filter: '["leisure"="water_park"]["name"]',
    category: "Water",
    matches: eq("leisure", "water_park"),
    describe: () => "Water park",
    base: 32,
    typicalSeason: SUMMER,
  },

  // =========================================================================
  // ON ICE / SNOW
  // =========================================================================
  {
    label: "Ice rink",
    filter: '["leisure"="ice_rink"]["name"]',
    altFilters: ['["sport"~"(^|;)ice_skating(;|$)"]["name"]'],
    category: "On Ice",
    matches: (t) => t.leisure === "ice_rink" || /(^|;)ice_skating(;|$)/.test(t.sport ?? ""),
    describe: () => "Skating rink",
    base: 36,
    // No typicalSeason on purpose: most US rinks are indoors and run all year.
    // Season is derived from evidence instead — see deriveSeason.
  },
  {
    label: "Ski area",
    filter: '["piste:type"="downhill"]["name"]',
    category: "On Ice",
    matches: eq("piste:type", "downhill"),
    describe: () => "Downhill skiing",
    base: 40,
    typicalSeason: WINTER,
  },
  {
    label: "Sledding hill",
    filter: '["piste:type"="sled"]',
    altFilters: ['["sport"~"(^|;)toboggan(;|$)"]'],
    category: "On Ice",
    matches: (t) => t["piste:type"] === "sled" || /(^|;)toboggan(;|$)/.test(t.sport ?? ""),
    describe: () => "Sledding run",
    base: 76,
    typicalSeason: WINTER,
  },

  // =========================================================================
  // HORSES
  // =========================================================================
  {
    label: "Riding stables",
    // sport=equestrian has ~5x the coverage of leisure=horse_riding, so both
    // are queried and mapped to one category.
    filter: '["leisure"="horse_riding"]["name"]',
    category: "Horses",
    matches: eq("leisure", "horse_riding"),
    describe: () => "Riding stables",
    base: 66,
  },
  {
    label: "Equestrian centre",
    filter: multi("sport", "equestrian"),
    category: "Horses",
    matches: hasMulti("sport", "equestrian"),
    describe: () => "Equestrian centre",
    base: 64,
  },
  {
    label: "Trail riding",
    filter: '["tourism"="trail_riding_station"]',
    category: "Horses",
    matches: eq("tourism", "trail_riding_station"),
    describe: () => "Horse trail head",
    base: 84,
    typicalSeason: WARM,
  },

  // =========================================================================
  // MOTORS
  // =========================================================================
  {
    label: "Go-karts",
    filter: multi("sport", "karting"),
    category: "Motors",
    matches: hasMulti("sport", "karting"),
    describe: () => "Go-kart track",
    base: 56,
  },
  {
    label: "Raceway",
    filter: '["highway"="raceway"]["name"]',
    category: "Motors",
    matches: eq("highway", "raceway"),
    describe: () => "Racing circuit",
    base: 70,
    typicalSeason: WARM,
  },
  {
    label: "Drive-in cinema",
    // `cinema=drive_in` returns nothing; the working combination is
    // amenity=cinema plus drive_in=yes.
    filter: '["amenity"="cinema"]["drive_in"="yes"]',
    category: "Motors",
    matches: (t) => t.amenity === "cinema" && t.drive_in === "yes",
    describe: () => "Drive-in movie theatre",
    base: 92,
    typicalSeason: WARM,
  },

  // =========================================================================
  // WELLNESS
  // =========================================================================
  {
    label: "Bathhouse",
    filter: '["amenity"="public_bath"]["name"]',
    category: "Wellness",
    matches: eq("amenity", "public_bath"),
    describe: () => "Public baths",
    base: 86,
  },
  {
    label: "Sauna",
    filter: '["leisure"="sauna"]["name"]',
    category: "Wellness",
    matches: eq("leisure", "sauna"),
    describe: () => "Sauna",
    base: 78,
  },
  {
    label: "Dance hall",
    filter: '["leisure"="dance"]["name"]',
    category: "Wellness",
    matches: eq("leisure", "dance"),
    describe: (t) => (t["dance:teaching"] === "yes" ? "Dance lessons" : "Social dance hall"),
    base: 82,
  },

  // =========================================================================
  // CULTURE
  // =========================================================================
  {
    label: "Arts centre",
    filter: '["amenity"="arts_centre"]["name"]',
    category: "Culture",
    matches: eq("amenity", "arts_centre"),
    describe: () => "Arts centre",
    base: 68,
  },
  {
    label: "Museum",
    filter: '["tourism"="museum"]["name"]',
    category: "Culture",
    matches: eq("tourism", "museum"),
    describe: (t) => (t.museum ? `${t.museum.replace(/_/g, " ")} museum` : "Museum"),
    base: 48,
  },
  {
    label: "Planetarium",
    filter: '["amenity"="planetarium"]["name"]',
    category: "Culture",
    matches: eq("amenity", "planetarium"),
    describe: () => "Planetarium",
    base: 88,
  },
  {
    label: "Gallery",
    filter: '["tourism"="gallery"]["name"]',
    category: "Culture",
    matches: eq("tourism", "gallery"),
    describe: () => "Art gallery",
    base: 66,
  },
  {
    label: "Theatre",
    filter: '["amenity"="theatre"]["name"]',
    category: "Culture",
    matches: eq("amenity", "theatre"),
    describe: () => "Theatre",
    base: 44,
  },
  {
    label: "Music venue",
    filter: '["amenity"="music_venue"]["name"]',
    category: "Culture",
    matches: eq("amenity", "music_venue"),
    describe: () => "Music venue",
    base: 72,
  },
  {
    label: "Cinema",
    filter: '["amenity"="cinema"]["name"]',
    category: "Culture",
    matches: (t) => t.amenity === "cinema" && t.drive_in !== "yes",
    describe: () => "Cinema",
    base: 22,
  },
  {
    label: "Bandstand",
    filter: '["leisure"="bandstand"]["name"]',
    category: "Culture",
    matches: eq("leisure", "bandstand"),
    describe: () => "Bandstand",
    base: 80,
  },
  {
    label: "Bookshop",
    filter: '["shop"="books"]["name"]',
    category: "Culture",
    matches: eq("shop", "books"),
    describe: (t) => (t.second_hand === "yes" ? "Second-hand bookshop" : "Bookshop"),
    base: 58,
  },

  // =========================================================================
  // FOOD & DRINK
  // =========================================================================
  {
    label: "Brewery",
    filter: '["craft"="brewery"]["name"]',
    altFilters: ['["microbrewery"="yes"]["name"]'],
    category: "Food & Drink",
    matches: eq("craft", "brewery"),
    describe: () => "Brewery taproom",
    base: 46,
  },
  {
    label: "Distillery",
    filter: '["craft"="distillery"]["name"]',
    category: "Food & Drink",
    matches: eq("craft", "distillery"),
    describe: () => "Distillery — most run tours",
    base: 76,
  },
  {
    label: "Winery",
    filter: '["craft"="winery"]["name"]',
    category: "Food & Drink",
    matches: eq("craft", "winery"),
    describe: () => "Winery",
    base: 58,
  },
  {
    label: "Beer garden",
    filter: '["amenity"="biergarten"]["name"]',
    category: "Food & Drink",
    matches: eq("amenity", "biergarten"),
    describe: () => "Beer garden",
    base: 64,
    typicalSeason: WARM,
  },
  {
    label: "Farm stand",
    filter: '["shop"="farm"]["name"]',
    category: "Food & Drink",
    matches: eq("shop", "farm"),
    describe: () => "Farm stand",
    base: 72,
    typicalSeason: HARVEST,
  },
  {
    label: "Market",
    filter: '["amenity"="marketplace"]["name"]',
    category: "Food & Drink",
    matches: eq("amenity", "marketplace"),
    describe: () => "Market",
    base: 58,
  },
];

/**
 * Tags that read as obviously correct and do not exist. Verified against
 * taginfo; each returns effectively nothing. Listed so they do not get
 * "helpfully" re-added later.
 *
 *   sport=zipline            → use aerialway=zip_line
 *   attraction=zip_line      → use aerialway=zip_line
 *   leisure=adventure_park   → use sport=climbing_adventure
 *   attraction=adventure_park→ use sport=climbing_adventure
 *   attraction=corn_maze     → use attraction=maze
 *   natural=waterfall        → use waterway=waterfall
 *   tourism=farm             → use shop=farm
 *   cinema=drive_in          → use amenity=cinema + drive_in=yes
 *   place=ghost_town         → no reliable tag exists
 *
 * Deliberately excluded as noise rather than absent: leisure=sports_centre,
 * leisure=fitness_centre, leisure=pitch, leisure=track, man_made=silo,
 * man_made=storage_tank, tourism=information, natural=peak. Each returns
 * hundreds of generic or unnamed elements per metro.
 */
export const NON_EXISTENT_TAGS_DO_NOT_USE = true;

/** OSM marks closure by prefixing the key, not by deleting the element. */
export const LIFECYCLE_PREFIXES = [
  "disused:",
  "abandoned:",
  "demolished:",
  "razed:",
  "removed:",
  "was:",
  "proposed:",
  "construction:",
];

export function isClosed(tags: Tags): boolean {
  if (tags.disused === "yes" || tags.abandoned === "yes") return true;
  return Object.keys(tags).some((k) =>
    LIFECYCLE_PREFIXES.some((p) => k.startsWith(p)),
  );
}

/**
 * Places the app must not send anyone to.
 *
 * `access=private` and `access=no` were previously only used to withhold the
 * "free" chip, which left the place itself on the board with a directions link.
 * Combined with mine adits and shafts — thousands of them in OSM, unfenced and
 * frequently on private land — that is a directions link to an open vertical
 * shaft on someone else's property. Excluded outright, not down-ranked.
 */
export function isOffLimits(tags: Tags): boolean {
  if (tags.access === "private" || tags.access === "no") return true;
  // A mine opening needs positive evidence of public access, not merely the
  // absence of a private tag.
  const isMineOpening =
    tags.man_made === "adit" || tags.man_made === "mineshaft" || tags.historic === "mine";
  if (isMineOpening && !/^(yes|permissive|customers|designated)$/.test(tags.access ?? "")) {
    return !tags.wikipedia && !tags.wikidata && tags.tourism !== "attraction";
  }
  return false;
}

// ----- season derivation ---------------------------------------------------

const MONTH_ABBR = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
];

/**
 * Read a month range out of an `opening_hours` value.
 *
 * The full opening_hours grammar is far too large to parse with a regex, and
 * this deliberately does not try. It recognises only the leading month-range
 * form the spec uses for seasonal venues — `Nov-Mar 10:00-22:00` and
 * `Oct 15-Apr 15` — and returns null for everything else, so an unparsed value
 * becomes "unknown" rather than a wrong answer.
 */
export function seasonFromOpeningHours(value: string | undefined): SeasonWindow | null {
  if (!value) return null;
  const m = value
    .trim()
    .match(
      /^([A-Z][a-z]{2})\s*(\d{1,2})?\s*-\s*([A-Z][a-z]{2})\s*(\d{1,2})?\b/,
    );
  if (!m) return null;
  const from = MONTH_ABBR.indexOf(m[1].toLowerCase());
  const to = MONTH_ABBR.indexOf(m[3].toLowerCase());
  if (from === -1 || to === -1) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    from: `${pad(from + 1)}-${pad(Number(m[2] ?? 1))}`,
    to: `${pad(to + 1)}-${pad(Number(m[4] ?? 28))}`,
  };
}

function isIndoor(tags: Tags): boolean {
  return (
    tags.covered === "yes" ||
    tags.indoor === "yes" ||
    tags.location === "indoor" ||
    tags.building !== undefined
  );
}

/**
 * Season, and how confident we are in it.
 *
 * Order matters: the venue's own stated hours beat everything, being indoors
 * beats a category assumption, and a category assumption is only consulted for
 * the short allowlist where seasonality is inherent to the type. Anything else
 * returns `unknown`, which the UI must not dim.
 */
export function deriveSeason(
  tag: ActivityTag,
  tags: Tags,
): { season: Season; evidence: SeasonEvidence } {
  const stated = seasonFromOpeningHours(tags.opening_hours);
  if (stated) return { season: stated, evidence: "stated" };
  if (isIndoor(tags)) return { season: "year-round", evidence: "indoor" };
  if (tag.typicalSeason) return { season: tag.typicalSeason, evidence: "typical" };
  return { season: "unknown", evidence: "none" };
}

// ----- season display ------------------------------------------------------

/** Day-of-year index, so a season can wrap past New Year. */
function md(monthDay: string): number {
  const [m, d] = monthDay.split("-").map(Number);
  return (m ?? 1) * 100 + (d ?? 1);
}

export function inSeason(season: Season, when = new Date()): boolean {
  if (season === "year-round" || season === "unknown") return true;
  const now = (when.getMonth() + 1) * 100 + when.getDate();
  const from = md(season.from);
  const to = md(season.to);
  // A winter window runs Nov -> Mar, so `from` is greater than `to`.
  return from <= to ? now >= from && now <= to : now >= from || now <= to;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * The caption under an out-of-season card.
 *
 * Out-of-season places stay visible: knowing the rink opens in six weeks is
 * planning information, and hiding it makes the area look emptier than it is.
 * A "typical" guess is hedged in the wording, because the app does not actually
 * know this venue's hours — only what venues of its kind usually do.
 */
export function seasonLabel(
  season: Season,
  evidence: SeasonEvidence,
  when = new Date(),
): string | null {
  if (season === "year-round" || season === "unknown") return null;
  const open = inSeason(season, when);
  const [m] = (open ? season.to : season.from).split("-").map(Number);
  const month = MONTH_NAMES[(m ?? 1) - 1];
  if (evidence === "typical") {
    return open ? `usually runs through ${month}` : `usually opens in ${month}`;
  }
  return open ? `through ${month}` : `opens in ${month}`;
}

export const ACTIVITY_CATEGORY_ORDER: ActivityCategory[] = [
  "Oddities",
  "Nature",
  "Air & Heights",
  "Water",
  "On Ice",
  "Climbing",
  "Horses",
  "Games",
  "Motors",
  "Wellness",
  "Culture",
  "Food & Drink",
];
