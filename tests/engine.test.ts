import test from "node:test";
import assert from "node:assert/strict";
import {
  approveAll,
  approveAsset,
  approvePoster,
  calculateBudget,
  editAsset,
  fingerprint,
  formatEventDate,
  generatePack,
  isFullyApproved,
  isPackStale,
  moneyToPence,
  sampleBrief,
  validateBrief,
} from "../src/lib/engine.ts";
import type { EventBrief } from "../src/lib/types.ts";

const brief = (changes: Partial<EventBrief> = {}): EventBrief =>
  structuredClone({ ...sampleBrief, ...changes });
const errors = (value: EventBrief) =>
  validateBrief(value).filter((issue) => issue.level === "error");

test("sample is explicit fiction, has no blocking errors and exposes outstanding assignments and costs", () => {
  assert.equal(sampleBrief.sample, true);
  assert.deepEqual(errors(brief()), []);
  const issues = validateBrief(brief());
  assert.ok(issues.some((issue) => issue.id === "fictional-demo"));
  assert.ok(issues.some((issue) => issue.id === "unconfirmed-budget"));
  assert.ok(issues.some((issue) => issue.id === "unassigned-volunteers"));
  assert.equal(formatEventDate(brief()), "Thursday, 29 October 2026");
});

test("generates five distinct channel drafts from source details without changing the brief", () => {
  const source = brief();
  const before = structuredClone(source);
  const pack = generatePack(source);
  assert.deepEqual(source, before);
  assert.deepEqual(
    pack.assets.map((asset) => asset.id),
    ["event-page", "linkedin", "whatsapp", "discord", "newsletter"],
  );
  assert.equal(new Set(pack.assets.map((asset) => asset.body)).size, 5);
  for (const asset of pack.assets) {
    assert.ok(asset.body.startsWith("FICTIONAL DEMO"));
    assert.ok(asset.body.includes(source.name));
    assert.ok(asset.body.includes(source.registrationUrl));
    assert.ok(asset.body.includes(source.accessibility));
    assert.equal(asset.status, "draft");
    assert.equal(asset.approvedAt, null);
    assert.equal(asset.edited, false);
  }
  assert.equal(pack.posterApproved, false);
  assert.ok(Number.isFinite(pack.generationMs) && pack.generationMs >= 0);
  assert.ok(Number.isFinite(Date.parse(pack.generatedAt)));
});

test("custom event source replaces sample details, and organiser notes stay out of public copy", () => {
  const source = brief({
    sample: false,
    community: "River Readers",
    name: "Reading by the river",
    idea: "Bring a book and read quietly together.",
    notes: "Private supplier discussion: keep internal.",
    registrationUrl: "https://events.example.org/river",
  });
  const pack = generatePack(source);
  pack.assets.forEach((asset) => {
    assert.ok(asset.body.includes("River Readers"));
    assert.ok(asset.body.includes(source.idea));
    assert.equal(asset.body.includes("After Hours Club"), false);
    assert.equal(asset.body.includes("Private supplier"), false);
    assert.equal(asset.body.includes("FICTIONAL DEMO"), false);
  });
});

test("empty brief still yields editable placeholder drafts while every approval path is blocked", () => {
  const source = brief({
    community: "",
    name: "",
    idea: "",
    date: "",
    startTime: "",
    endTime: "",
    venue: "",
    registrationUrl: "",
    timezone: "",
  });
  const pack = generatePack(source);
  assert.equal(pack.assets.length, 5);
  assert.ok(pack.assets[0].body.includes("[Add event title]"));
  assert.ok(pack.assets[0].body.includes("[Add HTTPS RSVP link]"));
  assert.ok(errors(source).length >= 9);
  assert.throws(() => approveAll(source, pack), /Resolve the event brief/);
  assert.throws(
    () => approveAsset(source, pack, "linkedin"),
    /Resolve the event brief/,
  );
  assert.throws(() => approvePoster(source, pack), /Resolve the event brief/);
  assert.equal(isFullyApproved(source, pack), false);
});

test("rejects invalid calendar dates and malformed times, including leap-year errors", () => {
  for (const date of [
    "2026-02-29",
    "2026-02-30",
    "2026-13-01",
    "2026-00-01",
    "2026-04-31",
    "29/10/2026",
  ]) {
    assert.ok(
      errors(brief({ date })).some((issue) => issue.id === "invalid-date"),
      date,
    );
  }
  assert.equal(errors(brief({ date: "2028-02-29" })).length, 0);
  for (const startTime of ["24:00", "12:60", "6:30", "hello"]) {
    assert.ok(
      errors(brief({ startTime })).some(
        (issue) => issue.id === "invalid-start",
      ),
      startTime,
    );
  }
  assert.ok(
    errors(brief({ startTime: "21:00", endTime: "18:30" })).some(
      (issue) => issue.id === "end-before-start",
    ),
  );
  assert.ok(
    errors(brief({ startTime: "21:00", endTime: "21:00" })).some(
      (issue) => issue.id === "end-before-start",
    ),
  );
});

