import type {
  AssetId,
  ContentAsset,
  EventBrief,
  EventPack,
  Issue,
  RotaItem,
  RunSheetItem,
} from "./types";

const ASSET_IDS: AssetId[] = [
  "event-page",
  "linkedin",
  "whatsapp",
  "discord",
  "newsletter",
];
const MAX_ASSET_LENGTH = 30_000;
const ROLE_DEFINITIONS = [
  {
    role: "Host",
    task: "Confirm the programme, welcome the group and close the event.",
    aliases: ["host", "facilitator", "organiser", "organizer"],
  },
  {
    role: "Welcome",
    task: "Check arrival arrangements and help attendees find the room.",
    aliases: ["welcome", "check-in", "check in", "registration", "checkin"],
  },
  {
    role: "Technical support",
    task: "Confirm any equipment and connectivity needed for the planned activity.",
    aliases: ["technical support", "tech", "technical", "av"],
  },
  {
    role: "Timekeeper",
    task: "Keep the proposed agenda on time and signal the final wrap-up.",
    aliases: ["timekeeper", "timing"],
  },
  {
    role: "Pack-down",
    task: "Confirm the venue handover and leave the space as agreed.",
    aliases: ["pack-down", "packdown", "pack down", "cleanup", "clean-up"],
  },
] as const;

export const sampleBrief: EventBrief = {
  community: "After Hours Club",
  name: "Build something after hours",
  idea: "A friendly evening for London builders to bring one small idea, work alongside other people and share what they tried. First-timers welcome; no polished pitch needed.",
  audience:
    "Curious London makers, designers and developers, including people starting their first side project.",
  tone: "Warm, practical and welcoming. Short sentences, no startup hype.",
  date: "2026-10-29",
  startTime: "18:30",
  endTime: "21:00",
  timezone: "Europe/London",
  venue: "The Workshop Room — fictional demo venue",
  address: "Example venue, London — address to be confirmed",
  registrationUrl: "https://example.com/after-hours-club",
  capacity: 40,
  ticketPrice: 0,
  accessibility:
    "Access arrangements are not confirmed. Contact the organiser before making travel plans.",
  contact: "hello@example.com",
  volunteers:
    "Host: Demo volunteer A\nWelcome: Demo volunteer B\nTimekeeper: Demo volunteer C",
  notes:
    "Fictional London community and event. Venue, contacts, volunteers and budget are illustrative. No booking, registration, payment or publication has taken place.",
  accent: "#c7593c",
  sample: true,
  budget: [
    {
      id: "venue",
      label: "Illustrative room hire",
      amount: 120,
      confirmed: false,
    },
    {
      id: "materials",
      label: "Illustrative materials allowance",
      amount: 30,
      confirmed: false,
    },
    {
      id: "contingency",
      label: "Illustrative contingency",
      amount: 25,
      confirmed: false,
    },
  ],
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  }
  if (typeof value === "number" && !Number.isFinite(value))
    return `"[${String(value)}]"`;
  return JSON.stringify(value) ?? "null";
}

/** A deterministic content identity, not a security signature. Every source edit invalidates approval. */
export function fingerprint(brief: EventBrief): string {
  let hash = 0xcbf29ce484222325n;
  for (const character of canonical(brief)) {
    hash ^= BigInt(character.codePointAt(0)!);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `brief-v1-${hash.toString(16).padStart(16, "0")}`;
}

function parseDate(
  value: string,
): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  if (year < 1000 || year > 9999) return null;
  const checked = new Date(Date.UTC(year, month - 1, day));
  return checked.getUTCFullYear() === year &&
    checked.getUTCMonth() + 1 === month &&
    checked.getUTCDate() === day
    ? { year, month, day }
    : null;
}

function parseTime(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function zoneFormatter(timezone: string): Intl.DateTimeFormat | null {
  if (!timezone.trim()) return null;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    return null;
  }
}

