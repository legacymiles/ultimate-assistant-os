// ---------------------------------------------------------------------------
// The example profiles a first visit opens on.
//
// An empty Profiles page shows nothing about what it does, so a first visit
// opens on a realistic, clearly-marked example world: a son, a girlfriend, a
// t-shirt printing business and a gas-station job. Every node is flagged
// `example`, the page says so in a banner, and "Clear examples" removes all of
// it in one tap. None of it is the owner's own data.
// ---------------------------------------------------------------------------

import type { Item, Media, ProfileNode, ProfilesData, Section } from "./types";

let n = 0;
const sid = (node: string) => `${node}-s${++n}`;
const iid = (node: string) => `${node}-i${++n}`;

type Row = [string, string, Partial<Item>?];

function sec(node: string, title: string, icon: string, rows: Row[]): Section {
  return {
    id: sid(node),
    title,
    icon,
    items: rows.map(([k, v, extra]) => ({ id: iid(node), k, v, ...(extra ?? {}) })),
  };
}

function media(node: string, list: [Media["kind"], string, string, string?, string?][]): Media[] {
  return list.map(([kind, scene, caption, date, dur]) => ({ id: `${node}-m${++n}`, kind, scene, caption, date, dur }));
}

function node(
  id: string,
  o: Partial<ProfileNode> & Pick<ProfileNode, "name" | "label" | "sub">,
  build?: (id: string) => { sections?: Section[]; media?: Media[] },
): ProfileNode {
  const made = build ? build(id) : {};
  return {
    id,
    kind: "thing",
    children: [],
    links: [],
    sections: made.sections ?? [],
    media: made.media ?? [],
    example: true,
    ...o,
  };
}

export const ROOT = "root";

