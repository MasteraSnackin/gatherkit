import type { ContentAsset, EventBrief, EventPack } from "./types";
import {
  calculateBudget,
  formatEventDate,
  isPackStale,
  moneyToPence,
} from "./engine";

const clean = (value: unknown): string =>
  String(value ?? "").replace(
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,
    "",
  );
const xml = (value: unknown): string =>
  clean(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const md = (value: unknown): string =>
  clean(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\\`*_{}\[\]|~]/g, "\\$&")
    .replace(/^(\s*)([#>+-]|\d+[.)])(?=\s)/gm, "$1\\$2");
const mdCell = (value: unknown): string =>
  md(value).replace(/\r\n|\n|\r/g, " / ");
const pounds = (pence: number): string =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(
    pence / 100,
  );
const provenance = (brief: EventBrief): string =>
  brief.sample
    ? "Fictional sample — invented community and event details for demonstration. This is not a real invitation."
    : "User-provided event details — not independently verified.";

const copyOrigin = (asset: ContentAsset): string =>
  asset.origin === "imported"
    ? "Imported copy — provider attribution is unverified"
    : asset.edited
      ? "Edited by organiser"
      : "Local template";

const assemblyOrigin = (pack: EventPack): string =>
  pack.assets.some((asset) => asset.origin === "imported")
    ? "The event pack was assembled locally. It includes imported copy; the app has not authenticated the provider or verified the claims in that copy."
    : "Local deterministic templates; no model or external service was called by GatherKit.";

function pence(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 10_000_000)
    throw new Error(
      "Budget amounts and ticket prices must be valid, non-negative amounts.",
    );
  return moneyToPence(value);
}

function budget(brief: EventBrief) {
  if (
    !Number.isSafeInteger(brief.capacity) ||
    brief.capacity < 0 ||
    brief.capacity > 1_000_000
  )
    throw new Error("Capacity must be a valid non-negative whole number.");
  const rows = brief.budget.map((item) => ({
    ...item,
    pence: pence(item.amount),
  }));
  const ticket = pence(brief.ticketPrice);
  const totals = calculateBudget(brief);
  const total = moneyToPence(totals.costs);
  const confirmed = moneyToPence(totals.confirmedCosts);
  return {
    rows,
    total,
    confirmed,
    unconfirmed: moneyToPence(totals.unconfirmedCosts),
    ticket,
    revenue: moneyToPence(totals.potentialRevenue),
    breakEven: ticket ? Math.ceil(total / ticket) : null,
  };
}

function assertCurrentSource(brief: EventBrief, pack: EventPack): void {
  if (isPackStale(brief, pack))
    throw new Error(
      "This pack is stale because the event brief changed. Regenerate and review it before exporting.",
    );
}

function reviewSummary(pack: EventPack): string {
  const approved = pack.assets.filter(
    (asset) => asset.status === "approved",
  ).length;
  return `${approved}/${pack.assets.length} copy assets approved; poster ${pack.posterApproved ? "approved" : "draft"}. Approval records an organiser review, not publication.`;
}

export function buildMarkdown(brief: EventBrief, pack: EventPack): string {
  assertCurrentSource(brief, pack);
  const b = budget(brief);
  const lines = [
    `# ${md(brief.name)} — organiser pack`,
    "",
    `**Provenance:** ${md(provenance(brief))}`,
    "",
    `**Review state:** ${md(reviewSummary(pack))}`,
    "",
    `Assembled: ${md(pack.generatedAt)}. ${md(assemblyOrigin(pack))}`,
    "",
    "## Event brief",
    "",
    `- Community: ${md(brief.community)}`,
    `- Date: ${md(formatEventDate(brief))}`,
    `- Time: ${md(brief.startTime)}–${md(brief.endTime)} (${md(brief.timezone)})`,
    `- Venue: ${md(brief.venue || "To be confirmed")}`,
    `- Address: ${md(brief.address || "To be confirmed")}`,
    `- Audience: ${md(brief.audience)}`,
    `- Capacity: ${brief.capacity}`,
    `- Ticket price: ${pounds(b.ticket)}`,
    `- Registration: ${md(brief.registrationUrl || "To be confirmed")}`,
    `- Accessibility: ${md(brief.accessibility || "To be confirmed")}`,
    `- Contact: ${md(brief.contact || "To be confirmed")}`,
    `- Tone: ${md(brief.tone)}`,
    "",
    md(brief.idea),
    "",
    "## Promotional copy",
    "",
  ];
  for (const asset of pack.assets) {
    lines.push(
      `### ${md(asset.title)} (${md(asset.channel)})`,
      "",
      `**Status: ${asset.status === "approved" ? "APPROVED" : "DRAFT"}**${asset.status === "approved" && asset.approvedAt ? ` · Reviewed ${md(asset.approvedAt)}` : ""} · ${md(copyOrigin(asset))}`,
      "",
      md(asset.body),
      "",
    );
  }
  lines.push(
    "## Poster",
    "",
    `**Status: ${pack.posterApproved ? "APPROVED" : "DRAFT"}**${pack.posterApproved && pack.posterApprovedAt ? ` · Reviewed ${md(pack.posterApprovedAt)}` : ""}`,
    "",
    "The separate SVG/PNG download is a code-generated poster. Check the final artwork before sharing.",
    "",
    "## Run sheet",
    "",
    "| Time | Activity | Owner | Detail |",
    "| --- | --- | --- | --- |",
  );
  for (const item of pack.runSheet)
    lines.push(
      `| ${mdCell(item.time)} | ${mdCell(item.title)} | ${mdCell(item.owner)} | ${mdCell(item.detail)} |`,
    );
  lines.push(
    "",
    "## Volunteer rota",
    "",
    "| Role | Person | Task |",
    "| --- | --- | --- |",
  );
  for (const item of pack.rota)
    lines.push(
      `| ${mdCell(item.role)} | ${mdCell(item.person)} | ${mdCell(item.task)} |`,
    );
  lines.push(
    "",
    "## Budget (GBP)",
    "",
    "| Cost | Amount | Confirmation |",
    "| --- | ---: | --- |",
  );
  for (const item of b.rows)
    lines.push(
      `| ${mdCell(item.label)} | ${pounds(item.pence)} | ${item.confirmed ? "Confirmed by organiser" : "Estimate — unconfirmed"} |`,
    );
  lines.push(
    "",
    `- Total planned costs: **${pounds(b.total)}**`,
    `- Confirmed costs: ${pounds(b.confirmed)}`,
    `- Unconfirmed estimates: ${pounds(b.unconfirmed)}`,
    `- Maximum ticket income: ${brief.capacity} × ${pounds(b.ticket)} = **${pounds(b.revenue)}**`,
    `- Balance at full capacity: ${pounds(b.revenue)} − ${pounds(b.total)} = **${pounds(b.revenue - b.total)}**`,
    `- Cost recovery: ${b.breakEven === null ? (b.total ? "Free tickets cannot recover these costs; funding is required." : "No planned costs.") : `${b.breakEven} paid tickets before fees${b.breakEven > brief.capacity ? " — exceeds capacity" : ""}.`}`,
    "",
    "Income assumes every available place is sold. Fees, taxes, refunds and other income are not included. These are planning figures, not verified spend or forecasts.",
    "",
    "## Organiser notes",
    "",
    md(brief.notes || "No additional notes."),
    "",
    "## Publication and privacy",
    "",
    "GatherKit has not posted, emailed, booked or submitted these files. Copy remains draft unless explicitly marked approved above. Approval does not verify venue availability, prices or consent. Review contact details and volunteer names before sharing this file.",
    "",
  );
  return lines.join("\n");
}

