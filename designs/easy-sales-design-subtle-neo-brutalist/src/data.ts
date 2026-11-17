// Sample data. An element whose `data.dataset` names one of the brief's
// datasets takes its values from there; an element with `data.samples`
// carries its own. The values below are the wireframe's; only what it leaves
// open (the other columns of a row) is filled in, and all of it is fictional.

/* ------------------------------------------------------------ datasets */

export const RECORD_STATUS = ["Active", "Archived", "All"];
export const COMPANY_NAMES = [
  "Synthesia",
  "Wayve",
  "Graphcore",
  "Quantexa",
  "Darktrace",
  "Google DeepMind",
  "Faculty",
  "Stability AI",
  "PolyAI",
  "Luminance",
  "Tractable",
  "Oxa",
  "Cleo",
  "Isomorphic Labs",
  "Causaly",
  "LabGenius",
  "Holistic AI",
];
export const FULL_NAMES = [
  "Ada Lovelace",
  "Alan Turing",
  "Grace Hopper",
  "Katherine Johnson",
  "Tim Berners-Lee",
  "Margaret Hamilton",
];
export const EMAILS = ["ada@acme.io", "alan@acme.io", "grace@acme.io", "katherine@acme.io", "tim@acme.io"];
export const DATES =
  "16/10/2026, 18/10/2026, 25/10/2026, 12/11/2026, 15/11/2026, 29/11/2026, 30/11/2026, 21/12/2026, 26/12/2026, 06/01/2027, 08/01/2027, 25/01/2027, 02/02/2027, 05/02/2027, 25/02/2027".split(
    ", ",
  );
export const DATE_TIMES =
  "16/10/2026 09:30, 18/10/2026 14:15, 25/10/2026 11:45, 12/11/2026 16:00, 15/11/2026 08:20, 29/11/2026 13:50, 30/11/2026 17:10, 21/12/2026 10:05, 26/12/2026 15:35, 06/01/2027 09:00, 08/01/2027 12:25, 25/01/2027 18:40, 02/02/2027 07:55, 05/02/2027 14:30, 25/02/2027 11:15".split(
    ", ",
  );
export const PERCENTAGES = [
  "17%",
  "83%",
  "42%",
  "6%",
  "95%",
  "31%",
  "68%",
  "24%",
  "57%",
  "90%",
  "12%",
  "76%",
  "39%",
  "54%",
  "8%",
  "63%",
  "45%",
  "99%",
  "21%",
  "72%",
];
export const YES_NO = ["Yes", "No"];
export const EASY_SCORES = [
  "85%",
  "80%",
  "75%",
  "70%",
  "65%",
  "60%",
  "55%",
  "50%",
  "45%",
  "40%",
  "35%",
  "30%",
  "25%",
  "20%",
  "15%",
  "10%",
  "5%",
  "0%",
];
export const ROLES = ["Sales Manager", "Sales Rep"];
export const WEIGHTS = ["Standard", "Important", "Very Important"];
export const TEAMS = ["Team 1", "Team 2", "Team 3"];
export const ACTIVE_INACTIVE = ["Active", "Inactive"];

const cycle = <T>(list: T[], i: number) => list[i % list.length]!;

/* ------------------------------------------------------------ the organisation on show */

// The organisation list's Name column opens one organisation's page; this
// remembers which, so that page's heading names it. In memory only.
let currentOrganisation = COMPANY_NAMES[0]!;
export const organisation = {
  get: () => currentOrganisation,
  set: (name: string) => {
    currentOrganisation = name;
  },
};

/* ------------------------------------------------------------ platform admin */

export const ORGANISATIONS = COMPANY_NAMES.slice(0, 8).map((name, i) => ({
  id: `org-${i}`,
  name,
  joined: cycle(DATES, i * 2),
  status: i === 5 ? "Inactive" : "Active",
}));

const PACKAGE_MINUTES = ["6,000 minutes", "3,000 minutes"];
export const INVOICES = COMPANY_NAMES.slice(0, 6).map((organisation, i) => {
  const big = i % 2 === 0;
  return {
    id: `inv-${i}`,
    organisation,
    package: cycle(PACKAGE_MINUTES, i),
    overage: big ? "10 mins" : "10,000 mins",
    packageTotal: big ? "£3,000" : "£6,000",
    month: i < 4 ? "Jan" : "Feb",
    year: "2027",
    additional: i % 3 === 2 ? "None" : "Maintenance: £500",
    invoiceTotal: i % 3 === 2 ? (big ? "£3,000" : "£6,000") : big ? "£3,500" : "£6,500",
    status: cycle(["New", "Invoiced", "Paid"], i),
  };
});
export const INVOICE_STATUSES = ["New", "Invoiced", "Paid"];