function wallTimeEpoch(
  formatter: Intl.DateTimeFormat,
  instant: number,
): number {
  const parts = Object.fromEntries(
    formatter.formatToParts(instant).map((part) => [part.type, part.value]),
  );
  return Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
}

/** Find every instant for a wall time, including both occurrences during a clock change. */
function possibleInstants(
  date: string,
  time: string,
  formatter: Intl.DateTimeFormat,
): number[] {
  const parts = parseDate(date);
  const minutes = parseTime(time);
  if (!parts || minutes === null) return [];
  const wall = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    Math.floor(minutes / 60),
    minutes % 60,
  );
  const offsets = new Set<number>();
  for (const hours of [-36, -24, -12, 0, 12, 24, 36]) {
    const probe = wall + hours * 3_600_000;
    offsets.add(wallTimeEpoch(formatter, probe) - probe);
  }
  return [...offsets]
    .map((offset) => wall - offset)
    .filter((instant) => wallTimeEpoch(formatter, instant) === wall)
    .sort((a, b) => a - b);
}

function volunteerAssignments(brief: EventBrief): Map<string, string> {
  const assignments = new Map<string, string>();
  for (const entry of brief.volunteers.split(/[\n;]/)) {
    const separator = entry.indexOf(":");
    if (separator < 0) continue;
    const suppliedRole = entry.slice(0, separator).trim();
    const person = entry.slice(separator + 1).trim();
    if (
      !suppliedRole ||
      !person ||
      /^(unassigned|tbc|tbd|to be confirmed)$/i.test(person)
    )
      continue;
    const definition = ROLE_DEFINITIONS.find((item) =>
      (item.aliases as readonly string[]).includes(suppliedRole.toLowerCase()),
    );
    const role = definition?.role ?? suppliedRole;
    assignments.set(
      role,
      [assignments.get(role), person].filter(Boolean).join(", "),
    );
  }
  return assignments;
}

/** Shift the decimal before rounding so amounts such as 10.075 consistently become 1008 pence. */
export function moneyToPence(value: number): number {
  const [coefficient, exponent = "0"] = String(value).split("e");
  return Math.round(Number(`${coefficient}e${Number(exponent) + 2}`));
}

export function calculateBudget(brief: EventBrief): {
  costs: number;
  confirmedCosts: number;
  unconfirmedCosts: number;
  potentialRevenue: number;
  projectedBalance: number;
} {
  // Monetary arithmetic is in pence. Potential revenue assumes every planned place is sold.
  const costsPence = brief.budget.reduce(
    (sum, item) => sum + moneyToPence(item.amount),
    0,
  );
  const confirmedPence = brief.budget
    .filter((item) => item.confirmed)
    .reduce((sum, item) => sum + moneyToPence(item.amount), 0);
  const revenuePence = moneyToPence(brief.ticketPrice) * brief.capacity;
  return {
    costs: costsPence / 100,
    confirmedCosts: confirmedPence / 100,
    unconfirmedCosts: (costsPence - confirmedPence) / 100,
    potentialRevenue: revenuePence / 100,
    projectedBalance: (revenuePence - costsPence) / 100,
  };
}

