// ---------------------------------------------------------------------------
// One worked plan, shipped in the code.
//
// It is the empty state — a vault with nothing in it teaches nothing — and it
// is the bar the generator is being held to: every field the sheet can draw is
// filled in here, including the two that are easy to skip and most of the value,
// `check` (how you know the step came out right) and `legal` (a question with
// somebody to ask, never an answer).
//
// The owner's own example, picture frames, deliberately. Costs are ESTIMATE,
// because nothing in a seed has been verified against anything.
// ---------------------------------------------------------------------------

import type { Idea, Plan } from "./types";

const USD = (low: number, high: number) => ({ low, high, currency: "USD" });

const PICTURE_FRAMES: Plan = {
  version: 1,
  createdAt: "2026-10-02T00:00:00.000Z",
  model: "seed",
  summary:
    "Make ten 8x10 and 11x14 picture frames from primed pine moulding and sell the first batch at a "
    + "local market, to find out whether the price people pay is worth the hour each frame takes.",
  assumptions: [
    "A garage or a shed, mains power, and somewhere the dust does not matter.",
    "No van: everything either fits in a car or gets delivered.",
    "Selling locally for cash first, so no shipping and no platform fees yet.",
  ],
  openQuestions: [
    "Do you want glass, or acrylic? Acrylic costs more per sheet but nothing breaks on the drive.",
    "Standard sizes only, or custom to order? Custom doubles the time per frame.",
  ],
  unit: {
    cost: USD(11, 17),
    sellsFor: USD(35, 55),
    note: "Materials only. At an hour a frame, that is the whole question: is that hour worth $25?",
  },
  phases: [
    {
      id: "seed-p1",
      title: "Decide what you are making",
      goal: "Two sizes chosen, and one frame drawn full size on paper.",
      days: 1,
      steps: [
        {
          id: "seed-s1",
          title: "Pick two frame sizes and one moulding profile",
          detail:
            "8x10 and 11x14 are the sizes people own prints in, so they sell without a conversation. "
            + "One profile across both sizes means one set of saw settings and one stock order.",
          hours: 1,
          provenance: "estimate",
          materials: [],
          suppliers: [],
          check: "You can say what you are building in one sentence without using the word 'various'.",
          done: false,
          skipped: false,
        },
        {
          id: "seed-s2",
          title: "Draw one frame full size and work out the cut list",
          detail:
            "Outside length per side is the glass dimension plus twice the rabbet depth. Getting this "
            + "wrong on paper costs a sheet of paper; getting it wrong on the saw costs the moulding.",
          hours: 1,
          provenance: "estimate",
          materials: [],
          suppliers: [],
          check: "Your four pieces, laid out, come to the glass size plus the rabbet on both sides.",
          done: false,
          skipped: false,
        },
      ],
    },
    {
      id: "seed-p2",
      title: "Buy the stock",
      goal: "Enough material on hand for ten frames, with a little to waste.",
      days: 3,
      steps: [
        {
          id: "seed-s3",
          title: "Buy primed pine moulding",
          detail:
            "Ten frames in those two sizes is about 50 linear feet of finished length. Buy 65 to "
            + "cover mitre waste and the two lengths that turn out to be bowed.",
          cost: USD(70, 110),
          costNote: "65 linear feet, 8ft lengths",
          provenance: "estimate",
          hours: 1,
          materials: [
            {
              id: "seed-m1",
              name: "primed pine moulding, 1.5in face",
              qty: 65,
              unit: "ft",
              unitCost: USD(1.1, 1.7),
              provenance: "estimate",
              supplierIds: ["seed-sup1"],
            },
          ],
          suppliers: [
            {
              id: "seed-sup1",
              name: "A local lumber yard, not a big-box store",
              what: "moulding by the foot, straighter stock, cut to length if you ask",
            },
          ],
          check: "Sight down each length before it goes in the car. A bowed piece never comes good.",
          done: false,
          skipped: false,
        },
        {
          id: "seed-s4",
          title: "Buy glazing, backing and hardware",
          detail:
            "Acrylic sheet cut to size, 3mm MDF or foam board for backing, plus points, bumpers and "
            + "hanging hardware. Order glazing cut to size: the offcut waste on a full sheet is worse "
            + "than the cutting fee.",
          cost: USD(55, 95),
          provenance: "estimate",
          hours: 1,
          materials: [
            {
              id: "seed-m2",
              name: "acrylic glazing, cut to size",
              qty: 10,
              unit: "each",
              unitCost: USD(3.5, 6),
              provenance: "estimate",
              supplierIds: [],
            },
            {
              id: "seed-m3",
              name: "backing board, 3mm",
              qty: 10,
              unit: "each",
              unitCost: USD(1, 2),
              provenance: "estimate",
              supplierIds: [],
            },
          ],
          suppliers: [],
          check: "Every piece of glazing drops into the rabbet without being forced.",
          done: false,
          skipped: false,
        },
        {
          id: "seed-s5",
          title: "Settle the mitre saw question: rent, borrow or buy",
          detail:
            "A mitre saw with a sharp fine-tooth blade is the one tool that decides whether the "
            + "corners close. Renting for a weekend costs a fraction of buying, and ten frames is a "
            + "weekend — buy one when a second batch exists, not before.",
          cost: USD(45, 220),
          costNote: "weekend rental at the low end, a basic saw at the high end",
          provenance: "estimate",
          hours: 1,
          materials: [],
          suppliers: [],
          check: "A test mitre in scrap closes with no light showing at the join.",
          done: false,
          skipped: false,
        },
      ],
    },
    {
      id: "seed-p3",
      title: "Make the first frame, then nine more",
      goal: "One frame you would pay for, then a batch made the same way.",
      days: 3,
      steps: [
        {
          id: "seed-s6",
          title: "Cut and assemble ONE frame before cutting anything else",
          detail:
            "Cut four mitres, glue and clamp, let it set, then fit glazing and backing. The first "
            + "frame is where you find out the rabbet is shallower than you measured.",
          provenance: "estimate",
          hours: 2,
          materials: [],
          suppliers: [],
          check: "All four corners closed, the frame sits flat on a table, the glazing does not rattle.",
          done: false,
          skipped: false,
        },
        {
          id: "seed-s7",
          title: "Batch the rest: all cuts, then all glue-ups, then all fitting",
          detail:
            "Doing one operation across ten frames is most of the hour-per-frame saving, because the "
            + "saw gets set once and your hands stop relearning the motion.",
          provenance: "estimate",
          hours: 8,
          materials: [],
          suppliers: [],
          check: "Ten frames, and the tenth is as square as the first.",
          done: false,
          skipped: false,
        },
        {
          id: "seed-s8",
          title: "Finish them, and photograph them in daylight",
          detail:
            "Fill the corner pins, sand the face, two thin coats. Then photograph each one against a "
            + "plain wall in daylight — a bad photo is what stops a good frame selling.",
          cost: USD(20, 35),
          provenance: "estimate",
          hours: 4,
          materials: [],
          suppliers: [],
          check: "The corner joint is invisible at arm's length.",
          done: false,
          skipped: false,
        },
      ],
    },
    {
      id: "seed-p4",
      title: "Sell the first batch",
      goal: "Money taken, and a real price you know people will pay.",
      days: 14,
      steps: [
        {
          id: "seed-s9",
          title: "Price them against what is actually on sale locally",
          detail:
            "Look at what a comparable handmade frame sells for near you, not at what a factory frame "
            + "costs. Your floor is materials plus something for the hour; the market decides the rest.",
          provenance: "estimate",
          hours: 2,
          materials: [],
          suppliers: [],
          check: "You can name the price and the three frames you compared it to.",
          done: false,
          skipped: false,
        },
        {
          id: "seed-s10",
          title: "Book a market stall or a craft fair table",
          detail:
            "A table for a day costs less than a month of ads and tells you more. Take all ten, take "
            + "cash and a card reader, and write down every question people ask.",
          cost: USD(25, 80),
          costNote: "one day's table",
          provenance: "estimate",
          hours: 8,
          materials: [],
          suppliers: [],
          check: "You sold at least one at the price you set, without being talked down.",
          legal: {
            question:
              "Does selling here need a temporary vendor permit or a sales-tax number, and does the "
              + "market require either before they will take a booking?",
            whoToAsk: "the market organiser first, then your state or local revenue office",
          },
          done: false,
          skipped: false,
        },
      ],
    },
  ],
  extras: [],
};

export const SEED_IDEAS: Idea[] = [
  {
    id: "seed-picture-frames",
    title: "Picture frames",
    oneLiner: "Ten frames from pine moulding, sold at a local market to find the real price.",
    brief: {
      what: "Handmade wooden picture frames in two standard sizes, sold locally.",
      scale: "a-few",
      skill: "handy",
      toolsOwned: "drill, clamps, a garage — no mitre saw yet",
    },
    status: "idea",
    tags: ["woodwork", "weekend"],
    pinned: false,
    plans: [PICTURE_FRAMES],
    chat: [],
    createdAt: "2026-10-02T00:00:00.000Z",
    updatedAt: "2026-10-02T00:00:00.000Z",
  },
];
