import type { Project } from "./types";

// Demo data used in local mode so the app is immediately explorable.
// Dates are relative to "now" at module load.
const day = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * day).toISOString();

export function seedProjects(): Project[] {
  return [
    {
      id: "proj_goldea",
      name: "GoldEA Basket Trader",
      one_liner: "MT4 expert advisor that manages baskets of XAUUSD trades with visual order intelligence.",
      overview:
        "GoldEA is an MT4 Expert Advisor built around a basket trading engine for gold (XAUUSD). It opens and manages groups of correlated orders, balancing risk across the basket rather than per-trade. Recent work has focused on making the on-chart experience far more legible: orders are spaced out clearly, additional entries are placed as pending orders, and every order is annotated with its lot size and a numbered label so the trader can read the whole basket at a glance.",
      created_at: ago(90),
      updated_at: ago(2),
      features: [
        {
          id: "f_basket",
          project_id: "proj_goldea",
          title: "Basket Trading Engine",
          description: "Opens and manages correlated groups of orders, balancing exposure across the basket instead of per trade.",
          group: "core",
          created_at: ago(90),
        },
        {
          id: "f_risk",
          project_id: "proj_goldea",
          title: "Basket Risk Manager",
          description: "Caps total drawdown and closes the whole basket on target or stop, rather than individual tickets.",
          group: "core",
          created_at: ago(60),
        },
        {
          id: "f_pending",
          project_id: "proj_goldea",
          title: "Pending Order Visualization",
          description: "Additional entries are placed as pending orders and drawn on the chart before they trigger.",
          group: "supporting",
          created_at: ago(2),
        },
        {
          id: "f_labels",
          project_id: "proj_goldea",
          title: "Order Number Labels",
          description: "Each order is tagged with a sequential number so the basket is easy to follow.",
          group: "supporting",
          created_at: ago(2),
        },
        {
          id: "f_lot",
          project_id: "proj_goldea",
          title: "Lot Size Labels",
          description: "Per-order lot size is rendered next to its line for instant sizing context.",
          group: "supporting",
          created_at: ago(2),
        },
        {
          id: "f_spacing",
          project_id: "proj_goldea",
          title: "Enhanced Order Spacing",
          description: "Orders are spread out on the chart so overlapping price levels stay readable.",
          group: "supporting",
          created_at: ago(2),
        },
      ],
      versions: [
        {
          id: "v_goldea_1",
          project_id: "proj_goldea",
          number: "1.0",
          summary: "Initial basket engine: opens correlated gold trades and manages them as a single group.",
          created_at: ago(90),
          files: [
            { id: "file_g1", version_id: "v_goldea_1", name: "GoldEA_v1.mq4", type: "mql", size: 41_000, created_at: ago(90) },
          ],
        },
        {
          id: "v_goldea_2",
          project_id: "proj_goldea",
          number: "2.0",
          summary: "Added basket-level risk manager with global stop and target. Backtested across 3 years.",
          created_at: ago(40),
          files: [
            { id: "file_g2", version_id: "v_goldea_2", name: "GoldEA_v2.mq4", type: "mql", size: 58_200, created_at: ago(40) },
            { id: "file_g2b", version_id: "v_goldea_2", name: "Backtest_2019_2022.pdf", type: "pdf", size: 1_240_000, created_at: ago(40) },
          ],
        },
        {
          id: "v_goldea_3",
          project_id: "proj_goldea",
          number: "3.0",
          summary: "Visual upgrade: pending order lines, numbered labels, lot-size annotations and wider order spacing.",
          created_at: ago(2),
          files: [
            { id: "file_g3", version_id: "v_goldea_3", name: "GoldEA_v3.mq4", type: "mql", size: 72_400, created_at: ago(2) },
            { id: "file_g3b", version_id: "v_goldea_3", name: "GoldEA_v3.ex4", type: "compiled", size: 96_100, created_at: ago(2) },
            { id: "file_g3c", version_id: "v_goldea_3", name: "Backtest.pdf", type: "pdf", size: 980_000, created_at: ago(2) },
          ],
        },
      ],
      knowledge: [
        {
          id: "k_g1",
          project_id: "proj_goldea",
          kind: "brain_dump",
          title: "Chart readability ideas",
          content:
            "Orders should be spread out. Additional orders should be pending orders. Show lot sizes and order labels on chart.",
          created_at: ago(3),
        },
        {
          id: "k_g2",
          project_id: "proj_goldea",
          kind: "bug_report",
          title: "Overlapping lines at same price",
          content:
            "When two orders open at nearly the same price the lines render on top of each other and you can't read the labels. Need spacing.",
          created_at: ago(5),
        },
        {
          id: "k_g3",
          project_id: "proj_goldea",
          kind: "claude_conversation",
          title: "Discussion on basket exit logic",
          content:
            "Talked through closing the basket on a combined profit target rather than per-ticket. Agreed the risk manager should track floating P/L of the whole group and flatten everything at once.",
          created_at: ago(45),
        },
      ],
    },
    {
      id: "proj_assistant",
      name: "Ultimate Assistant OS",
      one_liner: "A modular personal operating system that unifies projects, knowledge and automations.",
      overview:
        "Ultimate Assistant OS is the umbrella product. It is a modular dashboard where each capability — projects, tasks, knowledge, automations — is a self-contained module. Projects Timeline is the first module. The long-term goal is a single workspace that remembers everything and helps refine it over time.",
      created_at: ago(120),
      updated_at: ago(10),
      features: [
        {
          id: "f_modules",
          project_id: "proj_assistant",
          title: "Modular App Shell",
          description: "Pluggable modules share one shell, navigation and auth layer.",
          group: "core",
          created_at: ago(120),
        },
        {
          id: "f_timeline_mod",
          project_id: "proj_assistant",
          title: "Projects Timeline Module",
          description: "First module: project intelligence and version history.",
          group: "core",
          created_at: ago(30),
        },
        {
          id: "f_theme",
          project_id: "proj_assistant",
          title: "Dark Mode Design System",
          description: "Shared rounded-card SaaS design tokens across modules.",
          group: "supporting",
          created_at: ago(20),
        },
      ],
      versions: [
        {
          id: "v_os_1",
          project_id: "proj_assistant",
          number: "0.1",
          summary: "Defined the modular shell concept and picked the first module.",
          created_at: ago(120),
          files: [],
        },
      ],
      knowledge: [
        {
          id: "k_os1",
          project_id: "proj_assistant",
          kind: "idea",
          title: "Each module should be its own source of truth",
          content:
            "Modules should not depend on each other's internals. They share auth and design, but own their data. Projects Timeline owns projects; a future Tasks module owns tasks.",
          created_at: ago(40),
        },
      ],
    },
    {
      id: "proj_portfolio",
      name: "Portfolio Website",
      one_liner: "Personal marketing site showcasing trading systems and software work.",
      overview:
        "A fast, mobile-first marketing site that presents featured projects, case studies and a contact path. Built to load instantly and look sharp on phones.",
      created_at: ago(200),
      updated_at: ago(30),
      features: [
        {
          id: "f_landing",
          project_id: "proj_portfolio",
          title: "Landing & Case Studies",
          description: "Hero, featured work grid and per-project case study pages.",
          group: "core",
          created_at: ago(200),
        },
        {
          id: "f_contact",
          project_id: "proj_portfolio",
          title: "Contact Form",
          description: "Validated contact form wired to email.",
          group: "supporting",
          created_at: ago(150),
        },
      ],
      versions: [
        {
          id: "v_pf_1",
          project_id: "proj_portfolio",
          number: "1.0",
          summary: "Launched with landing page and three case studies.",
          created_at: ago(200),
          files: [
            { id: "file_pf1", version_id: "v_pf_1", name: "hero-mock.png", type: "image", size: 420_000, created_at: ago(200) },
          ],
        },
      ],
      knowledge: [],
    },
  ];
}