export function validateBrief(brief: EventBrief): Issue[] {
  const issues: Issue[] = [];
  const add = (
    id: string,
    level: Issue["level"],
    message: string,
    field?: keyof EventBrief,
  ) => issues.push({ id, level, message, field });
  const required: [keyof EventBrief, string][] = [
    ["community", "Community name"],
    ["name", "Event title"],
    ["idea", "Event idea"],
    ["date", "Event date"],
    ["startTime", "Start time"],
    ["endTime", "End time"],
    ["venue", "Venue"],
    ["registrationUrl", "RSVP link"],
    ["timezone", "Time zone"],
  ];
  for (const [field, label] of required) {
    if (!String(brief[field] ?? "").trim())
      add(
        `required-${field}`,
        "error",
        `${label} is required before approval.`,
        field,
      );
  }
  const lengths: Partial<Record<keyof EventBrief, number>> = {
    community: 120,
    name: 180,
    idea: 3000,
    audience: 1000,
    tone: 600,
    venue: 240,
    address: 500,
    registrationUrl: 2048,
    accessibility: 1500,
    contact: 300,
    volunteers: 2000,
    notes: 3000,
    timezone: 100,
  };
  for (const [field, limit] of Object.entries(lengths) as [
    keyof EventBrief,
    number,
  ][]) {
    if (String(brief[field]).length > limit)
      add(
        `length-${field}`,
        "error",
        `${field} must be ${limit} characters or fewer.`,
        field,
      );
  }
  if (brief.date && !parseDate(brief.date))
    add(
      "invalid-date",
      "error",
      "Enter a real calendar date in YYYY-MM-DD format.",
      "date",
    );
  const start = parseTime(brief.startTime);
  const end = parseTime(brief.endTime);
  if (brief.startTime && start === null)
    add(
      "invalid-start",
      "error",
      "Enter a valid start time in 24-hour HH:MM format.",
      "startTime",
    );
  if (brief.endTime && end === null)
    add(
      "invalid-end",
      "error",
      "Enter a valid end time in 24-hour HH:MM format.",
      "endTime",
    );
  if (start !== null && end !== null && end <= start)
    add(
      "end-before-start",
      "error",
      "End time must be after start time on the same date.",
      "endTime",
    );
  if (start !== null && end !== null && end > start && end - start < 15)
    add(
      "short-event",
      "warning",
      "This event is shorter than 15 minutes. Review the proposed run sheet.",
      "endTime",
    );
  const formatter = zoneFormatter(brief.timezone);
  if (brief.timezone && !formatter)
    add(
      "invalid-timezone",
      "error",
      "Enter a recognised time zone, for example Europe/London.",
      "timezone",
    );
  if (parseDate(brief.date) && formatter) {
    for (const [field, value] of [
      ["startTime", brief.startTime],
      ["endTime", brief.endTime],
    ] as const) {
      if (parseTime(value) === null) continue;
      const instants = possibleInstants(brief.date, value, formatter);
      if (instants.length === 0)
        add(
          `nonexistent-${field}`,
          "error",
          `${value} does not occur in ${brief.timezone} on this date because the clocks change. Choose another time.`,
          field,
        );
      if (instants.length > 1)
        add(
          `ambiguous-${field}`,
          "error",
          `${value} occurs twice in ${brief.timezone} on this date because the clocks change. Choose an unambiguous time.`,
          field,
        );
    }
  }
  if (brief.registrationUrl.trim()) {
    try {
      const url = new URL(brief.registrationUrl.trim());
      if (
        url.protocol !== "https:" ||
        !url.hostname.includes(".") ||
        url.username ||
        url.password
      )
        throw new Error("invalid");
    } catch {
      add(
        "invalid-registration-url",
        "error",
        "Use a complete HTTPS RSVP link without embedded login details.",
        "registrationUrl",
      );
    }
  }
  if (!Number.isSafeInteger(brief.capacity) || brief.capacity < 0)
    add(
      "invalid-capacity",
      "error",
      "Capacity must be a non-negative whole number.",
      "capacity",
    );
  if (
    !Number.isFinite(brief.ticketPrice) ||
    brief.ticketPrice < 0 ||
    !Number.isSafeInteger(Math.round(brief.ticketPrice * 100))
  )
    add(
      "invalid-ticket-price",
      "error",
      "Ticket price must be a finite, non-negative amount.",
      "ticketPrice",
    );
  for (const [index, item] of brief.budget.entries()) {
    if (
      !Number.isFinite(item.amount) ||
      item.amount < 0 ||
      !Number.isSafeInteger(Math.round(item.amount * 100))
    )
      add(
        `invalid-budget-${index}`,
        "error",
        `Budget line ${index + 1} needs a finite, non-negative amount.`,
        "budget",
      );
    if (!item.label.trim())
      add(
        `budget-label-${index}`,
        "warning",
        `Add a description for budget line ${index + 1}.`,
        "budget",
      );
    if (item.label.length > 200)
      add(
        `budget-label-length-${index}`,
        "error",
        `Budget line ${index + 1} description must be 200 characters or fewer.`,
        "budget",
      );
  }
  if (
    !issues.some(
      (issue) =>
        issue.id.startsWith("invalid-budget") ||
        issue.id === "invalid-ticket-price" ||
        issue.id === "invalid-capacity",
    )
  ) {
    const totals = calculateBudget(brief);
    if (
      Object.values(totals).some(
        (value) =>
          !Number.isFinite(value) ||
          Math.abs(value) * 100 > Number.MAX_SAFE_INTEGER,
      )
    )
      add(
        "budget-overflow",
        "error",
        "Budget totals are too large to calculate safely. Reduce the amounts or capacity.",
        "budget",
      );
  }
  if (!brief.address.trim())
    add(
      "missing-address",
      "warning",
      "Add the venue address before sharing the pack.",
      "address",
    );
  if (!brief.accessibility.trim())
    add(
      "missing-accessibility",
      "warning",
      "Accessibility arrangements need confirmation. A placeholder will appear in the copy.",
      "accessibility",
    );
  if (!brief.contact.trim())
    add(
      "missing-contact",
      "warning",
      "Add an organiser contact for attendee questions.",
      "contact",
    );
  if (!brief.audience.trim())
    add(
      "missing-audience",
      "warning",
      "Describe who the event is for to make the copy more specific.",
      "audience",
    );
  const assigned = volunteerAssignments(brief);
  const missing = ROLE_DEFINITIONS.filter(
    (item) => !assigned.has(item.role),
  ).map((item) => item.role);
  if (missing.length)
    add(
      "unassigned-volunteers",
      "warning",
      `Roles still unassigned: ${missing.join(", ")}. Use one “Role: Name” entry per line.`,
      "volunteers",
    );
  if (brief.budget.some((item) => !item.confirmed))
    add(
      "unconfirmed-budget",
      "warning",
      "Some budget lines are estimates. Confirm costs before committing funds.",
      "budget",
    );
  if (brief.sample)
    add(
      "fictional-demo",
      "warning",
      "Fictional demo: community, event, contact details, volunteers and budget are illustrative. Nothing has been booked or published.",
    );
  else if (
    /https:\/\/(?:www\.)?example\.(?:com|org|net)(?:\/|$)/i.test(
      brief.registrationUrl,
    )
  )
    add(
      "example-rsvp",
      "warning",
      "The RSVP link uses an example domain. Replace it before publishing.",
      "registrationUrl",
    );
  return issues;
}

