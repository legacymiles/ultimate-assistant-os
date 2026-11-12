import type { BuildSpec, PricedMaterial, SpecComp } from "./schema";

/**
 * The demo catalog.
 *
 * With no OPENROUTER_API_KEY the app is still fully usable: these are real,
 * hand-built plans with plausible 2026 US prices, and every number they produce
 * is stamped `demo: true` so the UI can label it "Demo catalog — not a live
 * price" everywhere it appears. Nothing here is ever presented as a live
 * listing. This is also the sample data that stops the board opening empty.
 */

export interface DemoPlan {
  key: string;
  match: RegExp;
  spec: BuildSpec;
  prices: PricedMaterial[];
  comps: SpecComp[];
}

const frame: DemoPlan = {
  key: "picture-frame",
  match: /\b(picture|photo|poster|gallery)\s*frame|\bframe\b/i,
  spec: {
    title: "Oversized oak gallery frame",
    summary:
      "A 48 × 36 in solid white-oak frame with a mitred face, splined corners and a museum-style float mount.",
    buildType: "picture-frame",
    skillLevel: "intermediate",
    estimatedHours: 6.5,
    dimensions: [
      { key: "width", label: "Opening width", value: 48, unit: "in", min: 16, max: 96, step: 1 },
      { key: "height", label: "Opening height", value: 36, unit: "in", min: 12, max: 72, step: 1 },
    ],
    tools: [
      "Mitre saw",
      "Table saw",
      "Router with slot cutter",
      "Band clamp or strap clamp",
      "Random-orbit sander",
      "Block plane",
    ],
    safety: [
      "Mitre cuts throw offcuts — never reach across a spinning blade to retrieve one.",
      "Hardwood dust is a sensitiser: wear a P2/N95 mask when sanding oak.",
      "A 48 in glazed frame is heavy. Hang from two points into studs, not drywall anchors.",
    ],
    materials: [
      { name: '4/4 white oak, 1×4 nominal', spec: "Face frame stock, S4S (includes 10% waste)", category: "lumber", aisle: "Hardwood lumber", quantity: 16, unit: "ft", scaling: "linear", driver: "width" },
      { name: "Walnut spline stock", spec: '⅛ in × ¾ in for corner keys', category: "lumber", aisle: "Hardwood lumber", quantity: 2, unit: "ft", scaling: "fixed" },
      { name: "Acrylic glazing sheet", spec: "0.098 in, 48 × 36 in, UV-filtering", category: "glass", aisle: "Glass & acrylic", quantity: 1, unit: "sheet", scaling: "area", driver: "width", driver2: "height" },
      { name: "Acid-free foam backer board", spec: "48 × 36 in, 3/16 in", category: "sheet", aisle: "Art & framing", quantity: 1, unit: "sheet", scaling: "area", driver: "width", driver2: "height" },
      { name: "Titebond III wood glue", spec: "16 oz", category: "adhesive", aisle: "Glue & adhesive", quantity: 1, unit: "bottle", scaling: "fixed" },
      { name: "Osmo Polyx hardwax oil", spec: "Clear satin, 0.75 L", category: "finish", aisle: "Stains & finishes", quantity: 1, unit: "tin", scaling: "fixed" },
      { name: "Heavy-duty D-ring hangers + wire", spec: "100 lb rated pair", category: "hardware", aisle: "Picture hanging", quantity: 1, unit: "set", scaling: "fixed" },
      { name: "Sandpaper assortment", spec: "120 / 180 / 220 grit discs", category: "consumable", aisle: "Abrasives", quantity: 1, unit: "pack", scaling: "fixed" },
    ],
    steps: [
      { title: "Mill the stock flat and square", body: "Joint one face and one edge, then rip all four rails to a consistent 3½ in width. Oak moves — let it sit in the shop a day before final milling and re-check for cup.", tools: ["Table saw", "Block plane"], minutes: 70, safety: ["Use a push stick for the final rip."] },
      { title: "Cut the rabbet for glazing and art", body: 'Route a ⅜ in deep × ½ in wide rabbet along the back inside edge of every rail. Test the depth on an offcut against your acrylic plus backer stack before committing.', tools: ["Router with slot cutter"], minutes: 45 },
      { title: "Cut the mitres", body: "Set the mitre saw to exactly 45°, confirm with a drafting square, and cut both rails of a pair without moving the stop so opposite sides match to the thousandth. Cut long by 1/16 in and shave to fit.", tools: ["Mitre saw"], minutes: 50, cutList: [{ part: "Long rails", qty: 2, dimensions: '49¼" × 3½" × ¾" (mitred, 48" opening)', material: "White oak" }, { part: "Short rails", qty: 2, dimensions: '37¼" × 3½" × ¾" (mitred, 36" opening)', material: "White oak" }] },
      { title: "Glue up with a band clamp", body: "Dry-fit all four corners first. Glue, strap, and check the diagonals match within 1/16 in before the glue grabs — a frame that is out of square will not accept a square sheet of acrylic.", tools: ["Band clamp or strap clamp"], minutes: 40 },
      { title: "Cut and fit walnut splines", body: "Once dry, run each corner over a slot cutter and glue in a contrasting walnut key. This is what stops a mitre on a 48 in frame opening up over a winter.", tools: ["Table saw", "Router with slot cutter"], minutes: 55 },
      { title: "Sand and oil", body: "Sand to 180, raise the grain with a damp rag, sand to 220. Two thin coats of hardwax oil, 8 hours apart, buffed back with a white pad. Oak drinks the first coat — don't flood it.", tools: ["Random-orbit sander"], minutes: 90, safety: ["Oil-soaked rags self-heat: lay them flat outdoors to dry before binning."] },
      { title: "Glaze, mount and hang", body: "Clean the acrylic with an anti-static cloth, drop the stack in the rabbet, secure with glazier points, then fit D-rings at one third down from the top on both sides.", tools: [], minutes: 45 },
    ],
  },
  prices: [
    { name: '4/4 white oak, 1×4 nominal', unitPrice: 7.85, retailer: "Woodworkers Source", url: "https://www.woodworkerssource.com/white-oak.html", note: "Per board foot, rough-sawn 4/4" },
    { name: "Walnut spline stock", unitPrice: 4.5, retailer: "Rockler", url: "https://www.rockler.com/" },
    { name: "Acrylic glazing sheet", unitPrice: 78.0, retailer: "Home Depot", url: "https://www.homedepot.com/b/Building-Materials-Glass-Plastic-Sheets/" },
    { name: "Acid-free foam backer board", unitPrice: 22.5, retailer: "Blick", url: "https://www.dickblick.com/" },
    { name: "Titebond III wood glue", unitPrice: 11.98, retailer: "Home Depot", url: "https://www.homedepot.com/" },
    { name: "Osmo Polyx hardwax oil", unitPrice: 59.95, retailer: "Woodcraft", url: "https://www.woodcraft.com/" },
    { name: "Heavy-duty D-ring hangers + wire", unitPrice: 9.47, retailer: "Lowe's", url: "https://www.lowes.com/" },
    { name: "Sandpaper assortment", unitPrice: 16.99, retailer: "Home Depot", url: "https://www.homedepot.com/" },
  ],
  comps: [
    { title: "48x36 solid oak gallery frame, handmade", price: 420, sold: true, soldAt: "2026-10-18", marketplace: "Etsy", url: "https://www.etsy.com/", condition: "New" },
    { title: 'Large 4ft white oak picture frame', price: 385, sold: true, soldAt: "2026-10-04", marketplace: "eBay", url: "https://www.ebay.com/", condition: "New" },
    { title: "Oversized oak float frame 48in", price: 465, sold: true, soldAt: "2026-09-27", marketplace: "Etsy", url: "https://www.etsy.com/" },
    { title: "Custom hardwood poster frame XL", price: 340, sold: true, soldAt: "2026-09-12", marketplace: "Facebook Marketplace", url: "https://www.facebook.com/marketplace/" },
    { title: "White oak gallery frame, splined corners", price: 510, sold: true, soldAt: "2026-08-30", marketplace: "Etsy", url: "https://www.etsy.com/" },
    { title: "Giant oak frame 48x36 — asking", price: 795, sold: false, soldAt: null, marketplace: "Etsy", url: "https://www.etsy.com/" },
  ],
};

