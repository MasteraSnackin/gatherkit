import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCalendar,
  buildHtml,
  buildMarkdown,
  buildPosterSvg,
} from "../src/lib/export.ts";
import type { EventBrief, EventPack } from "../src/lib/types.ts";
import {
  approveAll,
  calculateBudget,
  fingerprint,
  generatePack,
} from "../src/lib/engine.ts";

function brief(overrides: Partial<EventBrief> = {}): EventBrief {
  return {
    community: "Neighbourhood Makers",
    name: "Make an evening of it",
    idea: "A practical gathering to swap useful ideas.",
    audience: "Local makers",
    tone: "Warm and direct",
    date: "2026-10-22",
    startTime: "18:00",
    endTime: "21:00",
    timezone: "Europe/London",
    venue: "The fictional workshop",
    address: "1 Example Square, London",
    registrationUrl: "https://example.com/rsvp",
    capacity: 20,
    ticketPrice: 5,
    accessibility: "Step-free access is unconfirmed",
    contact: "organiser@example.com",
    volunteers: "Alex, Sam",
    notes: "Check the doors.",
    accent: "#ed793e",
    sample: true,
    budget: [
      { id: "food", label: "Food", amount: 35, confirmed: true },
      { id: "materials", label: "Materials", amount: 15, confirmed: false },
    ],
    ...overrides,
  };
}

function pack(source: EventBrief = brief()): EventPack {
  return {
    sourceFingerprint: fingerprint(source),
    generatedAt: "2026-10-22T16:00:00.000Z",
    generationMs: 2,
    assets: [
      {
        id: "event-page",
        title: "Event page",
        channel: "Website",
        body: "Come along to make something useful.",
        status: "approved",
        approvedAt: "2026-10-22T16:05:00.000Z",
        edited: true,
      },
      {
        id: "linkedin",
        title: "LinkedIn post",
        channel: "LinkedIn",
        body: "An invitation for your community.",
        status: "draft",
        approvedAt: null,
        edited: false,
      },
    ],
    runSheet: [
      {
        id: "doors",
        time: "18:00",
        title: "Doors open",
        owner: "Alex",
        detail: "Welcome guests.",
      },
    ],
    rota: [{ role: "Welcome", person: "Alex", task: "Help guests arrive." }],
    posterApproved: false,
    posterApprovedAt: null,
  };
}

test("organiser exports preserve mixed review states, provenance and budget arithmetic", () => {
  for (const output of [
    buildMarkdown(brief(), pack()),
    buildHtml(brief(), pack()),
  ]) {
    assert.match(output, /Fictional sample/);
    assert.match(output, /1\/2 copy assets approved; poster draft/);
    assert.match(output, /approved/i);
    assert.match(output, /draft/i);
    assert.match(output, /£50\.00/);
    assert.match(output, /20 × £5\.00 =/);
    assert.match(output, /£100\.00/);
    assert.match(output, /10 paid tickets before fees/);
    assert.match(output, /Estimate — unconfirmed/);
    assert.match(output, /Welcome guests/);
    assert.match(output, /Help guests arrive/);
    assert.match(output, /Nothing has been posted/);
  }
});

test("budget exports round individual costs to pence and do not imply free tickets recover costs", () => {
  const source = brief({
    ticketPrice: 0,
    budget: [
      { id: "a", label: "A", amount: 0.1, confirmed: false },
      { id: "b", label: "B", amount: 0.2, confirmed: false },
    ],
  });
  const output = buildMarkdown(source, pack(source));
  assert.match(output, /£0\.30/);
  assert.match(output, /Free tickets cannot recover these costs/);
  const small = brief({ capacity: 1 });
  assert.match(buildHtml(small, pack(small)), /exceeds capacity/);
  const invalidPrice = brief({ ticketPrice: NaN });
  assert.throws(
    () => buildMarkdown(invalidPrice, pack(invalidPrice)),
    /valid, non-negative/,
  );
  const invalidCapacity = brief({ capacity: 2.5 });
  assert.throws(
    () => buildHtml(invalidCapacity, pack(invalidCapacity)),
    /whole number/,
  );
});

