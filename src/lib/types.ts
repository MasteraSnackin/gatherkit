export interface BudgetItem {
  id: string;
  label: string;
  amount: number;
  confirmed: boolean;
}
export interface EventBrief {
  community: string;
  name: string;
  idea: string;
  audience: string;
  tone: string;
  date: string;
  startTime: string;
  endTime: string;
  timezone: string;
  venue: string;
  address: string;
  registrationUrl: string;
  capacity: number;
  ticketPrice: number;
  accessibility: string;
  contact: string;
  volunteers: string;
  notes: string;
  accent: string;
  sample: boolean;
  budget: BudgetItem[];
}
export type AssetId =
  "event-page" | "linkedin" | "whatsapp" | "discord" | "newsletter";
export interface ContentAsset {
  id: AssetId;
  title: string;
  channel: string;
  body: string;
  status: "draft" | "approved";
  approvedAt: string | null;
  edited: boolean;
  origin?: "template" | "imported";
}
export interface RunSheetItem {
  id: string;
  time: string;
  title: string;
  owner: string;
  detail: string;
}
export interface RotaItem {
  role: string;
  person: string;
  task: string;
}
export interface Issue {
  id: string;
  level: "error" | "warning";
  message: string;
  field?: keyof EventBrief;
}
export interface EventPack {
  sourceFingerprint: string;
  generatedAt: string;
  generationMs: number;
  assets: ContentAsset[];
  runSheet: RunSheetItem[];
  rota: RotaItem[];
  posterApproved: boolean;
  posterApprovedAt: string | null;
}
export interface Workspace {
  version: 1;
  brief: EventBrief;
  pack: EventPack | null;
  baselineMinutes: number;
  reviewMinutes: number;
  savedAt: string;
}