const hotTubBoat: DemoPlan = {
  key: "hot-tub-boat",
  match: /hot\s*tub\s*boat|tub\s*boat|floating\s*hot\s*tub/i,
  spec: {
    title: "Cedar hot tub boat (4-person)",
    summary:
      "A 12 ft aluminium-pontoon raft carrying a western red cedar soaking tub, a wood-fired snorkel stove and a 5 hp electric outboard.",
    buildType: "hot-tub-boat",
    skillLevel: "advanced",
    estimatedHours: 96,
    dimensions: [
      { key: "length", label: "Hull length", value: 12, unit: "ft", min: 10, max: 20, step: 1 },
      { key: "tubDia", label: "Tub diameter", value: 60, unit: "in", min: 48, max: 84, step: 2 },
    ],
    tools: ["Mitre saw", "Circular saw", "Angle grinder", "MIG welder", "Impact driver", "Hole saw set", "Ratchet straps"],
    safety: [
      "This is a vessel carrying 1,500+ lb of water. Get the freeboard and trim checked before anyone sits in it — calculate displacement, don't eyeball it.",
      "A wood-fired snorkel stove and a closed cover is a carbon-monoxide risk. Never fit a lid that seals.",
      "Any 120 V pump near water needs a GFCI and a qualified electrician's sign-off. Do not improvise this.",
      "Welding galvanised steel releases zinc oxide fumes — grind the coating back and work in open air.",
      "Check your state's registration and capacity-plate rules before you launch. Most require both.",
    ],
    materials: [
      { name: "Aluminium pontoon tubes, 12 ft × 20 in", category: "metal", aisle: "Marine supply", quantity: 2, unit: "tube", scaling: "linear", driver: "length" },
      { name: "Aluminium 2×2 box section, 1/8 in wall", spec: "Deck frame", category: "metal", aisle: "Metal stock", quantity: 96, unit: "ft", scaling: "linear", driver: "length" },
      { name: "Western red cedar 2×6 T&G", spec: "Tub staves, clear grade", category: "lumber", aisle: "Softwood lumber", quantity: 120, unit: "ft", scaling: "linear", driver: "tubDia" },
      { name: "Stainless tub bands + turnbuckles", spec: "316 SS, 1 in strap", category: "hardware", aisle: "Marine hardware", quantity: 4, unit: "band", scaling: "linear", driver: "tubDia" },
      { name: "Marine-grade plywood, 3/4 in", spec: "Deck", category: "sheet", aisle: "Plywood", quantity: 4, unit: "sheet", scaling: "area", driver: "length" },
      { name: "Snorkel wood-fired tub stove", spec: "Submersible stainless, ~45,000 BTU", category: "hardware", aisle: "Special order", quantity: 1, unit: "stove", scaling: "fixed" },
      { name: "Electric outboard, 5 hp equivalent", category: "hardware", aisle: "Marine supply", quantity: 1, unit: "motor", scaling: "fixed" },
      { name: "Deep-cycle LiFePO4 battery, 100 Ah", category: "electrical", aisle: "Batteries", quantity: 1, unit: "battery", scaling: "fixed" },
      { name: "Bilge pump + thru-hull fittings", category: "plumbing", aisle: "Marine plumbing", quantity: 1, unit: "kit", scaling: "fixed" },
      { name: "Marine sealant (3M 4200)", category: "adhesive", aisle: "Sealants", quantity: 3, unit: "tube", scaling: "fixed" },
      { name: "316 stainless fasteners assortment", category: "fasteners", aisle: "Fasteners", quantity: 2, unit: "box", scaling: "fixed" },
      { name: "Marine spar varnish", category: "finish", aisle: "Stains & finishes", quantity: 2, unit: "quart", scaling: "fixed" },
    ],
    steps: [
      { title: "Calculate displacement before you buy anything", body: "Water weighs 8.34 lb/gal. A 60 in × 36 in deep tub holds roughly 350 gal — nearly 3,000 lb before people. Two 12 ft × 20 in pontoons displace about 2,900 lb at half submersion. Do this arithmetic on paper first; this single step is what separates a hot tub boat from a sinking.", tools: [], minutes: 120, safety: ["If the numbers are tight, go longer on the pontoons. Never go shallower on the tub."] },
      { title: "Weld the deck frame", body: "Build a ladder frame from 2×2 box section with cross members on 16 in centres, doubling up directly under the tub ring. Tack the whole frame, measure the diagonals, then fully weld.", tools: ["MIG welder", "Angle grinder"], minutes: 600 },
      { title: "Mount the pontoons", body: "Bolt through the pontoon mounting flanges with 316 stainless and isolate every steel-to-aluminium contact with nylon washers, or galvanic corrosion will eat the joint in one season.", tools: ["Impact driver"], minutes: 240 },
      { title: "Lay the deck", body: "Marine plywood down with a bed of 4200, countersunk and plugged, then two coats of spar varnish on all six faces of every panel before it ever meets water.", tools: ["Circular saw", "Impact driver"], minutes: 300 },
      { title: "Build the cedar tub", body: "Cut staves to length, bevel each edge so the sum of the bevels closes the circle, dry-assemble inside the bands, then draw the turnbuckles up evenly in quarter turns. Cedar swells to seal itself — do not caulk the joints.", tools: ["Table saw", "Mitre saw"], minutes: 720, cutList: [{ part: "Tub staves", qty: 42, dimensions: '36" × 5½" × 1½", edges bevelled 4.3°', material: "Western red cedar" }, { part: "Floor boards", qty: 12, dimensions: 'cut to circle, 60" dia', material: "Western red cedar" }] },
      { title: "Fit the stove and plumbing", body: "The snorkel stove hangs inside the tub with its intake above the waterline. Fit the bilge pump at the lowest point of the deck pan and run the thru-hull well above the waterline.", tools: ["Hole saw set"], minutes: 300, safety: ["Never fit a sealing lid over a live stove."] },
      { title: "Wire the motor and battery", body: "Battery in a vented box, main fuse within 7 in of the positive terminal, a battery switch within reach of the helm. Everything tinned marine wire.", tools: [], minutes: 240, safety: ["Have a marine electrician check the installation before first use."] },
      { title: "Launch, trim and register", body: "First launch empty, then fill the tub a quarter at a time, watching the trim. Add ballast to level it before anyone climbs in. Fit your capacity plate and register the vessel.", tools: [], minutes: 240 },
    ],
  },
  prices: [
    { name: "Aluminium pontoon tubes, 12 ft × 20 in", unitPrice: 1180, retailer: "Pontoon Depot", url: "https://www.pontoonstuff.com/" },
    { name: "Aluminium 2×2 box section, 1/8 in wall", unitPrice: 9.4, retailer: "Metals Depot", url: "https://www.metalsdepot.com/" },
    { name: "Western red cedar 2×6 T&G", unitPrice: 6.2, retailer: "Home Depot", url: "https://www.homedepot.com/" },
    { name: "Stainless tub bands + turnbuckles", unitPrice: 96, retailer: "Northern Tool", url: "https://www.northerntool.com/" },
    { name: "Marine-grade plywood, 3/4 in", unitPrice: 148, retailer: "Boulter Plywood", url: "https://boulterplywood.com/" },
    { name: "Snorkel wood-fired tub stove", unitPrice: 1595, retailer: "Snorkel Stove Co.", url: "https://snorkel.com/" },
    { name: "Electric outboard, 5 hp equivalent", unitPrice: 1899, retailer: "West Marine", url: "https://www.westmarine.com/" },
    { name: "Deep-cycle LiFePO4 battery, 100 Ah", unitPrice: 429, retailer: "Battle Born", url: "https://battlebornbatteries.com/" },
    { name: "Bilge pump + thru-hull fittings", unitPrice: 128, retailer: "West Marine", url: "https://www.westmarine.com/" },
    { name: "Marine sealant (3M 4200)", unitPrice: 24.5, retailer: "West Marine", url: "https://www.westmarine.com/" },
    { name: "316 stainless fasteners assortment", unitPrice: 89, retailer: "Fastenal", url: "https://www.fastenal.com/" },
    { name: "Marine spar varnish", unitPrice: 42, retailer: "Jamestown Distributors", url: "https://www.jamestowndistributors.com/" },
  ],
  comps: [
    { title: "Hot tub boat, cedar, wood-fired — used 1 season", price: 14500, sold: true, soldAt: "2026-09-20", marketplace: "Facebook Marketplace", url: "https://www.facebook.com/marketplace/" },
    { title: "Custom floating hot tub pontoon", price: 11200, sold: true, soldAt: "2026-07-15", marketplace: "Craigslist", url: "https://craigslist.org/" },
    { title: "Hot tub boat 14ft with electric motor", price: 18900, sold: true, soldAt: "2026-06-02", marketplace: "Boat Trader", url: "https://www.boattrader.com/" },
    { title: "Floating cedar soaking tub raft — asking", price: 32000, sold: false, soldAt: null, marketplace: "Facebook Marketplace", url: "https://www.facebook.com/marketplace/" },
  ],
};