test("London spring-forward nonexistent time is blocked and adjacent real times are valid", () => {
  assert.ok(
    errors(
      brief({ date: "2026-03-29", startTime: "01:30", endTime: "03:00" }),
    ).some((issue) => issue.id === "nonexistent-startTime"),
  );
  assert.equal(
    errors(brief({ date: "2026-03-29", startTime: "00:30", endTime: "03:00" }))
      .length,
    0,
  );
});

test("London autumn repeated time is blocked instead of silently choosing an occurrence", () => {
  assert.ok(
    errors(
      brief({ date: "2026-10-25", startTime: "01:30", endTime: "03:00" }),
    ).some((issue) => issue.id === "ambiguous-startTime"),
  );
  assert.equal(
    errors(brief({ date: "2026-10-25", startTime: "02:30", endTime: "03:00" }))
      .length,
    0,
  );
  assert.equal(
    errors(
      brief({
        date: "2026-10-25",
        startTime: "01:30",
        endTime: "03:00",
        timezone: "UTC",
      }),
    ).length,
    0,
  );
  assert.ok(
    errors(brief({ timezone: "London/Nope" })).some(
      (issue) => issue.id === "invalid-timezone",
    ),
  );
});

test("RSVP link must be complete HTTPS and cannot include credentials", () => {
  for (const registrationUrl of [
    "javascript:alert(1)",
    "http://example.com",
    "example.com",
    "https://user:pass@example.com",
    "https://localhost",
  ]) {
    assert.ok(
      errors(brief({ registrationUrl })).some(
        (issue) => issue.id === "invalid-registration-url",
      ),
      registrationUrl,
    );
  }
  assert.equal(
    errors(brief({ registrationUrl: "https://luma.com/example?ref=community" }))
      .length,
    0,
  );
});

test("length, capacity and finite non-negative money constraints block approval", () => {
  assert.ok(
    errors(brief({ name: "x".repeat(181) })).some(
      (issue) => issue.id === "length-name",
    ),
  );
  for (const capacity of [-1, 1.5, NaN, Infinity])
    assert.ok(
      errors(brief({ capacity })).some(
        (issue) => issue.id === "invalid-capacity",
      ),
    );
  assert.equal(errors(brief({ capacity: 0 })).length, 0);
  for (const amount of [-1, NaN, Infinity]) {
    assert.ok(
      errors(brief({ ticketPrice: amount })).some(
        (issue) => issue.id === "invalid-ticket-price",
      ),
    );
    assert.ok(
      errors(
        brief({
          budget: [{ id: "x", label: "Room", amount, confirmed: false }],
        }),
      ).some((issue) => issue.id === "invalid-budget-0"),
    );
  }
  assert.ok(
    errors(brief({ capacity: Number.MAX_SAFE_INTEGER, ticketPrice: 100 })).some(
      (issue) => issue.id === "budget-overflow",
    ),
  );
});

test("budget arithmetic uses pennies and labels full-capacity revenue as potential", () => {
  assert.equal(moneyToPence(10.075), 1008);
  assert.equal(moneyToPence(1.005), 101);
  assert.equal(moneyToPence(1e-7), 0);
  const result = calculateBudget(
    brief({
      capacity: 3,
      ticketPrice: 12.5,
      budget: [
        { id: "a", label: "Item A", amount: 0.1, confirmed: true },
        { id: "b", label: "Item B", amount: 0.2, confirmed: false },
      ],
    }),
  );
  assert.deepEqual(result, {
    costs: 0.3,
    confirmedCosts: 0.1,
    unconfirmedCosts: 0.2,
    potentialRevenue: 37.5,
    projectedBalance: 37.2,
  });
  assert.equal(calculateBudget(brief()).projectedBalance, -175);
  assert.equal(
    calculateBudget(
      brief({
        capacity: 1,
        ticketPrice: 10.075,
        budget: [
          {
            id: "round",
            label: "Rounded amount",
            amount: 1.005,
            confirmed: false,
          },
        ],
      }),
    ).projectedBalance,
    9.07,
  );
});

test("fingerprint is deterministic regardless of object key order and responds to every source field", () => {
  const source = brief();
  const reordered = Object.fromEntries(
    Object.entries(source).reverse(),
  ) as unknown as EventBrief;
  assert.equal(fingerprint(source), fingerprint(reordered));
  assert.equal(fingerprint(source), fingerprint(structuredClone(source)));
  for (const key of Object.keys(source) as (keyof EventBrief)[]) {
    const modified = structuredClone(source);
    if (typeof modified[key] === "string")
      (modified as unknown as Record<string, unknown>)[key] =
        String(modified[key]) + "x";
    else if (typeof modified[key] === "number")
      (modified as unknown as Record<string, unknown>)[key] =
        Number(modified[key]) + 1;
    else if (typeof modified[key] === "boolean")
      (modified as unknown as Record<string, unknown>)[key] = !modified[key];
    else modified.budget[0].amount += 1;
    assert.notEqual(fingerprint(source), fingerprint(modified), key);
  }
});