export function buildHtml(brief: EventBrief, pack: EventPack): string {
  assertCurrentSource(brief, pack);
  const b = budget(brief);
  const paragraph = (value: string): string =>
    xml(value).replace(/\r?\n/g, "<br>");
  const assetCards = pack.assets
    .map(
      (asset) =>
        `<article class="asset"><div class="section-heading"><h3>${xml(asset.title)}</h3><span class="badge ${asset.status === "approved" ? "approved" : ""}">${asset.status === "approved" ? "Approved" : "Draft"}</span></div><p class="meta">${xml(asset.channel)} · ${xml(copyOrigin(asset))}${asset.status === "approved" && asset.approvedAt ? ` · Reviewed ${xml(asset.approvedAt)}` : ""}</p><div class="copy">${paragraph(asset.body)}</div></article>`,
    )
    .join("");
  const rows = (items: string[][]): string =>
    items
      .map(
        (row) =>
          `<tr>${row.map((cell) => `<td>${paragraph(cell)}</td>`).join("")}</tr>`,
      )
      .join("");
  return `<!doctype html>
<html lang="en-GB"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"><title>${xml(brief.name)} — organiser pack</title><style>
*{box-sizing:border-box}body{margin:0;background:#f1f0e8;color:#182b23;font:16px/1.6 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.page{max-width:980px;margin:40px auto;background:#fffef8;padding:60px;border:1px solid #d9ded3}.eyebrow{font-size:12px;font-weight:750;letter-spacing:.16em;text-transform:uppercase;color:#50664b}h1{font-size:48px;line-height:1.1;letter-spacing:-.05em;margin:14px 0 24px;overflow-wrap:anywhere}h2{font-size:25px;margin:48px 0 20px;padding-top:18px;border-top:2px solid #dce1d6;letter-spacing:-.025em}h3{font-size:19px;margin:0}.notice{border-left:4px solid #e07637;padding:14px 20px;background:#f9eadb}.meta{font-size:13px;color:#52635b}.details{display:grid;grid-template-columns:1fr 1fr;gap:14px 30px;margin:28px 0}.details dt{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#627060}.details dd{margin:3px 0 0;font-weight:600;overflow-wrap:anywhere}.asset{padding:24px;border:1px solid #dce1d6;border-radius:8px;margin:18px 0;break-inside:avoid}.section-heading{display:flex;gap:16px;align-items:center;justify-content:space-between}.badge{font-size:11px;letter-spacing:.06em;text-transform:uppercase;background:#f9e7d5;color:#7d421f;padding:4px 10px;border-radius:30px;white-space:nowrap}.badge.approved{background:#e1ebda;color:#304a29}.copy{white-space:normal;overflow-wrap:anywhere}table{width:100%;border-collapse:collapse;font-size:14px;table-layout:fixed}th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.05em;background:#edf0e6}td,th{padding:12px 10px;border-bottom:1px solid #dce1d6;vertical-align:top;overflow-wrap:anywhere}.totals{background:#edf0e6;padding:20px;margin:22px 0}.totals p{margin:8px 0}.footer{margin-top:48px;border-top:1px solid #dce1d6;padding-top:20px;color:#52635b;font-size:13px}p{overflow-wrap:anywhere}@media(max-width:650px){.page{margin:0;padding:28px 20px}h1{font-size:36px}.details{grid-template-columns:1fr}.section-heading{align-items:flex-start}td,th{padding:8px 5px;font-size:12px}}@media print{@page{size:A4;margin:15mm}body{background:white;font-size:10pt}.page{max-width:none;margin:0;padding:0;border:0}h1{font-size:30pt}h2{break-after:avoid;margin-top:25px}table{font-size:9pt}tr{break-inside:avoid}.asset{padding:16px}.notice,.totals,th{-webkit-print-color-adjust:exact;print-color-adjust:exact}a{color:inherit}}
</style></head><body><main class="page"><div class="eyebrow">GatherKit · Organiser pack</div><h1>${xml(brief.name)}</h1><div class="notice">${xml(provenance(brief))}</div><p class="meta">${xml(reviewSummary(pack))}<br>Assembled ${xml(pack.generatedAt)}. ${xml(assemblyOrigin(pack))}</p>
<h2>Event brief</h2><dl class="details">${[
    ["Community", brief.community],
    ["Date", formatEventDate(brief)],
    ["Time", `${brief.startTime}–${brief.endTime} (${brief.timezone})`],
    ["Venue", brief.venue || "To be confirmed"],
    ["Address", brief.address || "To be confirmed"],
    ["Audience", brief.audience],
    ["Capacity", String(brief.capacity)],
    ["Ticket price", pounds(b.ticket)],
    ["Registration", brief.registrationUrl || "To be confirmed"],
    ["Accessibility", brief.accessibility || "To be confirmed"],
    ["Contact", brief.contact || "To be confirmed"],
    ["Tone", brief.tone],
  ]
    .map(
      ([label, value]) =>
        `<div><dt>${xml(label)}</dt><dd>${paragraph(value)}</dd></div>`,
    )
    .join("")}</dl><p>${paragraph(brief.idea)}</p>
<h2>Promotional copy</h2>${assetCards}<h2>Poster review</h2><p><span class="badge ${pack.posterApproved ? "approved" : ""}">${pack.posterApproved ? "Approved" : "Draft"}</span>${pack.posterApproved && pack.posterApprovedAt ? ` Reviewed ${xml(pack.posterApprovedAt)}` : ""}</p><p>The separate SVG/PNG poster uses code-generated artwork. Check the final download before sharing.</p>
<h2>Run sheet</h2><table><thead><tr><th>Time</th><th>Activity</th><th>Owner</th><th>Detail</th></tr></thead><tbody>${rows(pack.runSheet.map((item) => [item.time, item.title, item.owner, item.detail]))}</tbody></table>
<h2>Volunteer rota</h2><table><thead><tr><th>Role</th><th>Person</th><th>Task</th></tr></thead><tbody>${rows(pack.rota.map((item) => [item.role, item.person, item.task]))}</tbody></table>
<h2>Budget · GBP</h2><table><thead><tr><th>Cost</th><th>Amount</th><th>Confirmation</th></tr></thead><tbody>${rows(b.rows.map((item) => [item.label, pounds(item.pence), item.confirmed ? "Confirmed by organiser" : "Estimate — unconfirmed"]))}</tbody></table><div class="totals"><p><strong>Total planned costs: ${pounds(b.total)}</strong></p><p>Confirmed costs: ${pounds(b.confirmed)} · Unconfirmed estimates: ${pounds(b.unconfirmed)}</p><p>Maximum ticket income: ${brief.capacity} × ${pounds(b.ticket)} = <strong>${pounds(b.revenue)}</strong></p><p>Balance at full capacity: ${pounds(b.revenue)} − ${pounds(b.total)} = <strong>${pounds(b.revenue - b.total)}</strong></p><p>Cost recovery: ${b.breakEven === null ? (b.total ? "Free tickets cannot recover these costs; funding is required." : "No planned costs.") : `${b.breakEven} paid tickets before fees${b.breakEven > brief.capacity ? " — exceeds capacity" : ""}.`}</p></div><p class="meta">Income assumes every available place is sold. Fees, taxes, refunds and other income are excluded. Planning figures are not verified spend or forecasts.</p>
<h2>Organiser notes</h2><p>${paragraph(brief.notes || "No additional notes.")}</p><footer class="footer">GatherKit has not posted, emailed, booked or submitted these files. Copy remains draft unless marked approved. Organiser approval does not verify venue availability, prices or consent. Review contact details and volunteer names before sharing. Grok Bot drafting is a separate handoff. This app has no direct model API, Notion or Ghost connection.</footer></main></body></html>`;
}