export const PACKAGES = ["Essentials", "Professionals", "Enterprise"].map((name, i) => ({ id: `pkg-${i}`, name }));

export const PACKAGE_TIERS = [
  { id: "tier-0", from: DATES[0]!, to: DATES[4]!, minimum: "2,000", perMinute: "£13.333", status: "Active" },
  { id: "tier-1", from: DATES[5]!, to: DATES[9]!, minimum: "2,000", perMinute: "£13.333", status: "Active" },
  { id: "tier-2", from: DATES[10]!, to: DATES[14]!, minimum: "2,000", perMinute: "£13.333", status: "Inactive" },
];

export const TEAM_ROWS = TEAMS.map((name, i) => ({ id: `team-${i}`, name, status: i === 2 ? "Inactive" : "Active" }));

const PEOPLE = ["Ada Lovelace", "Linus Torvalds", "Grace Hopper"];
export const USER_ROWS = PEOPLE.map((name, i) => ({
  id: `user-${i}`,
  name,
  email: cycle(EMAILS, i === 1 ? 1 : i),
  team: TEAMS[i]!,
  role: i === 0 ? ROLES[0]! : ROLES[1]!,
  status: i === 2 ? "Inactive" : "Active",
  joined: cycle(DATES, i * 3 + 1),
}));
// The wireframe pairs "Linus Torvalds" with no email; acme.io keeps it fictional.
USER_ROWS[1]!.email = "linus@acme.io";

export const ADMIN_ROWS = PEOPLE.map((name, i) => ({
  id: `admin-${i}`,
  name,
  email: USER_ROWS[i]!.email,
  status: i === 2 ? "Inactive" : "Active",
  joined: cycle(DATES, i * 4),
}));

export const ORG_PACKAGES = [
  { id: "op-0", minimum: "3,000", perMinute: "£0.40", start: DATES[9]!, end: DATES[14]!, status: "Active" },
  { id: "op-1", minimum: "2,000", perMinute: "£0.25", start: DATES[3]!, end: DATES[8]!, status: "Inactive" },
  { id: "op-2", minimum: "1,000", perMinute: "£0.10", start: DATES[0]!, end: DATES[2]!, status: "Inactive" },
];

export const CHARGES = [
  { id: "ch-0", name: "Integration setup", amount: "£300", type: "One off", start: "n/a", end: "n/a" },
  {
    id: "ch-1",
    name: "Integration maintenance",
    amount: "£300",
    type: "Recurring",
    start: "12/08/2027",
    end: "12/08/2028",
  },
  { id: "ch-2", name: "Integration setup", amount: "£300", type: "One off", start: "n/a", end: "n/a" },
];
export const CHARGE_TYPES = ["One off", "Recurring"];

export const STRUCTURES = ["Residential", "Commercial", "Government"].map((serviceLine, i) => ({
  id: `st-${i}`,
  serviceLine,
  earn: "Edit",
  ask: "Edit",
  sell: "Edit",
  yesNo: "Edit",
  added: cycle(DATES, i * 2 + 3),
  status: i === 2 ? "Inactive" : "Active",
}));

/** The data points configured under each step in Easy Structure. */
export const EASY_DATA_POINTS = {
  earn: ["Intro", "Reason", "Question", "Tone / authority"],
  ask: ["Need", "Need probe", "Context", "Context probe", "Business", "Business probe", "Link"],
  sell: ["Company", "Feedback", "Story", "Services"],
  yesNo: ["Recommend", "Benefits", "Question", "Commitment"],
} as const;

export const EASY_DATA_POINT_ROWS = [
  ...EASY_DATA_POINTS.earn.map((label) => ({ step: "Earn", label })),
  ...EASY_DATA_POINTS.ask.map((label) => ({ step: "Ask", label })),
  ...EASY_DATA_POINTS.sell.map((label) => ({ step: "Sell", label })),
  ...EASY_DATA_POINTS.yesNo.map((label) => ({ step: "Yes/No", label })),
];

/* ------------------------------------------------------------ sales reps and managers */