export function formatEventDate(brief: EventBrief): string {
  const date = parseDate(brief.date);
  if (!date) return "[Add event date]";
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(date.year, date.month - 1, date.day, 12)));
}

const valueOr = (value: string, placeholder: string) =>
  value.trim() || `[${placeholder}]`;
const money = (value: number) =>
  Number.isFinite(value) && value >= 0
    ? new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency: "GBP",
      }).format(value)
    : "[Confirm amount]";
const clock = (minutes: number) =>
  `${String(Math.floor((((minutes % 1440) + 1440) % 1440) / 60)).padStart(2, "0")}:${String(((minutes % 60) + 60) % 60).padStart(2, "0")}`;

function makeRota(brief: EventBrief): RotaItem[] {
  const assignments = volunteerAssignments(brief);
  const rota: RotaItem[] = ROLE_DEFINITIONS.map(({ role, task }) => ({
    role,
    person: assignments.get(role) ?? "Unassigned",
    task,
  }));
  for (const [role, person] of assignments) {
    if (!rota.some((item) => item.role === role))
      rota.push({
        role,
        person,
        task: "Confirm responsibilities with the organiser.",
      });
  }
  return rota;
}

function makeRunSheet(brief: EventBrief, rota: RotaItem[]): RunSheetItem[] {
  const start = parseTime(brief.startTime);
  const end = parseTime(brief.endTime);
  const valid = start !== null && end !== null && end > start;
  let duration = valid ? end - start : 0;
  const formatter = zoneFormatter(brief.timezone);
  const startInstants = formatter
    ? possibleInstants(brief.date, brief.startTime, formatter)
    : [];
  const endInstants = formatter
    ? possibleInstants(brief.date, brief.endTime, formatter)
    : [];
  const resolved =
    valid && startInstants.length === 1 && endInstants.length === 1;
  const changesClock =
    resolved &&
    formatter &&
    wallTimeEpoch(formatter, startInstants[0]) - startInstants[0] !==
      wallTimeEpoch(formatter, endInstants[0]) - endInstants[0];
  if (resolved) duration = (endInstants[0] - startInstants[0]) / 60_000;
  const timeAt = (offsetMinutes: number) => {
    if (!valid) return "[Confirm time]";
    if (!resolved) return clock(start + offsetMinutes);
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: brief.timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      ...(changesClock ? { timeZoneName: "short" as const } : {}),
    }).format(startInstants[0] + offsetMinutes * 60_000);
  };
  const at = (fraction: number) => timeAt(Math.round(duration * fraction));
  const owner = (role: string) =>
    `${role} · ${rota.find((item) => item.role === role)?.person ?? "Unassigned"}`;
  return [
    {
      id: "setup",
      time: valid
        ? `${timeAt(-30)}${start < 30 ? " (previous day)" : ""}`
        : "[Confirm time]",
      title: "Proposed · team set-up",
      owner: owner("Technical support"),
      detail:
        "Confirm venue access, accessibility information, room layout and any required equipment. Set-up access is not yet agreed.",
    },
    {
      id: "arrival",
      time: at(0),
      title: "Proposed · arrivals",
      owner: owner("Welcome"),
      detail: `Welcome attendees to ${valueOr(brief.venue, "confirm venue")}. Confirm arrival and check-in arrangements.`,
    },
    {
      id: "welcome",
      time: at(0.1),
      title: "Proposed · welcome and orientation",
      owner: owner("Host"),
      detail: `Introduce ${valueOr(brief.community, "community name")}, explain the activity and share the confirmed access and venue information.`,
    },
    {
      id: "activity",
      time: at(0.17),
      title: "Proposed · main activity",
      owner: owner("Host"),
      detail: `Use the organiser’s brief to agree the session format: ${valueOr(brief.idea, "describe the event activity")}`,
    },
    {
      id: "sharing",
      time: at(0.8),
      title: "Proposed · optional group reflection",
      owner: owner("Timekeeper"),
      detail:
        "An optional agenda suggestion: invite attendees to share reflections. Confirm this format with the organiser; no speakers are booked by this plan.",
    },
    {
      id: "wrap",
      time: at(0.92),
      title: "Proposed · wrap-up",
      owner: owner("Host"),
      detail:
        "Thank attendees, collect any agreed feedback and explain only confirmed next steps.",
    },
    {
      id: "close",
      time: at(1),
      title: "Proposed · event close and handover",
      owner: owner("Pack-down"),
      detail:
        "Close at the stated end time. Confirm with the venue when and how pack-down and handover can happen.",
    },
  ];
}

