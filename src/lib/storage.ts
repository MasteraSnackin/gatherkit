import type { EventBrief, EventPack, Workspace } from "./types";
import { sampleBrief } from "./engine";

const STORAGE_KEY = "event-autopilot.workspace.v1";
const MAX_BACKUP_BYTES = 1_000_000;
const briefStrings = [
  "community",
  "name",
  "idea",
  "audience",
  "tone",
  "date",
  "startTime",
  "endTime",
  "timezone",
  "venue",
  "address",
  "registrationUrl",
  "accessibility",
  "contact",
  "volunteers",
  "notes",
  "accent",
] as const;
const assetIds = [
  "event-page",
  "linkedin",
  "whatsapp",
  "discord",
  "newsletter",
];
const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const isText = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 30_000;
const isNumber = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 100_000_000;
const fail = (): never => {
  throw new Error(
    "This is not a valid Event Autopilot backup. Your current workspace has been kept.",
  );
};

export function createWorkspace(): Workspace {
  return {
    version: 1,
    brief: structuredClone(sampleBrief),
    pack: null,
    baselineMinutes: 100,
    reviewMinutes: 15,
    savedAt: new Date().toISOString(),
  };
}

export function parseWorkspace(json: string): Workspace {
  if (new TextEncoder().encode(json).length > MAX_BACKUP_BYTES)
    throw new Error(
      "This backup is too large. Choose an Event Autopilot JSON file under 1 MB.",
    );
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return fail();
  }
  if (
    !isObject(value) ||
    value.version !== 1 ||
    !isObject(value.brief) ||
    !isNumber(value.baselineMinutes) ||
    !isNumber(value.reviewMinutes) ||
    !isText(value.savedAt)
  )
    return fail();
  const b = value.brief;
  if (
    !briefStrings.every((k) => isText(b[k])) ||
    !["capacity", "ticketPrice"].every((k) => isNumber(b[k])) ||
    typeof b.sample !== "boolean" ||
    !Array.isArray(b.budget) ||
    b.budget.length > 100
  )
    return fail();
  if (!/^#[\da-f]{6}$/i.test(String(b.accent))) return fail();
  if (
    !b.budget.every(
      (i) =>
        isObject(i) &&
        isText(i.id) &&
        isText(i.label) &&
        isNumber(i.amount) &&
        typeof i.confirmed === "boolean",
    )
  )
    return fail();
  let pack: EventPack | null = null;
  if (value.pack !== null) {
    const p = value.pack;
    if (
      !isObject(p) ||
      !isText(p.sourceFingerprint) ||
      !isText(p.generatedAt) ||
      !isNumber(p.generationMs) ||
      typeof p.posterApproved !== "boolean" ||
      !(p.posterApprovedAt === null || isText(p.posterApprovedAt)) ||
      !Array.isArray(p.assets) ||
      p.assets.length !== 5 ||
      !Array.isArray(p.runSheet) ||
      p.runSheet.length > 100 ||
      !Array.isArray(p.rota) ||
      p.rota.length > 100
    )
      return fail();
    const seen = new Set<string>();
    for (const asset of p.assets) {
      if (
        !isObject(asset) ||
        !isText(asset.id) ||
        !assetIds.includes(asset.id) ||
        seen.has(asset.id) ||
        !isText(asset.title) ||
        !isText(asset.channel) ||
        !isText(asset.body) ||
        typeof asset.status !== "string" ||
        !["draft", "approved"].includes(asset.status) ||
        !(asset.approvedAt === null || isText(asset.approvedAt)) ||
        typeof asset.edited !== "boolean"
      )
        return fail();
      seen.add(asset.id);
    }
    if (
      !p.runSheet.every(
        (i) =>
          isObject(i) &&
          ["id", "time", "title", "owner", "detail"].every((k) => isText(i[k])),
      ) ||
      !p.rota.every(
        (i) =>
          isObject(i) && ["role", "person", "task"].every((k) => isText(i[k])),
      )
    )
      return fail();
    pack = structuredClone(p) as unknown as EventPack;
  }
  return {
    version: 1,
    brief: structuredClone(b) as unknown as EventBrief,
    pack,
    baselineMinutes: value.baselineMinutes,
    reviewMinutes: value.reviewMinutes,
    savedAt: value.savedAt,
  };
}

export function loadWorkspace(): {
  workspace: Workspace | null;
  error: string | null;
} {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return {
      workspace: raw === null ? null : parseWorkspace(raw),
      error: null,
    };
  } catch {
    return {
      workspace: null,
      error:
        "Your saved workspace could not be read. It has not been replaced. Import a backup or explicitly start a new workspace.",
    };
  }
}

export function saveWorkspace(workspace: Workspace): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
  } catch {
    throw new Error(
      "Changes could not be saved in this browser. Download a JSON backup to keep your work.",
    );
  }
}

export function clearWorkspace(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    throw new Error(
      "Browser storage is unavailable. Download a backup before closing this page.",
    );
  }
}