export const PERFORMANCE = {
  easyScore: 75,
  callsAnalysed: 24,
  change: "+13%",
  steps: [
    { step: "Earn", score: 70 },
    { step: "Ask", score: 60 },
    { step: "Sell", score: 60 },
    { step: "Yes/No", score: 60 },
  ],
  topCalls: [
    { time: "11:33", score: "72%" },
    { time: "10:33", score: "72%" },
    { time: "12:00", score: "65%" },
  ],
  rank: "1st of 3",
  dataPoints: EASY_DATA_POINT_ROWS.map((dataPoint, i) => ({
    ...dataPoint,
    score: cycle([75, 70, 65, 60, 80, 72, 68, 62], i),
  })),
};

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
// The wireframe gives four values for five days; Friday's is filled in.
export const LAST_WEEK = [42, 58, 35, 71, 64];
export const RANGES = ["Last 7 days", "Last 30 days", "Last quarter"];

export const RECORDINGS = Array.from({ length: 14 }, (_, i) => ({
  id: `rec-${i}`,
  fileName: `${["adag", "regwgwg", "call-north", "renewal-chat", "discovery", "follow-up", "pricing-review"][i % 7]}${i > 6 ? `-${i}` : ""}.mp4`,
  callDate: cycle(DATE_TIMES, 14 - i),
  uploaded: cycle(DATES, 14 - i),
}));

export const LEADERBOARD = [
  {
    id: "lb-0",
    name: "Ada Lovelace",
    score: EASY_SCORES[0]!,
    image:
      "https://images.unsplash.com/photo-1758600587839-56ba05596c69?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxwcm9mZXNzaW9uYWwlMjBkaXZlcnNlJTIwYnVzaW5lc3MlMjBoZWFkc2hvdCUyMHBvcnRyYWl0JTIwbmV1dHJhbCUyMGJhY2tncm91bmR8ZW58MXx8fHwxNzk0ODQ2NjIzfDA&ixlib=rb-4.1.0&q=80&w=400",
  },
  {
    id: "lb-1",
    name: "Linus Torvalds",
    score: EASY_SCORES[1]!,
    image:
      "https://images.unsplash.com/photo-1767175620484-1ed37931a0d1?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwzfHxwcm9mZXNzaW9uYWwlMjBkaXZlcnNlJTIwYnVzaW5lc3MlMjBoZWFkc2hvdCUyMHBvcnRyYWl0JTIwbmV1dHJhbCUyMGJhY2tncm91bmR8ZW58MXx8fHwxNzk0ODQ2NjIzfDA&ixlib=rb-4.1.0&q=80&w=400",
  },
  {
    id: "lb-2",
    name: "Danny Care",
    score: EASY_SCORES[2]!,
    image:
      "https://images.unsplash.com/photo-1790575547092-72c0416fdfc7?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHw0fHxwcm9mZXNzaW9uYWwlMjBkaXZlcnNlJTIwYnVzaW5lc3MlMjBoZWFkc2hvdCUyMHBvcnRyYWl0JTIwbmV1dHJhbCUyMGJhY2tncm91bmR8ZW58MXx8fHwxNzk0ODQ2NjIzfDA&ixlib=rb-4.1.0&q=80&w=400",
  },
];
export const PERIODS = ["Today", "Last Week", "Last Qtr"];

export const PRIORITIES = [
  {
    id: "pr-0",
    focus: "Step: Earn",
    message: "You weren't got a this last quarter so I'm asking you to look at this",
    start: "01/01/2025",
    end: "11 Feb 2025",
    team: "All",
  },
  {
    id: "pr-1",
    focus: "Step: Ask - DP: 3",
    message: "You weren't got a this last quarter so I'm asking you to look at this",
    start: "01/02/2026",
    end: "16 Mar 2026",
    team: "Team 1",
  },
  {
    id: "pr-2",
    focus: "Step: Earn",
    message: "You weren't got a this last quarter so I'm asking you to look at this",
    start: "01/01/2026",
    end: "31 Jan 2026",
    team: "All",
  },
];

export const RAW_DATA = Array.from({ length: 7 }, (_, i) => {
  const row: Record<string, string> = {
    id: `raw-${i}`,
    name: cycle(FULL_NAMES, i),
    callDate: cycle(DATES, i + 4),
    easy: cycle(PERCENTAGES, i * 3),
    earn: cycle(PERCENTAGES, i * 3 + 1),
    ask: cycle(EASY_SCORES, i * 2 + 1),
    sell: cycle(PERCENTAGES, i * 3 + 2),
    yesNo: cycle(EASY_SCORES, i * 2 + 4),
  };
  EASY_DATA_POINT_ROWS.forEach((_, dp) => {
    row[`dp${dp + 1}`] = (i * 7 + (dp + 1) * 3) % 5 < 3 ? "Yes" : "No";
  });
  return row;
});
