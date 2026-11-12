/**
 * commercial 2x · Step 1 — the business model.
 *
 * BuildFlip is a tool, so it is a freemium subscription. The free tier has a
 * real limit that proves the product (ONE complete plan, no card), and the
 * paywall appears at the exact moment the second plan is requested — the
 * moment the user already believes it.
 *
 * Pricing is honest by construction: the price shown is the price charged,
 * the trial says when billing starts, cancelling is one click in the Stripe
 * portal, and there is no hidden fee anywhere.
 */

export interface Tier {
  id: "free" | "pro" | "shop";
  name: string;
  tagline: string;
  monthly: number | null;
  annual: number | null;
  /** Shown as "Most popular". */
  featured?: boolean;
  cta: string;
  features: { text: string; included: boolean }[];
  note?: string;
}

export const TRIAL_DAYS = 7;

export const TIERS: Tier[] = [
  {
    id: "free",
    name: "Free",
    tagline: "Prove it on one build",
    monthly: 0,
    annual: 0,
    cta: "Start free",
    features: [
      { text: "One complete plan, no card", included: true },
      { text: "Live material prices with sources", included: true },
      { text: "Resale range from completed sales", included: true },
      { text: "The ROI verdict and hourly rate", included: true },
      { text: "Shopping list and share link", included: true },
      { text: "Unlimited plans", included: false },
      { text: "Re-price a plan whenever you like", included: false },
      { text: "Track real cost against the estimate", included: false },
      { text: "Compare builds side by side", included: false },
    ],
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "For anyone flipping more than one idea",
    monthly: 9,
    annual: 90,
    featured: true,
    cta: `Start ${TRIAL_DAYS}-day free trial`,
    features: [
      { text: "Unlimited plans", included: true },
      { text: "Re-price any plan against today's listings", included: true },
      { text: "Track real cost as you build", included: true },
      { text: "Compare builds by profit per hour", included: true },
      { text: "Your receipts sharpen future estimates", included: true },
      { text: "Full source trail on every number", included: true },
      { text: "Export the shopping list", included: true },
      { text: "Email support", included: true },
    ],
    note: `${TRIAL_DAYS} days free, then $9/month. Cancel any time — one click, no email required.`,
  },
  {
    id: "shop",
    name: "Shop",
    tagline: "For a workshop running jobs for customers",
    monthly: 29,
    annual: 290,
    cta: "Talk to us",
    features: [
      { text: "Everything in Pro", included: true },
      { text: "Up to 5 people on one workshop", included: true },
      { text: "Client-ready plan links with your name on them", included: true },
      { text: "Quote mode: materials + your labour rate", included: true },
      { text: "Priority support", included: true },
    ],
    note: "Seats and quote mode are in build. Email us and we'll set you up at this price now.",
  },
];

export const ANNUAL_MONTHS_FREE = 2;

export const PRICING_FAQ: { q: string; a: string }[] = [
  {
    q: "What exactly do I get free?",
    a: "One complete plan — the full step-by-step build, the priced materials list with real sources, the resale range from completed sales, and the ROI verdict. No card, no trial countdown on it. It is the whole product on one build.",
  },
  {
    q: "When does billing start on the trial?",
    a: `The ${TRIAL_DAYS}-day trial is free and we tell you the exact date your card is first charged before you confirm. If you cancel before then you are charged nothing.`,
  },
  {
    q: "How do I cancel?",
    a: "One click in Settings, which opens Stripe's own billing portal. No email, no phone call, no retention maze. You keep access until the end of the period you already paid for.",
  },
  {
    q: "Do you refund?",
    a: "Yes. If BuildFlip's estimate sent you badly wrong on a build inside your first 30 days, email us and we refund the month, no argument.",
  },
  {
    q: "What happens to my plans if I stop paying?",
    a: "They stay yours. You can read, export and share every plan you made; you just cannot generate new ones or re-price until you resubscribe. Nothing is deleted.",
  },
  {
    q: "Where do the prices and resale numbers come from?",
    a: "Live retailer listings and completed sales, searched at the moment you generate. Every single number has a tap-through to the page it came from and the date it was checked. Where the market is thin we say so instead of guessing.",
  },
];

/** The upgrade moments — shown in context, never as a dead end. */
export const UPGRADE_MOMENTS = {
  secondPlan: {
    title: "That's your free plan used",
    body: "Pro unlocks unlimited plans, re-pricing against today's listings, and real-cost tracking that makes every future estimate sharper.",
  },
  reprice: {
    title: "Re-pricing is a Pro feature",
    body: "Pro re-checks every material and comp against today's listings, so a plan you made last month is still a number you can trust.",
  },
  receipts: {
    title: "Cost tracking is a Pro feature",
    body: "Log what you actually paid and Pro shows estimate against reality — and feeds your real receipts back into future estimates for this build type.",
  },
  compare: {
    title: "Compare is a Pro feature",
    body: "Pro ranks two builds by profit per hour, so you build the better idea instead of the first one.",
  },
} as const;
export type UpgradeMoment = keyof typeof UPGRADE_MOMENTS;