test("a source edit makes an approved pack stale and blocks all approval paths", () => {
  const source = brief();
  const approved = approveAll(source, generatePack(source));
  assert.equal(isFullyApproved(source, approved), true);
  const changed = { ...source, name: "A changed title" };
  assert.equal(isPackStale(changed, approved), true);
  assert.equal(isFullyApproved(changed, approved), false);
  assert.throws(
    () => approveAsset(changed, approved, "linkedin"),
    /brief has changed/,
  );
  assert.throws(() => approvePoster(changed, approved), /brief has changed/);
  assert.throws(() => approveAll(changed, approved), /brief has changed/);
  const regenerated = generatePack(changed);
  assert.equal(isPackStale(changed, regenerated), false);
  assert.equal(isFullyApproved(changed, regenerated), false);
});

test("editing an approved draft immutably clears that approval and requires review again", () => {
  const source = brief();
  const approved = approveAll(source, generatePack(source));
  const originalBody = approved.assets[1].body;
  const changed = editAsset(
    approved,
    "linkedin",
    `${originalBody}\nAn organiser-reviewed change.`,
  );
  assert.equal(approved.assets[1].body, originalBody);
  assert.equal(approved.assets[1].status, "approved");
  assert.equal(changed.assets[1].status, "draft");
  assert.equal(changed.assets[1].approvedAt, null);
  assert.equal(changed.assets[1].edited, true);
  assert.equal(changed.assets[0].status, "approved");
  assert.equal(isFullyApproved(source, changed), false);
  assert.equal(
    isFullyApproved(source, approveAsset(source, changed, "linkedin")),
    true,
  );
});

test("empty or excessive edited copy cannot be approved individually or in bulk", () => {
  const source = brief();
  for (const body of ["  \n\t", "x".repeat(30_001)]) {
    const pack = editAsset(generatePack(source), "whatsapp", body);
    assert.throws(
      () => approveAsset(source, pack, "whatsapp"),
      /empty|characters/,
    );
    assert.throws(() => approveAll(source, pack), /empty|characters/);
    assert.equal(isFullyApproved(source, pack), false);
  }
});

test("all five unique assets and poster approval are necessary for full approval", () => {
  const source = brief();
  let pack = generatePack(source);
  for (const asset of pack.assets) pack = approveAsset(source, pack, asset.id);
  assert.equal(isFullyApproved(source, pack), false);
  pack = approvePoster(source, pack);
  assert.equal(isFullyApproved(source, pack), true);
  const incomplete = { ...pack, assets: pack.assets.slice(0, 4) };
  assert.equal(isFullyApproved(source, incomplete), false);
  assert.throws(() => approveAll(source, incomplete), /incomplete/);
  const duplicated = {
    ...pack,
    assets: [...pack.assets.slice(0, 4), pack.assets[0]],
  };
  assert.equal(isFullyApproved(source, duplicated), false);
  assert.throws(() => approveAll(source, duplicated), /incomplete/);
});

test("run sheet is explicitly proposed, uses source times and preserves unassigned responsibilities", () => {
  const pack = generatePack(brief());
  assert.ok(pack.runSheet.every((item) => item.title.startsWith("Proposed")));
  assert.equal(pack.runSheet[1].time, "18:30");
  assert.equal(pack.runSheet.at(-1)?.time, "21:00");
  assert.equal(
    pack.rota.find((item) => item.role === "Host")?.person,
    "Demo volunteer A",
  );
  assert.equal(
    pack.rota.find((item) => item.role === "Technical support")?.person,
    "Unassigned",
  );
  assert.equal(
    pack.rota.find((item) => item.role === "Pack-down")?.person,
    "Unassigned",
  );
});

test("names alone do not invent volunteer assignments and explicit unassigned markers remain unassigned", () => {
  const source = brief({
    volunteers:
      "Asha, Ben\nHost: TBC\nWelcome: Unassigned\nPhotography: Morgan",
  });
  const pack = generatePack(source);
  assert.equal(
    pack.rota.find((item) => item.role === "Host")?.person,
    "Unassigned",
  );
  assert.equal(
    pack.rota.find((item) => item.role === "Welcome")?.person,
    "Unassigned",
  );
  assert.equal(
    pack.rota.find((item) => item.role === "Photography")?.person,
    "Morgan",
  );
  assert.ok(
    validateBrief(source).some((issue) => issue.id === "unassigned-volunteers"),
  );
});

test("a run sheet spanning a clock change uses real instants and labels the clock offsets", () => {
  const spring = generatePack(
    brief({ date: "2026-03-29", startTime: "00:30", endTime: "03:00" }),
  );
  assert.equal(spring.runSheet[1].time, "00:30 GMT");
  assert.equal(spring.runSheet.at(-1)?.time, "03:00 BST");
  assert.equal(
    spring.runSheet.some((item) => item.time.startsWith("01:")),
    false,
  );
  const autumn = generatePack(
    brief({ date: "2026-10-25", startTime: "00:30", endTime: "03:00" }),
  );
  assert.equal(autumn.runSheet[1].time, "00:30 BST");
  assert.equal(autumn.runSheet.at(-1)?.time, "03:00 GMT");
});