/** Local, source-based templates. This does not call an AI provider or publish anything. */
export function generatePack(brief: EventBrief): EventPack {
  const began = performance.now();
  const title = valueOr(brief.name, "Add event title");
  const community = valueOr(brief.community, "Add community name");
  const idea = valueOr(brief.idea, "Describe what attendees will do");
  const audience = valueOr(brief.audience, "Confirm who this is for");
  const when = `${formatEventDate(brief)} · ${parseTime(brief.startTime) !== null ? brief.startTime : "[Add start time]"}–${parseTime(brief.endTime) !== null ? brief.endTime : "[Add end time]"} (${valueOr(brief.timezone, "Confirm time zone")})`;
  const where = `${valueOr(brief.venue, "Confirm venue")}\n${valueOr(brief.address, "Confirm venue address")}`;
  const rsvp = valueOr(brief.registrationUrl, "Add HTTPS RSVP link");
  const access = valueOr(
    brief.accessibility,
    "Confirm accessibility arrangements with the organiser",
  );
  const contact = valueOr(brief.contact, "Add organiser contact");
  const price = brief.ticketPrice === 0 ? "Free" : money(brief.ticketPrice);
  const capacity =
    Number.isSafeInteger(brief.capacity) && brief.capacity >= 0
      ? String(brief.capacity)
      : "[Confirm capacity]";
  const demo = brief.sample
    ? "FICTIONAL DEMO — illustrative event and details; not a live invitation.\n\n"
    : "";
  const introduction = /warm|friendly|welcoming|casual/i.test(brief.tone)
    ? `Come along to ${title}.`
    : `${community} presents ${title}.`;
  const definitions: {
    id: AssetId;
    title: string;
    channel: string;
    body: string;
  }[] = [
    {
      id: "event-page",
      title: "Event page",
      channel: "Event listing",
      body: `${title}\nHosted by ${community}\n\n${introduction}\n${idea}\n\nWho it is for\n${audience}\n\nWhen\n${when}\n\nWhere\n${where}\n\nTicket price: ${price}\nPlanned capacity: ${capacity}\n\nAccessibility\n${access}\n\nQuestions: ${contact}\nRSVP: ${rsvp}`,
    },
    {
      id: "linkedin",
      title: "LinkedIn post",
      channel: "LinkedIn",
      body: `${title} — with ${community}\n\n${idea}\n\nFor: ${audience}\n\n${when}\n${where}\nTicket price: ${price}\n\nAccessibility: ${access}\nQuestions: ${contact}\n\nFind the event details and RSVP: ${rsvp}`,
    },
    {
      id: "whatsapp",
      title: "WhatsApp message",
      channel: "WhatsApp",
      body: `${community}: ${title}\n\n${introduction}\n${idea}\n\n${when}\n${where}\n${price} · planned capacity ${capacity}\n\nAccess: ${access}\nQuestions: ${contact}\nRSVP: ${rsvp}`,
    },
    {
      id: "discord",
      title: "Discord announcement",
      channel: "Discord",
      body: `**${title}**\n${community}\n\n${idea}\n\n**Who:** ${audience}\n**When:** ${when}\n**Where:** ${where}\n**Ticket price:** ${price}\n\n**Accessibility:** ${access}\n**Questions:** ${contact}\n**RSVP:** ${rsvp}`,
    },
    {
      id: "newsletter",
      title: "Newsletter",
      channel: "Email draft",
      body: `Subject: ${title} | ${community}\nPreview: ${formatEventDate(brief)} · ${valueOr(brief.venue, "Venue to be confirmed")}\n\n${introduction}\n\n${idea}\n\nThis event is for ${audience}\n\nThe details\n${when}\n${where}\nTicket price: ${price}\nPlanned capacity: ${capacity}\n\nAccessibility: ${access}\nQuestions: ${contact}\n\nRead the details and RSVP: ${rsvp}\n\n${community}`,
    },
  ];
  const assets: ContentAsset[] = definitions.map((asset) => ({
    ...asset,
    body: demo + asset.body,
    status: "draft",
    approvedAt: null,
    edited: false,
  }));
  const rota = makeRota(brief);
  const runSheet = makeRunSheet(brief, rota);
  return {
    sourceFingerprint: fingerprint(brief),
    generatedAt: new Date().toISOString(),
    generationMs: Math.max(0, performance.now() - began),
    assets,
    runSheet,
    rota,
    posterApproved: false,
    posterApprovedAt: null,
  };
}

