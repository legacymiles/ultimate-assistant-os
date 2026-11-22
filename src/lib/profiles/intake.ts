// ---------------------------------------------------------------------------
// New-profile intake: what kind of profile this is, where it goes, and the
// questions that fit it.
//
// "Make a profile for my son" and "add my t-shirt printing business" must not
// get the same questions. A son's profile wants school, doctor, sizes and
// dates; a business wants its equipment (what, when bought, from whom), its
// vendors, its websites, and which email address is used for which site —
// owners often use several emails inside one business. This file is the
// owner's own intake guide; both the harness prompt and the offline reader
// use it, so every brain asks the same, specific questions.
//
// Pure: no I/O, so it is tested and shared by the client and the prompt.
// ---------------------------------------------------------------------------

import type { NodeKind } from "./types";

export type IntakeType =
  | "child"
  | "partner"
  | "parent"
  | "relative"
  | "friend"
  | "teacher"
  | "doctor"
  | "coworker"
  | "person"
  | "business"
  | "job"
  | "equipment"
  | "place"
  | "thing";

export interface IntakeGuide {
  type: IntakeType;
  kind: NodeKind;
  /** "Teacher", "Business" — the small label over the name. */
  label: string;
  icon?: string;
  /** Where a profile like this usually lives, as a hint to the brain. */
  homeHint: string;
  /** Sections this kind of profile usually grows, in order. Never pre-made empty. */
  sections: string[];
  /** The questions, most useful first. Jarvis asks one or two at a time. */
  questions: string[];
}

const G = (g: IntakeGuide) => g;