const fireplace: DemoPlan = {
  key: "fireplace",
  match: /fireplace|mantel|mantle|fire\s*surround|fire\s*pit|firepit/i,
  spec: {
    title: "DIY electric fireplace with floating oak mantel",
    summary:
      "A framed media wall around a 50 in linear electric insert, micro-cement finish and a 7 ft solid-oak floating mantel.",
    buildType: "fireplace",
    skillLevel: "intermediate",
    estimatedHours: 22,
    dimensions: [
      { key: "width", label: "Wall width", value: 96, unit: "in", min: 48, max: 168, step: 2 },
      { key: "height", label: "Wall height", value: 96, unit: "in", min: 72, max: 120, step: 2 },
    ],
    tools: ["Mitre saw", "Circular saw", "Impact driver", "Stud finder", "Laser level", "Drywall tools", "Random-orbit sander"],
    safety: [
      "An electric insert needs its own circuit. A 50 in linear unit pulls about 12.5 A — do not share it with a TV wall.",
      "Keep the manufacturer's clearance above the insert. Combustible trim too close is the single most common failure here.",
      "Check for wires and pipes with a scanner before any screw goes into that wall.",
      "Micro-cement is alkaline. Gloves and eye protection.",
    ],
    materials: [
      { name: "2×4 kiln-dried stud", spec: "Framing", category: "lumber", aisle: "Lumber", quantity: 18, unit: "board", scaling: "area", driver: "width", driver2: "height" },
      { name: "50 in linear electric fireplace insert", spec: "Recessed, 1500 W", category: "electrical", aisle: "Heating", quantity: 1, unit: "insert", scaling: "fixed" },
      { name: "Cement backer board, 1/2 in", spec: "3 × 5 ft sheets", category: "sheet", aisle: "Tile & backer", quantity: 4, unit: "sheet", scaling: "area", driver: "width", driver2: "height" },
      { name: "Drywall 1/2 in, 4 × 8 ft", category: "sheet", aisle: "Drywall", quantity: 4, unit: "sheet", scaling: "area", driver: "width", driver2: "height" },
      { name: "Micro-cement kit (primer + 2 coats + sealer)", spec: "Covers 60 sq ft", category: "finish", aisle: "Concrete & finishes", quantity: 2, unit: "kit", scaling: "area", driver: "width", driver2: "height" },
      { name: "8/4 white oak slab for mantel", spec: '7 ft × 8 in × 2½"', category: "lumber", aisle: "Hardwood lumber", quantity: 12, unit: "board ft", scaling: "linear", driver: "width" },
      { name: "Floating mantel steel rod brackets", spec: "5/8 in rod, pair", category: "hardware", aisle: "Fasteners", quantity: 1, unit: "set", scaling: "fixed" },
      { name: "Structural screws, 3 in", category: "fasteners", aisle: "Fasteners", quantity: 1, unit: "box", scaling: "fixed" },
      { name: "Drywall compound + tape", category: "consumable", aisle: "Drywall", quantity: 1, unit: "set", scaling: "fixed" },
      { name: "Osmo Polyx hardwax oil", spec: "Clear satin", category: "finish", aisle: "Stains & finishes", quantity: 1, unit: "tin", scaling: "fixed" },
      { name: "20 A receptacle + cable + box", spec: "Dedicated circuit materials", category: "electrical", aisle: "Electrical", quantity: 1, unit: "set", scaling: "fixed" },
    ],
    steps: [
      { title: "Find the studs and plan the circuit", body: "Mark every stud and locate the nearest panel route. The insert wants a dedicated 20 A circuit; price an electrician into the build now rather than discovering it at the end.", tools: ["Stud finder"], minutes: 90, safety: ["Power off at the breaker before opening any box."] },
      { title: "Frame the wall", body: "Build a 2×4 box against the existing wall, plumb and level, with a header sized to the insert's rough opening plus the clearance in its manual. Double the studs either side of the opening.", tools: ["Mitre saw", "Impact driver", "Laser level"], minutes: 300 },
      { title: "Rough in the electrical", body: "Run the new circuit to a box inside the firebox cavity where the manual says it goes. Have it inspected if your area requires it.", tools: [], minutes: 150, safety: ["This step is the one to hand to a licensed electrician."] },
      { title: "Board the frame", body: "Cement backer board in the zone around the insert, drywall everywhere else. Keep a clean break line where micro-cement will stop.", tools: ["Circular saw", "Drywall tools"], minutes: 240 },
      { title: "Tape, fill and sand", body: "Three coats, each feathered wider than the last, sanded between. Micro-cement is thin — it hides nothing, so the substrate has to be flat.", tools: ["Random-orbit sander"], minutes: 300 },
      { title: "Apply micro-cement", body: "Primer, then two thin troweled coats with a 4-hour gap, then two coats of sealer. Work wet-edge across the full width — a stop line in the middle of a wall will show forever.", tools: [], minutes: 330 },
      { title: "Make and hang the mantel", body: "Flatten the slab, break the arris with a 1/8 in round-over, drill for the steel rods on a drill press so they stay parallel, oil, then slide it on. Two coats of hardwax oil, buffed.", tools: ["Random-orbit sander"], minutes: 300, cutList: [{ part: "Mantel", qty: 1, dimensions: '84" × 8" × 2½"', material: "White oak 8/4", notes: "Rod holes 5/8 in × 5 in deep, 32 in apart" }] },
      { title: "Set the insert and finish", body: "Slide the insert in, plug it into the dedicated receptacle, confirm clearances match the manual, then caulk the perimeter in a colour-matched flexible sealant.", tools: [], minutes: 120 },
    ],
  },
  prices: [
    { name: "2×4 kiln-dried stud", unitPrice: 4.28, retailer: "Home Depot", url: "https://www.homedepot.com/" },
    { name: "50 in linear electric fireplace insert", unitPrice: 749, retailer: "Lowe's", url: "https://www.lowes.com/" },
    { name: "Cement backer board, 1/2 in", unitPrice: 16.48, retailer: "Home Depot", url: "https://www.homedepot.com/" },
    { name: "Drywall 1/2 in, 4 × 8 ft", unitPrice: 17.98, retailer: "Home Depot", url: "https://www.homedepot.com/" },
    { name: "Micro-cement kit (primer + 2 coats + sealer)", unitPrice: 189, retailer: "Ideal Work", url: "https://www.idealwork.com/" },
    { name: "8/4 white oak slab for mantel", unitPrice: 12.5, retailer: "Woodworkers Source", url: "https://www.woodworkerssource.com/" },
    { name: "Floating mantel steel rod brackets", unitPrice: 54, retailer: "Amazon", url: "https://www.amazon.com/" },
    { name: "Structural screws, 3 in", unitPrice: 28.97, retailer: "Home Depot", url: "https://www.homedepot.com/" },
    { name: "Drywall compound + tape", unitPrice: 32.5, retailer: "Home Depot", url: "https://www.homedepot.com/" },
    { name: "Osmo Polyx hardwax oil", unitPrice: 59.95, retailer: "Woodcraft", url: "https://www.woodcraft.com/" },
    { name: "20 A receptacle + cable + box", unitPrice: 76, retailer: "Home Depot", url: "https://www.homedepot.com/" },
  ],
  comps: [
    { title: "Fireplace feature wall install (labour + materials)", price: 4200, sold: true, soldAt: "2026-10-11", marketplace: "Thumbtack (completed job)", url: "https://www.thumbtack.com/" },
    { title: "Micro-cement media wall with oak mantel", price: 3850, sold: true, soldAt: "2026-09-22", marketplace: "Houzz (completed project)", url: "https://www.houzz.com/" },
    { title: "Electric fireplace accent wall build", price: 3200, sold: true, soldAt: "2026-08-14", marketplace: "Angi (completed job)", url: "https://www.angi.com/" },
    { title: "Custom fireplace surround + mantel", price: 5100, sold: true, soldAt: "2026-07-30", marketplace: "Houzz (completed project)", url: "https://www.houzz.com/" },
    { title: "Oak floating mantel only", price: 640, sold: true, soldAt: "2026-10-02", marketplace: "Etsy", url: "https://www.etsy.com/" },
  ],
};