export function seedProfiles(): ProfilesData {
  n = 0;
  const list: ProfileNode[] = [
    {
      id: ROOT,
      name: "Profiles",
      kind: "thing",
      label: "Home",
      sub: "",
      children: ["me", "son", "gf", "biz", "jobs"],
      links: [],
      sections: [],
      media: [],
    },

    // --- me ------------------------------------------------------------
    node(
      "me",
      { name: "My Profile", kind: "person", label: "You", sub: "Car, documents, health", icon: "user", hue: 34, children: ["car"], links: ["son", "gf", "biz", "jobs"], aliases: ["me", "myself", "my"], asks: ["When is my car registration due?", "What's my insurance policy number?"] },
      (id) => ({
        sections: [
          sec(id, "Personal information", "id-card", [["Phone", "(555) 014-2290"], ["Home address", "418 Alder St, Apt 3"], ["Driver's licence", "Expires Aug 2028"], ["Blood type", "O+"]]),
          sec(id, "Important dates", "calendar", [["My birthday", "Mar 14", { date: "2027-03-14" }], ["Car registration due", "Jan 9, 2027", { date: "2027-01-09" }], ["Lease renewal", "Apr 1, 2027", { date: "2027-04-01" }]]),
        ],
        media: media(id, [["photo", "sky", "Lake trip", "Aug 2026"], ["photo", "night", "Downtown", "Sep 2026"], ["photo", "beach", "Beach day", "Jul 2026"]]),
      }),
    ),
    node("car", { name: "Car", label: "Vehicle", sub: "2019 Civic · silver", icon: "car" }, (id) => ({
      sections: [
        sec(id, "Details", "info", [["Plate", "8KTR 214"], ["VIN", "2HGFC2F69KH512044", { secret: true }]]),
        sec(id, "Insurance", "shield", [["Provider", "Clearway Auto"], ["Policy number", "CW-88120-4471", { secret: true }], ["Renews", "Mar 2, 2027", { date: "2027-03-02" }]]),
        sec(id, "Service", "wrench", [["Last oil change", "Oct 2, 2026 · 41,200 mi"], ["Next due", "About 44,200 mi"]]),
      ],
    })),

    // --- son -----------------------------------------------------------
    node(
      "son",
      { name: "My Son", kind: "person", label: "Person", sub: "Leo · 9 · 4th grade", initials: "L", hue: 158, children: ["school", "soccer", "pediatrician", "teacher"], aliases: ["leo", "son", "kid", "boy"], asks: ["When is Leo's next dentist visit?", "Show me pictures of my son", "Move my son's teacher profile into his school folder"] },
      (id) => ({
        sections: [
          sec(id, "Personal information", "user", [["Full name", "Leo Marquez"], ["Birthday", "Jun 2, 2017"], ["Shoe size", "2Y"], ["Shirt size", "Youth M"], ["Allergies", "Peanuts, mild"]]),
          sec(id, "Important dates", "calendar", [["Dentist", "Dec 4, 2026 · 3:30 pm", { date: "2026-12-04" }], ["Winter break starts", "Dec 19, 2026", { date: "2026-12-19" }], ["Birthday", "Jun 2", { date: "2027-06-02" }]]),
          sec(id, "Family", "users", [["Mom", "Andrea · (555) 017-4410"], ["Grandma", "Rosa · (555) 019-2231"]]),
        ],
        media: media(id, [["photo", "portrait", "Picture day", "Sep 2026"], ["photo", "beach", "Beach with Grandma", "Jul 2026"], ["photo", "cake", "9th birthday", "Jun 2, 2026"], ["video", "sky", "First bike ride", "May 2026", "0:41"]]),
      }),
    ),
    node("school", { name: "School", label: "School", sub: "Lincoln Elementary · Grade 4", icon: "graduation-cap", aliases: ["school", "lincoln", "elementary"] }, (id) => ({
      sections: [
        sec(id, "Class", "book-open", [["Grade", "4 · Room 12"], ["Pickup", "3:05 pm, east gate"], ["Lunch account PIN", "2290", { secret: true }]]),
        sec(id, "Office", "building-2", [["Phone", "(555) 010-3300"], ["Email", "office@lincoln-elem.org"], ["Address", "1200 Lincoln Ave"]]),
        sec(id, "Important dates", "calendar", [["Parent–teacher conference", "Jan 14, 2027 · 4:15 pm", { date: "2027-01-14" }], ["Picture day", "Feb 3, 2027", { date: "2027-02-03" }]]),
      ],
      media: media(id, [["photo", "room", "Classroom open house", "Sep 2026"], ["photo", "field", "Field day", "Oct 2026"]]),
    })),
    node("teacher", { name: "Ms. Alvarez", kind: "person", label: "Teacher", sub: "4th grade teacher", initials: "MA", aliases: ["teacher", "alvarez"] }, (id) => ({
      sections: [
        sec(id, "Contact", "mail", [["Email", "j.alvarez@lincoln-elem.org"], ["Best way to reach her", "Email, replies within a day"]]),
        sec(id, "Notes", "notebook-pen", [["Reading group", "Leo sits near the front"]]),
      ],
    })),
    node("soccer", { name: "Soccer", label: "Team", sub: "Rapids U10 · Coach Ben", icon: "trophy", aliases: ["soccer", "rapids", "team", "game"] }, (id) => ({
      sections: [
        sec(id, "Schedule", "clock", [["Practice", "Tue and Thu · 5:30 pm"], ["Games", "Saturdays, check the team app"], ["Field", "Hanover Park, Field 3"]]),
        sec(id, "Contacts", "users", [["Coach", "Ben Okafor · (555) 013-8821"]]),
        sec(id, "Gear", "shirt", [["Cleats", "Size 2Y"]]),
      ],
      media: media(id, [["photo", "field", "First goal", "Oct 18, 2026"], ["video", "field", "Penalty kick", "Oct 18, 2026", "0:24"], ["photo", "field", "Team photo", "Sep 2026"], ["photo", "sunset", "After the final", "Nov 1, 2026"]]),
    })),
    node("pediatrician", { name: "Pediatrician", label: "Doctor", sub: "Dr. Patel · Northgate Kids Clinic", icon: "stethoscope", aliases: ["doctor", "patel", "clinic"] }, (id) => ({
      sections: [
        sec(id, "Contact", "phone", [["Phone", "(555) 016-7720"], ["Address", "88 Northgate Blvd, Suite 4"]]),
        sec(id, "Records", "clipboard-list", [["Last checkup", "Aug 12, 2026"], ["Vaccines", "Up to date"], ["Insurance member ID", "NKC-4410-778", { secret: true }]]),
      ],
    })),

    // --- girlfriend ------------------------------------------------------
    node(
      "gf",
      { name: "My Girlfriend", kind: "person", label: "Person", sub: "Maya", initials: "M", hue: 345, children: ["gifts"], aliases: ["maya", "girlfriend", "gf", "partner"], asks: ["What's Maya's ring size?", "Remember Maya's favorite color is green"] },
      (id) => ({
        sections: [
          sec(id, "Personal information", "user", [["Birthday", "Sep 27", { date: "2027-09-27" }], ["Ring size", "6"], ["Coffee order", "Oat flat white, extra hot"], ["Favorite flowers", "Ranunculus, never lilies"]]),
          sec(id, "Important dates", "calendar", [["Anniversary", "May 18", { date: "2027-05-18" }], ["Her sister's wedding", "Jun 12, 2027", { date: "2027-06-12" }]]),
        ],
        media: media(id, [["photo", "night", "Concert", "Oct 2026"], ["photo", "beach", "Santa Cruz", "Aug 2026"], ["photo", "cake", "Her birthday dinner", "Sep 27, 2026"]]),
      }),
    ),
    node("gifts", { name: "Gift ideas", label: "List", sub: "Things she mentioned", icon: "gift", aliases: ["gifts", "gift ideas", "presents"] }, (id) => ({
      sections: [
        sec(id, "Ideas", "sparkles", [["Ceramics class for two", "Mentioned in October"], ["Film camera", "Point-and-shoot, 35mm"], ["Santal candle", "The big one"]]),
        sec(id, "Already gave", "check", [["Scarf", "Sep 2026", { money: 68 }]]),
      ],
    })),

    // --- businesses ------------------------------------------------------
    node(
      "biz",
      { name: "My Businesses", label: "Businesses", sub: "Northside Prints · Resale shop", icon: "briefcase", hue: 208, children: ["prints", "resell"], aliases: ["business", "businesses", "company"], asks: ["What email do I use for my printing suppliers?", "Open heat press"] },
      (id) => ({
        sections: [sec(id, "Shared", "landmark", [["Accountant", "Lena Brooks, CPA · (555) 012-7781"], ["Business bank", "Ridgeline Credit Union", { meta: "Account ending 4410" }], ["EIN", "88-3104472", { secret: true }]])],
      }),
    ),
    node(
      "prints",
      { name: "Northside Prints", label: "Business", sub: "T-shirt printing · since 2024", icon: "shirt", children: ["equipment", "vendors"], aliases: ["printing", "print", "prints", "t-shirt", "tshirt", "shirts", "print shop", "shop"], asks: ["What email do I use for my printing suppliers?", "What are my heat press settings for DTF?"] },
      (id) => ({
        sections: [
          sec(id, "Business emails", "mail", [["Orders", "orders@northsideprints.shop"], ["Suppliers", "northside.supply@gmail.com", { meta: "Used for every vendor login" }], ["Payouts", "billing@northsideprints.shop"]]),
          sec(id, "Websites", "globe", [["Shop", "northsideprints.shop"], ["Etsy", "etsy.com/shop/NorthsidePrints"], ["Instagram", "@northside.prints"]]),
          sec(id, "Purchases", "receipt", [["Gildan 5000 × 144", "$431.28", { money: 431.28, meta: "Oct 30" }], ["DTF film roll 13 in × 100 ft", "$96.00", { money: 96, meta: "Oct 12" }], ["Teflon sheets × 3", "$24.99", { money: 24.99, meta: "Sep 28" }]]),
          sec(id, "Expenses", "wallet", [["Shopify plan", "$39.00", { money: 39, meta: "Monthly" }], ["Etsy fees", "$62.40", { money: 62.4, meta: "October" }], ["Holiday Market booth", "$120.00", { money: 120, meta: "Dec 6", date: "2026-12-06" }]]),
          sec(id, "Resources", "book-open", [["Pricing sheet 2026", "Google Sheets"], ["Mockup templates", "Canva folder"]]),
          sec(id, "Contacts", "users", [["Tasha", "Screen print partner · (555) 016-0921"], ["Holiday Market", "market@hanoverevents.org"]]),
        ],
        media: media(id, [["photo", "studio", "New drop · black tees", "Nov 2026"], ["photo", "warm", "Booth setup", "Oct 2026"], ["photo", "studio", "Hoodie mockup", "Oct 2026"]]),
      }),
    ),
    node("equipment", { name: "Equipment", label: "Folder", sub: "3 machines", icon: "wrench", children: ["heatpress", "dtf", "cutter"], aliases: ["equipment", "machines", "tools"] }),
    node("heatpress", { name: "Heat Press", label: "Equipment", sub: "Fusion 16×20 clamshell", icon: "flame", aliases: ["heat press", "press", "heatpress"], asks: ["When does the warranty end?", "Settings for poly blends", "I replaced the teflon sheet today"] }, (id) => ({
      sections: [
        sec(id, "Settings", "sliders-horizontal", [["DTF transfers", "300°F · 12 s · medium pressure, peel warm"], ["Cotton vinyl", "315°F · 15 s · firm"], ["Poly blends", "270°F · 10 s · light"]]),
        sec(id, "Details", "info", [["Bought", "Mar 3, 2025 · $1,849 from Blank Supply Co."], ["Serial", "FN16-22-08841", { secret: true }], ["Warranty", "Until Mar 3, 2027", { date: "2027-03-03" }]]),
        sec(id, "Maintenance", "wrench", [["Teflon sheet", "Replace monthly · last Oct 28"], ["Platen", "Wipe with isopropyl after each run"]]),
      ],
      media: media(id, [["photo", "studio", "Press, front", "Mar 2025"], ["photo", "warm", "First print", "Mar 2025"]]),
    })),
    node("dtf", { name: "DTF Printer", label: "Equipment", sub: "13-inch roll printer", icon: "printer", aliases: ["dtf", "printer"] }, (id) => ({
      sections: [sec(id, "Details", "info", [["Ink", "CMYK + white, 250 ml"], ["Head cleaning", "Every morning before printing"]])],
    })),
    node("cutter", { name: "Vinyl Cutter", label: "Equipment", sub: "24-inch plotter", icon: "scissors", aliases: ["cutter", "vinyl", "plotter"] }, (id) => ({
      sections: [sec(id, "Details", "info", [["Blade", "45°, swapped Sep 2026"], ["Software", "Sure Cuts A Lot 6"]])],
    })),
    node("vendors", { name: "Vendors", label: "Folder", sub: "Where blanks and film come from", icon: "truck", children: ["blank", "inkfilm"], aliases: ["vendors", "suppliers", "supplier", "vendor"] }),
    node("blank", { name: "Blank Supply Co.", label: "Vendor", sub: "Blank tees and hoodies", icon: "store", aliases: ["blank supply", "blanks"] }, (id) => ({
      sections: [sec(id, "Account", "key-round", [["Rep", "Marcus Lee"], ["Rep email", "marcus@blanksupplyco.com"], ["Login email", "northside.supply@gmail.com"], ["Account number", "BSC-118204", { secret: true }], ["Terms", "Net 15, free freight over $250"]])],
    })),
    node("inkfilm", { name: "Ink and Film Depot", label: "Vendor", sub: "DTF film, powder, ink", icon: "droplet", aliases: ["ink", "film", "depot"] }, (id) => ({
      sections: [sec(id, "Account", "key-round", [["Order email", "orders@inkfilmdepot.com"], ["Login email", "northside.supply@gmail.com"], ["Discount", "10% off over $150 · code NORTH10"]])],
    })),
    node("resell", { name: "Resale shop", label: "Business", sub: "eBay · sneakers and vintage", icon: "package", aliases: ["resale", "ebay", "resell"] }, (id) => ({
      sections: [
        sec(id, "Accounts", "key-round", [["eBay store", "northside_finds"], ["Payouts", "Ridgeline Credit Union", { meta: "Account ending 4410" }]]),
        sec(id, "Shipping", "truck", [["Label printer", "Rollo, 4×6"], ["Post office drop", "Mon and Thu after 4 pm"]]),
      ],
    })),

    // --- jobs ------------------------------------------------------------
    node(
      "jobs",
      { name: "My Jobs", label: "Work", sub: "Riverside Shell · DoorDash", icon: "fuel", hue: 268, children: ["shell", "dash"], aliases: ["jobs", "work"], asks: ["What is the gas code at my job?", "Who is my manager?", "Change the gas code to 5520"] },
    ),
    node("shell", { name: "Riverside Shell", label: "Job", sub: "Shift lead · since 2023", icon: "fuel", aliases: ["job", "work", "shell", "gas station", "station", "riverside"], asks: ["What is the gas code at my job?", "When is payday?"] }, (id) => ({
      sections: [
        sec(id, "Access", "key-round", [["Gas code", "4471", { secret: true }], ["Back door keypad", "2580", { secret: true }], ["Staff Wi-Fi", "Shell-Staff · riverside!23", { secret: true }]]),
        sec(id, "Schedule", "clock", [["Shifts", "Mon, Wed, Fri · 6 am – 2 pm"], ["Payday", "Every other Friday · next Nov 27", { date: "2026-11-27" }]]),
        sec(id, "Contacts", "users", [["Manager", "Dana Whitfield · (555) 015-3390"], ["District line", "(555) 010-7712"]]),
        sec(id, "Work info", "badge", [["Employee ID", "RS-20931", { secret: true }], ["Uniform", "2 shirts issued, size L"]]),
      ],
    })),
    node("dash", { name: "DoorDash", label: "Job", sub: "Weekend evenings", icon: "car", aliases: ["doordash", "dash", "delivery"] }, (id) => ({
      sections: [sec(id, "Account", "key-round", [["Best zone", "Downtown, Fri 5–9 pm"], ["Mileage log", "Kept in the Stride app"]])],
    })),
  ];

  const nodes: Record<string, ProfileNode> = {};
  for (const x of list) nodes[x.id] = x;
  return {
    version: 1,
    nodes,
    memory: [
      { id: "mem-1", about: "son", k: "Food he won't eat", v: "Pickles and mushrooms" },
      { id: "mem-2", about: "prints", k: "Reorder blanks when", v: "Under 40 black tees left" },
      { id: "mem-3", about: "shell", k: "Safe drop", v: "Every $200 over the till float" },
      { id: "mem-4", about: "gf", k: "Shoe size", v: "7.5" },
    ],
    log: [],
    examples: true,
    settings: { mask: true, brain: "auto" },
  };
}

/** A fresh, empty world: just the home folder. */
export function emptyProfiles(): ProfilesData {
  return {
    version: 1,
    nodes: { [ROOT]: { id: ROOT, name: "Profiles", kind: "thing", label: "Home", sub: "", children: [], links: [], sections: [], media: [] } },
    memory: [],
    log: [],
    examples: false,
    settings: { mask: true, brain: "auto" },
  };
}