test("HTML and SVG exports encode hostile text and have no remote assets or runnable user markup", () => {
  const hostile =
    '</title><script>alert("x")</script><img src="https://evil.test" onerror="alert(1)">&';
  const source = brief({
    name: hostile,
    community: hostile,
    venue: hostile,
    address: hostile,
    registrationUrl: "javascript:alert(1)",
    notes: hostile,
  });
  const content = pack(source);
  content.assets[0].body = hostile;
  for (const output of [buildHtml(source, content), buildPosterSvg(source)]) {
    assert.doesNotMatch(output, /<script|<img|onerror="|href="javascript:/);
    assert.match(output, /&lt;script&gt;/);
    assert.match(output, /&amp;/);
  }
  assert.match(buildHtml(source, content), /default-src 'none'/);
  assert.doesNotMatch(buildPosterSvg(source), /<image|<foreignObject/);
  const markdown = buildMarkdown(source, content);
  assert.doesNotMatch(markdown, /<script|<img/);
  assert.match(markdown, /&lt;script&gt;/);
});

test("user-provided provenance and approval timestamps are reported without claiming verification", () => {
  const source = brief({ sample: false });
  const content = pack(source);
  content.posterApproved = true;
  content.posterApprovedAt = "2026-10-22T16:10:00.000Z";
  for (const output of [
    buildMarkdown(brief({ sample: false }), content),
    buildHtml(brief({ sample: false }), content),
  ]) {
    assert.match(output, /User-provided event details/);
    assert.match(output, /not independently verified/);
    assert.match(output, /poster approved/);
    assert.match(output, /2026-10-22T16:10:00/);
  }
});

test("calendar uses correct London summer and winter offsets", () => {
  const summer = buildCalendar(brief({ date: "2026-07-15" }));
  assert.match(summer, /DTSTART:20260715T170000Z\r\n/);
  assert.match(summer, /DTEND:20260715T200000Z\r\n/);
  const winter = buildCalendar(brief({ date: "2026-12-15" }));
  assert.match(winter, /DTSTART:20261215T180000Z\r\n/);
  assert.match(winter, /DTEND:20261215T210000Z\r\n/);
  assert.match(summer, /SUMMARY:\[SAMPLE\]/);
  assert.match(summer, /STATUS:TENTATIVE/);
});

test("calendar converts events spanning a DST transition and rejects nonexistent or ambiguous wall times", () => {
  const spring = buildCalendar(
    brief({ date: "2026-03-29", startTime: "00:30", endTime: "03:00" }),
  );
  assert.match(spring, /DTSTART:20260329T003000Z/);
  assert.match(spring, /DTEND:20260329T020000Z/);
  const autumn = buildCalendar(
    brief({ date: "2026-10-25", startTime: "00:30", endTime: "03:00" }),
  );
  assert.match(autumn, /DTSTART:20261024T233000Z/);
  assert.match(autumn, /DTEND:20261025T030000Z/);
  assert.throws(
    () => buildCalendar(brief({ date: "2026-03-29", startTime: "01:30" })),
    /does not exist/,
  );
  assert.throws(
    () => buildCalendar(brief({ date: "2026-10-25", startTime: "01:30" })),
    /occurs twice/,
  );
});

test("calendar validates dates, times, timezone and duration before export", () => {
  assert.throws(
    () => buildCalendar(brief({ date: "2026-02-30" })),
    /valid calendar date/,
  );
  assert.throws(
    () => buildCalendar(brief({ startTime: "24:00" })),
    /valid date and 24-hour time/,
  );
  assert.throws(
    () => buildCalendar(brief({ startTime: "21:00", endTime: "18:00" })),
    /after the start/,
  );
  assert.throws(
    () => buildCalendar(brief({ timezone: "America/New_York" })),
    /Europe\/London only/,
  );
});

test("calendar escapes property injection, preserves Unicode and folds every line to at most 75 UTF-8 octets", () => {
  const name =
    "London, friends; \\ testing\nBEGIN:VEVENT\nATTENDEE:intruder@example.com " +
    "你好🎉".repeat(40);
  const output = buildCalendar(brief({ name, sample: false }));
  assert.equal(
    output.replace(/\r\n/g, "").includes("\n"),
    false,
    "all line endings must be CRLF",
  );
  for (const line of output.split("\r\n"))
    assert.ok(Buffer.byteLength(line, "utf8") <= 75, line);
  const unfolded = output.replace(/\r\n[ \t]/g, "");
  assert.match(
    unfolded,
    /SUMMARY:London\\, friends\\; \\\\ testing\\nBEGIN:VEVENT\\nATTENDEE:/,
  );
  assert.equal(
    unfolded.split("\r\n").filter((line) => line === "BEGIN:VEVENT").length,
    1,
  );
  assert.ok(unfolded.includes("你好🎉".repeat(40)));
  assert.ok(output.endsWith("END:VCALENDAR\r\n"));
});