export function isPackStale(brief: EventBrief, pack: EventPack): boolean {
  return pack.sourceFingerprint !== fingerprint(brief);
}

function assertCurrent(brief: EventBrief, pack: EventPack): void {
  if (isPackStale(brief, pack))
    throw new Error(
      "The brief has changed. Regenerate the pack before approving it.",
    );
  const errors = validateBrief(brief).filter(
    (issue) => issue.level === "error",
  );
  if (errors.length)
    throw new Error(
      `Resolve the event brief before approval: ${errors.map((issue) => issue.message).join(" ")}`,
    );
}

function assertAssetContent(asset: ContentAsset): void {
  if (!asset.body.trim())
    throw new Error(`${asset.title} is empty. Add content before approval.`);
  if (asset.body.length > MAX_ASSET_LENGTH)
    throw new Error(
      `${asset.title} must be ${MAX_ASSET_LENGTH} characters or fewer before approval.`,
    );
}

function assertCompleteAssets(pack: EventPack): void {
  if (
    pack.assets.length !== ASSET_IDS.length ||
    ASSET_IDS.some(
      (id) => pack.assets.filter((asset) => asset.id === id).length !== 1,
    )
  ) {
    throw new Error(
      "The pack is incomplete. Regenerate all five channel drafts before approval.",
    );
  }
}