/** RFC 5545 TEXT escaping, before folding complete content lines. */
function icsText(value: string): string {
  return clean(value)
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\n|\r/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

/** Continuation lines include their leading space in the 75 UTF-8 octet limit. */
function foldCalendarLine(line: string): string {
  const encoder = new TextEncoder();
  let output = "";
  let column = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    if (column + size > 75) {
      output += "\r\n ";
      column = 1;
    }
    output += char;
    column += size;
  }
  return output;
}

function londonInstant(date: string, time: string): Date {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)
  )
    throw new Error("Calendar export needs a valid date and 24-hour time.");
  const target = `${date}T${time}:00`;
  const naive = new Date(`${target}Z`);
  if (
    Number.isNaN(naive.getTime()) ||
    naive.toISOString().slice(0, 19) !== target
  )
    throw new Error("Calendar export needs a valid calendar date.");
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const localStamp = (epoch: number): string => {
    const parts = Object.fromEntries(
      formatter
        .formatToParts(new Date(epoch))
        .map((part) => [part.type, part.value]),
    );
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
  };
  const offsets = new Set<number>();
  for (const delta of [-36, 0, 36]) {
    const sample = naive.getTime() + delta * 3_600_000;
    offsets.add(new Date(`${localStamp(sample)}Z`).getTime() - sample);
  }
  const matches = [...offsets]
    .map((offset) => naive.getTime() - offset)
    .filter((epoch) => localStamp(epoch) === target);
  if (!matches.length)
    throw new Error(
      "This London time does not exist because the clocks change. Choose a time outside the skipped hour.",
    );
  if (matches.length > 1)
    throw new Error(
      "This London time occurs twice when the clocks change. Choose a time outside the repeated hour.",
    );
  return new Date(matches[0]);
}