const generic: DemoPlan = {
  key: "other",
  match: /.*/,
  spec: {
    title: "Custom build plan",
    summary:
      "A generic shop build priced from the demo catalog. Connect an AI key to get a plan written for your actual idea.",
    buildType: "other",
    skillLevel: "intermediate",
    estimatedHours: 10,
    dimensions: [
      { key: "width", label: "Width", value: 48, unit: "in", min: 12, max: 144, step: 1 },
      { key: "height", label: "Height", value: 30, unit: "in", min: 8, max: 96, step: 1 },
    ],
    tools: ["Mitre saw", "Circular saw", "Impact driver", "Random-orbit sander", "Clamps"],
    safety: [
      "Eye and ear protection for every power tool.",
      "Dust extraction or an N95 mask when sanding.",
      "Check the manual for any tool you haven't used before.",
    ],
    materials: [
      { name: "2×4 kiln-dried stud", category: "lumber", aisle: "Lumber", quantity: 8, unit: "board", scaling: "linear", driver: "width" },
      { name: "Birch plywood, 3/4 in, 4 × 8 ft", category: "sheet", aisle: "Plywood", quantity: 2, unit: "sheet", scaling: "area", driver: "width", driver2: "height" },
      { name: "Pocket-hole screws, 1¼ in", category: "fasteners", aisle: "Fasteners", quantity: 1, unit: "box", scaling: "fixed" },
      { name: "Titebond III wood glue", category: "adhesive", aisle: "Glue & adhesive", quantity: 1, unit: "bottle", scaling: "fixed" },
      { name: "Water-based polyurethane", category: "finish", aisle: "Stains & finishes", quantity: 1, unit: "quart", scaling: "fixed" },
      { name: "Sandpaper assortment", category: "consumable", aisle: "Abrasives", quantity: 1, unit: "pack", scaling: "fixed" },
    ],
    steps: [
      { title: "Measure the space and draw it", body: "Sketch the piece with real numbers before buying anything. Decide the one dimension everything else follows from.", tools: [], minutes: 60 },
      { title: "Break down the sheet goods", body: "Cut plywood oversize with a circular saw and a straight edge, then trim to final size for clean, square edges.", tools: ["Circular saw"], minutes: 90 },
      { title: "Build the carcass", body: "Pocket-hole or dado the frame together. Check it for square on the diagonals before the glue sets.", tools: ["Impact driver", "Clamps"], minutes: 180 },
      { title: "Fit and fair", body: "Dry-fit everything, mark what needs trimming, and plane or sand to a consistent gap.", tools: ["Random-orbit sander"], minutes: 120 },
      { title: "Finish", body: "Sand to 180, de-dust, then three thin coats of poly with a light scuff between coats.", tools: ["Random-orbit sander"], minutes: 150 },
    ],
  },
  prices: [
    { name: "2×4 kiln-dried stud", unitPrice: 4.28, retailer: "Home Depot", url: "https://www.homedepot.com/" },
    { name: "Birch plywood, 3/4 in, 4 × 8 ft", unitPrice: 78.5, retailer: "Home Depot", url: "https://www.homedepot.com/" },
    { name: "Pocket-hole screws, 1¼ in", unitPrice: 12.98, retailer: "Lowe's", url: "https://www.lowes.com/" },
    { name: "Titebond III wood glue", unitPrice: 11.98, retailer: "Home Depot", url: "https://www.homedepot.com/" },
    { name: "Water-based polyurethane", unitPrice: 29.98, retailer: "Home Depot", url: "https://www.homedepot.com/" },
    { name: "Sandpaper assortment", unitPrice: 16.99, retailer: "Home Depot", url: "https://www.homedepot.com/" },
  ],
  comps: [
    { title: "Handmade custom furniture piece", price: 480, sold: true, soldAt: "2026-10-09", marketplace: "Facebook Marketplace", url: "https://www.facebook.com/marketplace/" },
    { title: "Custom woodwork commission", price: 650, sold: true, soldAt: "2026-09-18", marketplace: "Etsy", url: "https://www.etsy.com/" },
    { title: "Shop-built cabinet", price: 395, sold: true, soldAt: "2026-08-25", marketplace: "Craigslist", url: "https://craigslist.org/" },
  ],
};

export const DEMO_PLANS: DemoPlan[] = [frame, hotTubBoat, fireplace, generic];

/** Pick the demo plan that best matches what the user typed. */
export function pickDemoPlan(text: string): DemoPlan {
  for (const plan of DEMO_PLANS) {
    if (plan.key !== "other" && plan.match.test(text)) return plan;
  }
  return generic;
}