test("poster keeps variable-length strings bounded, wraps long tokens and labels sample data", () => {
  const output = buildPosterSvg(
    brief({
      name: "W".repeat(700),
      community: "M".repeat(300),
      venue: "Long venue ".repeat(100),
      address: "A".repeat(1000),
      registrationUrl: "https://example.com/" + "x".repeat(1000),
    }),
  );
  assert.match(output, /width="1080" height="1350"/);
  assert.match(output, /FICTIONAL SAMPLE · NOT A REAL INVITATION/);
  assert.match(output, /…/);
  const visibleText = output.replace(
    /<title[\s\S]*?<\/title>|<desc[\s\S]*?<\/desc>/g,
    "",
  );
  assert.ok(
    !visibleText.includes("W".repeat(100)),
    "unbroken long titles should be split",
  );
  assert.ok(
    visibleText.length < 8000,
    "bounded poster text should not contain all of a long input",
  );
  assert.doesNotMatch(
    buildPosterSvg(brief({ sample: false })),
    /FICTIONAL SAMPLE/,
  );
});

test("poster uses the chosen six-digit accent and rejects markup or unsupported colour values", () => {
  const output = buildPosterSvg(brief({ accent: "#A13bF2" }));
  assert.equal(output.match(/fill="#A13bF2"/g)?.length, 2);
  assert.doesNotMatch(output, /fill="#ed793e"/);
  for (const accent of [
    "#fff",
    "red",
    '#123456" onload="alert(1)',
    "url(https://evil.test/image.svg)",
  ]) {
    const safe = buildPosterSvg(brief({ accent }));
    assert.equal(safe.match(/fill="#ed793e"/g)?.length, 2);
    assert.doesNotMatch(safe, /onload=|evil\.test/);
  }
});

test("export boundary rejects stale source even if every asset was approved before the change", () => {
  const source = brief();
  const approved = approveAll(source, generatePack(source));
  for (const changed of [
    { ...source, name: "A different event" },
    { ...source, date: "2026-11-10" },
  ]) {
    assert.throws(
      () => buildMarkdown(changed, approved),
      /stale.*brief changed/,
    );
    assert.throws(() => buildHtml(changed, approved), /stale.*brief changed/);
  }
  assert.match(
    buildHtml(source, approved),
    /5\/5 copy assets approved; poster approved/,
  );
});

test("poster displays the supplied timezone and invalid dates are never silently normalised", () => {
  const source = brief({ timezone: "America/New_York", date: "2026-02-30" });
  const poster = buildPosterSvg(source);
  assert.match(poster, /America\/New_York/);
  assert.doesNotMatch(poster, /LONDON TIME|Europe\/London|2 March/);
  assert.match(poster, /\[Add event date\]/);
  for (const output of [
    buildHtml(source, pack(source)),
    buildMarkdown(source, pack(source)),
  ]) {
    assert.doesNotMatch(output, /2 March/);
    assert.match(output, /Add event date/);
  }
});

test("exported ticket and budget numbers use the engine penny rounding for half-penny inputs", () => {
  const source = brief({
    capacity: 2,
    ticketPrice: 10.075,
    budget: [
      { id: "a", label: "A", amount: 10.075, confirmed: true },
      { id: "b", label: "B", amount: 1.255, confirmed: false },
    ],
  });
  const totals = calculateBudget(source);
  assert.equal(totals.costs, 11.34);
  assert.equal(totals.potentialRevenue, 20.16);
  for (const output of [
    buildHtml(source, pack(source)),
    buildMarkdown(source, pack(source)),
  ]) {
    assert.match(output, /£10\.08/);
    assert.match(output, /£11\.34/);
    assert.match(output, /£20\.16/);
    assert.doesNotMatch(output, /£10\.07/);
  }
});