function stamp(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

export function buildCalendar(brief: EventBrief): string {
  if (brief.timezone !== "Europe/London")
    throw new Error("Calendar export currently supports Europe/London only.");
  const start = londonInstant(brief.date, brief.startTime);
  const end = londonInstant(brief.date, brief.endTime);
  if (end.getTime() <= start.getTime())
    throw new Error(
      "The event end time must be after the start on the same date.",
    );
  const identity = `${brief.community}\n${brief.name}\n${brief.date}\n${brief.startTime}\n${brief.sample}`;
  let hash = 2166136261;
  for (const char of identity) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 16777619);
  }
  const description = [
    provenance(brief),
    brief.idea,
    `Community: ${brief.community}`,
    `Audience: ${brief.audience}`,
    `Local time: ${brief.startTime}–${brief.endTime} Europe/London`,
    `Registration: ${brief.registrationUrl || "To be confirmed"}`,
    `Accessibility: ${brief.accessibility || "To be confirmed"}`,
    `Contact: ${brief.contact || "To be confirmed"}`,
    "Planning calendar entry. No booking, registration or publication has been made.",
  ].join("\n\n");
  return (
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//GatherKit//Local Event Pack//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      `UID:${(hash >>> 0).toString(16)}-${brief.date.replace(/-/g, "")}@gatherkit.local`,
      `DTSTAMP:${stamp(new Date())}`,
      `DTSTART:${stamp(start)}`,
      `DTEND:${stamp(end)}`,
      `SUMMARY:${icsText(`${brief.sample ? "[SAMPLE] " : ""}${brief.name}`)}`,
      `LOCATION:${icsText([brief.venue, brief.address].filter(Boolean).join(", "))}`,
      `DESCRIPTION:${icsText(description)}`,
      "STATUS:TENTATIVE",
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
      "END:VCALENDAR",
    ]
      .map(foldCalendarLine)
      .join("\r\n") + "\r\n"
  );
}