export const GUIDES: Record<IntakeType, IntakeGuide> = {
  child: G({
    type: "child", kind: "person", label: "Person", homeHint: "Profiles home, linked inside My Profile",
    sections: ["Personal information", "Important dates", "School", "Health", "Activities", "Family", "Sizes"],
    questions: [
      "What's their full name and birthday?",
      "Which school and grade, and who is the teacher?",
      "Who is their doctor or dentist, and any allergies or medicines?",
      "What activities or teams are they in, and when is practice?",
      "Clothing and shoe sizes right now?",
    ],
  }),
  partner: G({
    type: "partner", kind: "person", label: "Person", homeHint: "Profiles home, linked inside My Profile",
    sections: ["Personal information", "Important dates", "Favorites", "Sizes", "Gift ideas"],
    questions: [
      "What's her or his full name and birthday?",
      "When is your anniversary, and any other dates you can't miss?",
      "Favorite flowers, food, coffee order, places?",
      "Ring, clothing and shoe sizes?",
      "Anything they've mentioned wanting lately, for gift ideas?",
    ],
  }),
  parent: G({
    type: "parent", kind: "person", label: "Family", homeHint: "Inside My Profile › Family",
    sections: ["Personal information", "Important dates", "Health", "Contacts"],
    questions: ["Full name, birthday and phone?", "Doctors, medicines or care details you keep track of?", "Address, and anyone to call in an emergency?"],
  }),
  relative: G({
    type: "relative", kind: "person", label: "Family", homeHint: "Inside My Profile › Family",
    sections: ["Personal information", "Important dates", "Contacts"],
    questions: ["How are they related to you, and their birthday?", "Phone, email and address?"],
  }),
  friend: G({
    type: "friend", kind: "person", label: "Friend", homeHint: "Inside My Profile",
    sections: ["Personal information", "Important dates", "Contacts"],
    questions: ["Their birthday, and how you know them?", "Phone, email or socials?"],
  }),
  teacher: G({
    type: "teacher", kind: "person", label: "Teacher", homeHint: "Inside the child's School profile",
    sections: ["Contact", "Class", "Important dates", "Notes"],
    questions: [
      "Which class or subject, and which room?",
      "Their email, and the best way to reach them?",
      "Any conferences or dates coming up?",
    ],
  }),
  doctor: G({
    type: "doctor", kind: "thing", label: "Doctor", icon: "stethoscope", homeHint: "Inside the patient's profile",
    sections: ["Contact", "Records", "Important dates"],
    questions: ["Clinic name, phone and address?", "Last visit and next appointment?", "Insurance or member ID they use?"],
  }),
  coworker: G({
    type: "coworker", kind: "person", label: "Coworker", homeHint: "Inside the job's profile",
    sections: ["Contact", "Role", "Notes"],
    questions: ["What's their role, and do you work the same shifts?", "Phone or work email?"],
  }),
  person: G({
    type: "person", kind: "person", label: "Person", homeHint: "Profiles home or inside My Profile",
    sections: ["Personal information", "Important dates", "Contacts", "Notes"],
    questions: ["How do you know them, and their birthday?", "Phone, email and address?", "Anything you always need to remember about them?"],
  }),
  business: G({
    type: "business", kind: "thing", label: "Business", icon: "briefcase", homeHint: "Inside My Businesses",
    sections: ["Equipment", "Vendors", "Websites", "Business emails", "Accounts and logins", "Purchases", "Expenses", "Resources", "Contacts"],
    questions: [
      "What equipment do you use? Each machine gets its own profile inside Equipment (see the equipment guide — ask its questions there, not here).",
      "Who are your vendors and suppliers, and what do you buy from each?",
      "Which websites and stores does the business use — your shop, marketplaces, social pages?",
      "Which email address do you use for which site? Many businesses use more than one, so list each email and what it's for.",
      "Any logins, account numbers or payout accounts I should keep (they'll stay hidden until tapped)?",
      "Recent purchases or regular expenses you want tracked?",
      "Tools, templates and resources you rely on?",
    ],
  }),
  job: G({
    type: "job", kind: "thing", label: "Job", icon: "badge", homeHint: "Inside My Jobs (current or past)",
    sections: ["Work info", "Schedule", "Access", "Coworkers", "Pay", "Emails and logins"],
    questions: [
      "Is this a current or past job, what's your title, and when did you start?",
      "Who's your manager, and which coworkers should I keep?",
      "Any door codes, gas or safe codes, PINs or login codes (hidden until tapped)?",
      "What email do you use for work, and for which sites (scheduling, payroll)?",
      "Your usual shifts, and when is payday?",
    ],
  }),
  // A machine is the one profile where the owner's own words are never enough.
  // "Lancelot M1630 Pro A3 13-inch all-in-one DTF kit" is a shop LISTING, and a
  // listing is a bundle: the same name ships with or without the shaker, the
  // cutter, a pre-loaded laptop, a different printhead. So these questions ask
  // for what is stamped on the machine and installed on the computer, not what
  // the advert said — those are the facts that make a how-do-I answer correct
  // instead of plausible. Asked in this order because each one unlocks more
  // than the next: the software and the consumables settle most questions,
  // the serial settles the rest.
  equipment: G({
    type: "equipment", kind: "thing", label: "Equipment", icon: "wrench",
    homeHint: "Inside the business or place it is used in (Equipment)",
    sections: ["Details", "Software", "Supplies", "Settings that work", "Maintenance", "Problems and fixes", "Purchase", "Support"],
    questions: [
      "What does the machine itself say — the model on its plate or sticker, and the serial number? That often differs from the name on the listing you bought.",
      "What software runs it, exact name and version, and did it come pre-installed on a computer with it or do you install it yourself?",
      "What does it use up — ink, film, powder, blades, filament, thread? The brand and type of each, since the right settings depend on it.",
      "Which settings already work for you — temperatures, times, speeds, passes, profiles? I'll keep them so you never have to find them twice.",
      "What else does it need to work — a computer and its Windows or macOS version, a press, an extractor, a particular outlet?",
      "Who did you buy it from and when, what did it cost, and how long is the warranty?",
      "Where is its manual or support — a PDF, a WhatsApp or Facebook group, the seller's email?",
      "What goes wrong with it, and what fixed it last time?",
    ],
  }),
  place: G({
    type: "place", kind: "thing", label: "Place", icon: "home", homeHint: "Inside the profile it belongs to",
    sections: ["Details", "Contacts", "Access"],
    questions: ["Address, and who to contact there?", "Any codes or keys to remember?"],
  }),
  thing: G({
    type: "thing", kind: "thing", label: "Folder", icon: "folder", homeHint: "Inside the profile it belongs to",
    sections: ["Details", "Notes"],
    questions: ["What should I know about it — when you got it, from where, and anything you look up often?"],
  }),
};

const BUSINESS = /\b(business|company|shop|store|studio|brand|llc|inc|printing|print shop|bakery|salon|agency|side hustle|hustle|resale|reselling|3d printing|t-?shirt)\b/i;
const JOB = /\b(job|work|employer|workplace|gig|shift)\b/i;

/** Machines and tools: things with a model number, software and consumables. */
const EQUIPMENT =
  /\b(printer|press|machine|laser|engraver|cutter|plotter|cnc|shaker|dryer|oven|kiln|embroiderer|serger|compressor|generator|mower|camera|laptop|desktop|pc|rig|gpu|console|equipment|dtf|dtg|uv printer|sublimation|vinyl|heat press|3d printer)\b/i;
/** A word that means the BUSINESS itself, so "my printing business" never reads as a machine. */
const EXPLICIT_BUSINESS = /\b(business|company|llc|inc|shop|store|studio|brand|agency|hustle)\b/i;