export function editAsset(
  pack: EventPack,
  id: AssetId,
  body: string,
): EventPack {
  if (!pack.assets.some((asset) => asset.id === id))
    throw new Error("That content asset was not found.");
  return {
    ...pack,
    assets: pack.assets.map((asset) =>
      asset.id === id
        ? { ...asset, body, edited: true, status: "draft", approvedAt: null }
        : asset,
    ),
  };
}

export function approveAsset(
  brief: EventBrief,
  pack: EventPack,
  id: AssetId,
): EventPack {
  assertCurrent(brief, pack);
  assertCompleteAssets(pack);
  const asset = pack.assets.find((item) => item.id === id);
  if (!asset) throw new Error("That content asset was not found.");
  assertAssetContent(asset);
  return {
    ...pack,
    assets: pack.assets.map((item) =>
      item.id === id
        ? { ...item, status: "approved", approvedAt: new Date().toISOString() }
        : item,
    ),
  };
}

export function approvePoster(brief: EventBrief, pack: EventPack): EventPack {
  assertCurrent(brief, pack);
  return {
    ...pack,
    posterApproved: true,
    posterApprovedAt: new Date().toISOString(),
  };
}

export function approveAll(brief: EventBrief, pack: EventPack): EventPack {
  assertCurrent(brief, pack);
  assertCompleteAssets(pack);
  pack.assets.forEach(assertAssetContent);
  const approvedAt = new Date().toISOString();
  return {
    ...pack,
    assets: pack.assets.map((asset) => ({
      ...asset,
      status: "approved",
      approvedAt,
    })),
    posterApproved: true,
    posterApprovedAt: approvedAt,
  };
}

export function isFullyApproved(brief: EventBrief, pack: EventPack): boolean {
  try {
    assertCurrent(brief, pack);
    assertCompleteAssets(pack);
    pack.assets.forEach(assertAssetContent);
    return (
      pack.posterApproved &&
      Boolean(
        pack.posterApprovedAt &&
        Number.isFinite(Date.parse(pack.posterApprovedAt)),
      ) &&
      pack.assets.every(
        (asset) =>
          asset.status === "approved" &&
          Boolean(
            asset.approvedAt && Number.isFinite(Date.parse(asset.approvedAt)),
          ),
      )
    );
  } catch {
    return false;
  }
}