// Conservative width estimates protect exports even when the viewer substitutes fonts.
function textWidth(value: string, size: number): number {
  return Array.from(value).reduce(
    (width, char) =>
      width +
      (/\s/.test(char)
        ? 0.34
        : /[ilI.,'!:;|]/.test(char)
          ? 0.34
          : /[MW@%]/.test(char)
            ? 0.98
            : char.codePointAt(0)! > 255
              ? 1.12
              : 0.69) *
        size,
    0,
  );
}

function wrapText(
  value: string,
  width: number,
  size: number,
  limit: number,
): string[] {
  const words = clean(value)
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (textWidth(line ? `${line} ${word}` : word, size) <= width) {
      line = line ? `${line} ${word}` : word;
      continue;
    }
    if (line) {
      lines.push(line);
      line = "";
    }
    for (const char of word) {
      if (line && textWidth(line + char, size) > width) {
        lines.push(line);
        line = "";
      }
      line += char;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= limit) return lines;
  const result = lines.slice(0, limit);
  let last = result[limit - 1];
  while (last && textWidth(`${last}…`, size) > width)
    last = Array.from(last).slice(0, -1).join("");
  result[limit - 1] = last.replace(/\s+$/, "") + "…";
  return result;
}

function svgText(
  lines: string[],
  x: number,
  y: number,
  size: number,
  fill: string,
  weight = 500,
  lineHeight = 1.12,
): string {
  return `<text x="${x}" y="${y}" fill="${fill}" font-size="${size}" font-weight="${weight}">${lines.map((line, index) => `<tspan x="${x}" dy="${index ? size * lineHeight : 0}">${xml(line)}</tspan>`).join("")}</text>`;
}

export function buildPosterSvg(brief: EventBrief): string {
  const accent = /^#[0-9a-f]{6}$/i.test(brief.accent)
    ? brief.accent
    : "#ed793e";
  const width = 936;
  const title = brief.name || "Your next community gathering";
  let fontSize = 112;
  for (; fontSize > 54; fontSize -= 2) {
    if (
      !wrapText(title, width, fontSize, 5).some((line) => line.endsWith("…")) &&
      wrapText(title, width, fontSize, 5).length <= 4
    )
      break;
  }
  const titleLines = wrapText(title, width, fontSize, 5);
  const date = formatEventDate(brief);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350" role="img" aria-labelledby="poster-title poster-desc"><title id="poster-title">${xml(title)}</title><desc id="poster-desc">${xml(`${provenance(brief)} ${title}. ${date}, ${brief.startTime} to ${brief.endTime} ${brief.timezone}. ${brief.venue}. ${brief.registrationUrl}`)}</desc><defs><clipPath id="canvas"><rect width="1080" height="1350"/></clipPath></defs><g clip-path="url(#canvas)" font-family="Arial, Helvetica, sans-serif"><rect width="1080" height="1350" fill="#233b2c"/><path d="M0 0H1080V375C802 358 505 250 0 326Z" fill="#2b4532"/><circle cx="920" cy="225" r="183" fill="${accent}"/><circle cx="920" cy="225" r="119" fill="#233b2c"/><ellipse cx="920" cy="225" rx="268" ry="73" fill="none" stroke="#f4f0d9" stroke-width="3" transform="rotate(-33 920 225)"/><circle cx="704" cy="365" r="16" fill="#f4f0d9"/>${svgText(wrapText(brief.community || "A community gathering", 560, 25, 2), 72, 83, 25, "#f4f0d9", 700)}${svgText([brief.sample ? "FICTIONAL SAMPLE · NOT A REAL INVITATION" : "COME TOGETHER. MAKE SOMETHING."], 72, 162, brief.sample ? 17 : 18, "#bac5a2", 700)}${svgText(wrapText(date, 620, 25, 2), 72, 282, 25, "#f4f0d9", 600)}${svgText(wrapText(`${brief.startTime || "TBC"}–${brief.endTime || "TBC"} · ${brief.timezone || "Time zone to be confirmed"}`, 936, 22, 2), 72, 358, 22, "#f4f0d9", 500)}${svgText(titleLines, 65, 514, fontSize, "#f4f0d9", 800, 1.05)}<line x1="72" y1="1060" x2="1008" y2="1060" stroke="#627755" stroke-width="2"/>${svgText(wrapText(brief.venue || "Venue to be confirmed", 880, 31, 2), 72, 1110, 31, "#f4f0d9", 700)}${svgText(wrapText(brief.address || "Location details to follow", 880, 18, 2), 72, 1190, 18, "#bac5a2", 500)}<rect x="72" y="1252" width="936" height="58" rx="4" fill="${accent}"/>${svgText(wrapText(brief.registrationUrl ? `RSVP · ${brief.registrationUrl}` : "RSVP · REGISTRATION DETAILS TO FOLLOW", 888, 18, 1), 96, 1288, 18, "#18291f", 700)}</g></svg>`;
}

export function downloadText(
  filename: string,
  text: string,
  mime: string,
): void {
  downloadBlob(filename, new Blob([text], { type: mime }));
}

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.replace(/[\\/\u0000-\u001F]/g, "_");
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}

export async function downloadPosterPng(brief: EventBrief): Promise<void> {
  const url = URL.createObjectURL(
    new Blob([buildPosterSvg(brief)], { type: "image/svg+xml;charset=utf-8" }),
  );
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(
        () =>
          reject(
            new Error(
              "Poster rendering timed out. Try the SVG download instead.",
            ),
          ),
        15_000,
      );
      img.onload = () => {
        window.clearTimeout(timeout);
        resolve();
      };
      img.onerror = () => {
        window.clearTimeout(timeout);
        reject(
          new Error(
            "Poster image could not be rendered. Try the SVG download instead.",
          ),
        );
      };
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 1350;
    const context = canvas.getContext("2d");
    if (!context)
      throw new Error(
        "This browser cannot create PNG files. Use the SVG download instead.",
      );
    context.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (result) =>
          result
            ? resolve(result)
            : reject(
                new Error("PNG export failed. Try the SVG download instead."),
              ),
        "image/png",
      ),
    );
    downloadBlob("event-poster.png", blob);
  } finally {
    URL.revokeObjectURL(url);
  }
}