/** What kind of profile a request is asking for. */
export function classifyIntake(text: string): IntakeGuide {
  const t = ` ${text.toLowerCase()} `;
  if (/\b(teacher|tutor|coach)\b/.test(t)) return GUIDES.teacher;
  if (/\b(doctor|dentist|pediatrician|therapist|clinic)\b/.test(t)) return GUIDES.doctor;
  if (/\b(coworker|co-worker|manager|boss|colleague)\b/.test(t)) return GUIDES.coworker;
  if (/\b(son|daughter|kid|child|baby|stepson|stepdaughter)\b/.test(t)) return GUIDES.child;
  if (/\b(girlfriend|boyfriend|wife|husband|partner|fianc[eé]e?|spouse)\b/.test(t)) return GUIDES.partner;
  if (/\b(mom|mother|dad|father|grandma|grandpa|grandmother|grandfather)\b/.test(t)) return GUIDES.parent;
  if (/\b(brother|sister|aunt|uncle|cousin|nephew|niece)\b/.test(t)) return GUIDES.relative;
  if (/\b(friend|buddy|bestie)\b/.test(t)) return GUIDES.friend;
  // Before BUSINESS: "my DTF printer" is a machine, "my printing business" is not.
  if (EQUIPMENT.test(t) && !EXPLICIT_BUSINESS.test(t)) return GUIDES.equipment;
  if (BUSINESS.test(t)) return GUIDES.business;
  if (JOB.test(t)) return GUIDES.job;
  if (/\b(house|apartment|home|cabin|office|storage unit)\b/.test(t)) return GUIDES.place;
  return GUIDES.person;
}

const ROLE_WORDS =
  "son|daughter|kid|child|baby|girlfriend|boyfriend|wife|husband|partner|mom|mother|dad|father|grandma|grandpa|brother|sister|aunt|uncle|cousin|friend|teacher|coach|doctor|dentist|coworker|co-worker|manager|boss";

/** "create a profile for my t-shirt printing business" → "T-shirt printing business". */
export function intakeName(text: string): string {
  let s = text
    .replace(/^\s*(please\s+)?(can you\s+)?(create|make|add|start|set up|setup|new)\s+(a\s+|an\s+)?(new\s+)?(profile|folder|page)?\s*(for|about|of|called|named)?\s*/i, "")
    .replace(/\b(profile|folder)\b/gi, "")
    .replace(/^(my|our|the|a|an)\s+/i, "")
    .replace(/[.?!]+$/, "")
    .trim();
  const named = s.match(/\b(?:named|called)\s+(.+)$/i);
  if (named) s = named[1];
  // "son Leo" → "Leo"; "son" alone → "My son"; "son's teacher" stays as is.
  const role = s.match(new RegExp(`^(${ROLE_WORDS})\\b\\s*(.*)$`, "i"));
  if (role && !/^['’]s\b/.test(role[2])) {
    const rest = role[2].replace(/^(named|called|is)\s+/i, "").trim();
    s = rest ? rest : `My ${role[1].toLowerCase()}`;
  }
  s = s.replace(/\s+/g, " ").slice(0, 60);
  return s ? s[0].toUpperCase() + s.slice(1) : "New profile";
}

/** Is this message asking for a new profile? */
export function isNewProfileAsk(text: string): boolean {
  return /^\s*(please\s+)?(can you\s+)?(create|make|add|start|set up|setup)\s+(a\s+|an\s+)?(new\s+)?(profile|folder|page)\b/i.test(text) ||
    /^\s*(create|make|add|start)\s+(a\s+)?(new\s+)?profile\b/i.test(text) ||
    (/^\s*(create|make|add)\s+(a\s+profile\s+for|my|our)\b.*\b(profile|business|job|son|daughter|girlfriend|wife|teacher)\b/i.test(text) &&
      // "add my son's shoe size is 3Y" is a fact, not a new profile.
      !/\b(is|are|was|to)\b|[:=]/i.test(text.replace(/^\s*(create|make|add)\s+(a\s+profile\s+for\s+)?/i, "")));
}

/** The intake guide as it goes into a brain's prompt. */
export function intakePromptBlock(): string {
  const lines = Object.values(GUIDES)
    .filter((g) => !["relative", "friend", "place", "thing"].includes(g.type))
    .map((g) => `- ${g.type} (${g.kind}, lives: ${g.homeHint}): grows sections ${g.sections.join(", ")}. Ask about: ${g.questions.join(" / ")}`);
  return [
    "NEW-PROFILE INTAKE",
    "When the owner asks for a new profile: (1) look through FOUND ELSEWHERE and the outline for anything already known about it and file those facts into the new profile in the same change set, citing where each came from; (2) put it in the right parent (a teacher inside the child's School, a business inside My Businesses, a job inside My Jobs); (3) ask ONE or TWO questions from its guide that are not already answered, with short chips. Never create empty sections.",
    ...lines,
  ].join("\n");
}
