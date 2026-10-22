import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clipboard,
  Clock3,
  FileText,
  FolderOpen,
  HeartHandshake,
  LayoutDashboard,
  MapPin,
  Menu,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Users,
  WandSparkles,
  X,
} from "lucide-react";
import type { AssetId, EventBrief, EventPack, Workspace } from "./lib/types";
import {
  sampleBrief,
  validateBrief,
  generatePack,
  calculateBudget,
  isPackStale,
  editAsset,
  approveAsset,
  approvePoster,
  approveAll,
  isFullyApproved,
  formatEventDate,
} from "./lib/engine";
import {
  buildMarkdown,
  buildHtml,
  buildCalendar,
  buildPosterSvg,
  downloadText,
  downloadPosterPng,
} from "./lib/export";
import {
  buildGrokPrompt,
  parseGrokReply,
  applyGrokReply,
  GROK_IMPORT_NOTICE,
  type DraftHandoffReply,
} from "./lib/grok";
import {
  loadWorkspace,
  saveWorkspace,
  parseWorkspace,
  clearWorkspace,
  createWorkspace,
} from "./lib/storage";

type Tab = "overview" | "run-sheet" | "promotion" | "team";
type Dialog = "brief" | "export" | "regenerate" | "new" | "grok" | null;
const tabs: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "run-sheet", label: "Run sheet" },
  { id: "promotion", label: "Promotion" },
  { id: "team", label: "Budget & team" },
];
const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "event";
const money = (amount: number) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
  }).format(amount);
const cleanError = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Something went wrong. Your current draft is still available.";
function blankBrief(): EventBrief {
  return {
    ...sampleBrief,
    community: "",
    name: "",
    idea: "",
    audience: "",
    tone: "Warm, welcoming and clear",
    date: "",
    startTime: "18:00",
    endTime: "21:00",
    venue: "",
    address: "",
    registrationUrl: "",
    capacity: 30,
    ticketPrice: 0,
    accessibility: "",
    contact: "",
    volunteers: "",
    notes: "",
    sample: false,
    budget: [],
  };
}
function IconBadge({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <span className={`icon-badge ${className}`}>{children}</span>;
}
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
function Modal({
  title,
  description,
  onClose,
  wide = false,
  children,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  wide?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const old = document.activeElement as HTMLElement;
    const timer = window.setTimeout(
      () =>
        ref.current
          ?.querySelector<HTMLElement>("button, input, textarea, select")
          ?.focus(),
      0,
    );
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = previous;
      old?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
          if (event.key === "Tab") {
            const items = ref.current?.querySelectorAll<HTMLElement>(
              "button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href]",
            );
            if (!items?.length) return;
            const first = items[0];
            const last = items[items.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <header className="modal-heading">
          <div>
            <p className="eyebrow">GATHERKIT</p>
            <h2 id="modal-title">{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

export default function App() {
  const [initial] = useState(loadWorkspace);
  const [workspace, setWorkspace] = useState<Workspace>(
    () => initial.workspace ?? createWorkspace(),
  );
  const [storageBlocked, setStorageBlocked] = useState(Boolean(initial.error));
  const [storageError, setStorageError] = useState<string | null>(
    initial.error,
  );
  const [saveStatus, setSaveStatus] = useState<"saving" | "saved" | "error">(
    initial.error ? "error" : "saved",
  );
  const [tab, setTab] = useState<Tab>("overview");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [activeAsset, setActiveAsset] = useState<AssetId>("event-page");
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [editingRunSheet, setEditingRunSheet] = useState(false);
  const [pngBusy, setPngBusy] = useState(false);
  const [grokPrompt, setGrokPrompt] = useState("");
  const [grokReplyText, setGrokReplyText] = useState("");
  const [grokPreview, setGrokPreview] = useState<DraftHandoffReply | null>(
    null,
  );
  const [grokError, setGrokError] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const grokPreviewRef = useRef<HTMLDivElement>(null);
  const brief = workspace.brief;
  const pack = workspace.pack;
  const stale = Boolean(pack && isPackStale(brief, pack));
  const issues = validateBrief(brief).filter(
    (issue) => issue.id !== "unassigned-volunteers" || !pack || stale,
  );
  if (pack && !stale) {
    const unassigned = pack.rota
      .filter(
        (row) =>
          !row.person.trim() ||
          /^(unassigned|tbc|tbd|to be confirmed)$/i.test(row.person.trim()),
      )
      .map((row) => row.role);
    if (unassigned.length)
      issues.push({
        id: "unassigned-volunteers",
        level: "warning",
        message: `Roles still unassigned: ${unassigned.join(", ")}. Assign people in Budget & team.`,
        field: "volunteers",
      });
  }
  const hasErrors = issues.some((issue) => issue.level === "error");
  const approved = Boolean(pack && !stale && isFullyApproved(brief, pack));
  const approvedCount =
    pack && !stale
      ? pack.assets.filter((asset) => asset.status === "approved").length +
        Number(pack.posterApproved)
      : 0;
  const budget = calculateBudget(brief);
  const budgetTotal = budget.costs;
  const estimatedMinutes = Math.max(
    0,
    workspace.baselineMinutes -
      workspace.reviewMinutes -
      (pack?.generationMs ?? 0) / 60000,
  );
  const selectedAsset =
    pack?.assets.find((asset) => asset.id === activeAsset) ?? pack?.assets[0];

  useEffect(() => {
    if (storageBlocked) return;
    setSaveStatus("saving");
    const timer = window.setTimeout(() => {
      try {
        saveWorkspace({ ...workspace, savedAt: new Date().toISOString() });
        setSaveStatus("saved");
        setStorageError(null);
      } catch (error) {
        setStorageError(cleanError(error));
        setSaveStatus("error");
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [workspace, storageBlocked]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (grokPreview)
      grokPreviewRef.current?.scrollIntoView({ block: "nearest" });
  }, [grokPreview]);
  function updateBrief<K extends keyof EventBrief>(
    key: K,
    value: EventBrief[K],
  ) {
    setWorkspace((current) => ({
      ...current,
      brief: { ...current.brief, [key]: value },
    }));
  }
  function attempt(action: () => void) {
    try {
      setActionError(null);
      action();
    } catch (error) {
      setActionError(cleanError(error));
    }
  }
  function updatePack(action: (current: EventPack) => EventPack) {
    if (!pack) return;
    attempt(() => {
      const next = action(pack);
      setWorkspace((current) => ({ ...current, pack: next }));
    });
  }
  function openGrokHandoff() {
    attempt(() => {
      if (!pack)
        throw new Error("Create an event pack before drafting with Grok Bot.");
      if (isPackStale(brief, pack))
        throw new Error(
          "Your brief has changed. Regenerate the pack before starting a Grok Bot handoff.",
        );
      if (hasErrors)
        throw new Error(
          "Complete the required event details before creating the drafting prompt.",
        );
      setGrokPrompt(buildGrokPrompt(brief));
      setGrokPreview(null);
      setGrokError(null);
      setDialog("grok");
    });
  }
  async function copyGrokPrompt() {
    try {
      await navigator.clipboard.writeText(grokPrompt);
      setGrokError(null);
      setNotice(
        "Event brief prompt copied. Paste it into Grok Bot when you are ready.",
      );
    } catch {
      setGrokError(
        "Clipboard access is unavailable. Expand the prompt below to select and copy it, or download the prompt file.",
      );
    }
  }
  function previewGrokReply() {
    try {
      setGrokError(null);
      if (!pack || isPackStale(brief, pack))
        throw new Error(
          "The current pack no longer matches your brief. Regenerate it and copy a fresh prompt before importing a reply.",
        );
      setGrokPreview(parseGrokReply(grokReplyText, brief));
    } catch (error) {
      setGrokPreview(null);
      setGrokError(cleanError(error));
    }
  }
  function useGrokDrafts() {
    try {
      if (!pack || !grokPreview)
        throw new Error(
          "Preview the structured reply before replacing your drafts.",
        );
      const reply = parseGrokReply(grokReplyText, brief);
      const next = applyGrokReply(brief, pack, reply);
      setWorkspace((current) => ({ ...current, pack: next }));
      setGrokPreview(null);
      setGrokReplyText("");
      setGrokError(null);
      setDialog(null);
      setActiveAsset("event-page");
      setTab("promotion");
      setNotice(
        "Five imported drafts are ready for your review. Their source is not independently verified.",
      );
    } catch (error) {
      setGrokError(cleanError(error));
    }
  }
  function generate() {
    attempt(() => {
      const next = generatePack(brief);
      setWorkspace((current) => ({ ...current, pack: next }));
      setDialog(null);
      setNotice("Your event pack is ready to review.");
    });
  }
  function requestGenerate() {
    if (hasErrors) {
      setDialog("brief");
      setActionError(
        "Complete the required brief details before generating your pack.",
      );
      return;
    }
    if (pack) setDialog("regenerate");
    else generate();
  }
  function reset(useSample: boolean) {
    attempt(() => {
      if (storageBlocked) clearWorkspace();
      const next = createWorkspace();
      setWorkspace({
        ...next,
        brief: useSample ? structuredClone(sampleBrief) : blankBrief(),
        pack: null,
      });
      setStorageBlocked(false);
      setStorageError(null);
      setTab("overview");
      setDialog(useSample ? null : "brief");
      setNotice(
        useSample ? "Fictional demo loaded." : "A fresh event brief is ready.",
      );
    });
  }
  function backup() {
    attempt(() => {
      downloadText(
        `${slug(brief.name)}-workspace.json`,
        JSON.stringify(workspace, null, 2),
        "application/json",
      );
      setNotice(
        "Workspace backup downloaded, including drafts and approval state.",
      );
    });
  }
  async function importBackup(file?: File) {
    if (!file) return;
    try {
      const imported = parseWorkspace(await file.text());
      setWorkspace(imported);
      setStorageBlocked(false);
      setStorageError(null);
      setActionError(null);
      setTab("overview");
      setNotice("Workspace restored from your backup.");
    } catch (error) {
      setActionError(`Could not import this backup: ${cleanError(error)}`);
    }
    if (importRef.current) importRef.current.value = "";
  }
  async function exportPack(format: "md" | "html" | "ics" | "svg" | "png") {
    try {
      setActionError(null);
      if (!pack || isPackStale(brief, pack) || !isFullyApproved(brief, pack))
        throw new Error(
          "Review and approve all five text assets and the poster before exporting.",
        );
      const name = slug(brief.name);
      if (format === "md")
        downloadText(
          `${name}-event-pack.md`,
          buildMarkdown(brief, pack),
          "text/markdown",
        );
      if (format === "html")
        downloadText(
          `${name}-event-pack.html`,
          buildHtml(brief, pack),
          "text/html",
        );
      if (format === "ics")
        downloadText(`${name}.ics`, buildCalendar(brief), "text/calendar");
      if (format === "svg")
        downloadText(
          `${name}-poster.svg`,
          buildPosterSvg(brief),
          "image/svg+xml",
        );
      if (format === "png") {
        setPngBusy(true);
        await downloadPosterPng(brief);
      }
      setNotice(
        `${format.toUpperCase()} downloaded. Your pack stays editable.`,
      );
    } catch (error) {
      setActionError(cleanError(error));
    } finally {
      setPngBusy(false);
    }
  }
  function invalidateOperations(next: EventPack): EventPack {
    return {
      ...next,
      assets: next.assets.map((asset) => ({
        ...asset,
        status: "draft",
        approvedAt: null,
      })),
      posterApproved: false,
      posterApprovedAt: null,
    };
  }
  const eventDate = brief.date
    ? formatEventDate(brief)
    : "Date to be confirmed";
  const posterData = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(buildPosterSvg(brief))}`;

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileMenu ? "is-open" : ""}`}>
        <a
          className="brand"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            setTab("overview");
            setMobileMenu(false);
          }}
          aria-label="GatherKit home"
        >
          <span className="brand-mark">
            <span />
            <span />
            <span />
          </span>
          <span>
            Gather<span className="brand-light">Kit</span>
            <small>ONE BRIEF. YOUR WHOLE EVENT.</small>
          </span>
        </a>
        <div className="workspace-switch">
          <span className="community-avatar">
            {brief.community.trim().slice(0, 1).toUpperCase() || "Y"}
          </span>
          <div>
            <strong>{brief.community || "Your community"}</strong>
            <span>Local workspace</span>
          </div>
          <span className="local-dot" title="Stored locally" />
        </div>
        <p className="nav-caption">WORKSPACE</p>
        <nav className="primary-nav" aria-label="Main navigation">
          <button
            className={dialog !== "brief" ? "active" : ""}
            onClick={() => {
              setTab("overview");
              setMobileMenu(false);
            }}
          >
            <LayoutDashboard size={18} />
            <span>Event workspace</span>
            <ChevronRight size={15} />
          </button>
          <button
            onClick={() => {
              setDialog("brief");
              setMobileMenu(false);
            }}
          >
            <FileText size={18} />
            <span>Event brief</span>
          </button>
          <button
            onClick={() => {
              setDialog("export");
              setMobileMenu(false);
            }}
          >
            <ShieldCheck size={18} />
            <span>Review & export</span>
            {pack && <span className="nav-count">{approvedCount}/6</span>}
          </button>
        </nav>
        <div className="sidebar-event">
          <p className="nav-caption">CURRENT EVENT</p>
          <div className="sidebar-event-link">
            <span className="event-dot" />
            <div>
              <strong>{brief.name || "Untitled event"}</strong>
              <span>
                {brief.sample ? "Fictional demo event" : "Your event"}
              </span>
            </div>
          </div>
          <button
            className="text-button muted"
            onClick={() => setDialog("new")}
          >
            <Plus size={16} />
            Start a new event
          </button>
        </div>
        <div className="sidebar-bottom">
          <div className="local-note">
            <ShieldCheck size={18} />
            <strong>Your workspace. Your device.</strong>
            <p>
              Briefs and drafts stay in this browser. Download a backup to take
              them with you.
            </p>
            <button className="text-button" onClick={backup}>
              Download backup <ArrowDownToLine size={14} />
            </button>
            <button
              className="text-button muted"
              onClick={() => importRef.current?.click()}
            >
              Restore a backup <ArrowUpRight size={14} />
            </button>
          </div>
          <div className="sidebar-footer">
            <span className="tiny-logo">gk</span>
            <span>
              Made for people
              <br />
              <strong>who bring people together.</strong>
            </span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="mobile-menu icon-button"
              onClick={() => setMobileMenu(!mobileMenu)}
              aria-label="Toggle navigation"
            >
              <Menu size={20} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>{brief.name || "New event"}</strong>
          </div>
          <span
            className={`save-status ${saveStatus === "error" ? "error-text" : ""}`}
          >
            {saveStatus === "saved" ? (
              <CheckCheck size={15} />
            ) : saveStatus === "error" ? (
              <CircleAlert size={15} />
            ) : (
              <Clock3 size={15} />
            )}
            {saveStatus === "saved"
              ? "Saved on this device"
              : saveStatus === "saving"
                ? "Saving locally…"
                : "Not saved"}
          </span>
        </header>
        <main>
          {storageError && (
            <div className="alert alert-error" role="alert">
              <CircleAlert size={20} />
              <div>
                <strong>
                  {storageBlocked
                    ? "Saved workspace needs attention"
                    : "Your latest changes could not be saved"}
                </strong>
                <p>
                  {storageError}{" "}
                  {storageBlocked
                    ? "Autosave is paused to protect the existing data. Restore a valid backup or explicitly start a new event."
                    : "Keep this tab open and download a backup of your work."}
                </p>
                <div className="inline-actions">
                  <button className="text-button" onClick={backup}>
                    Download current backup
                  </button>
                  <button
                    className="text-button"
                    onClick={() => importRef.current?.click()}
                  >
                    Restore backup
                  </button>
                  {storageBlocked && (
                    <button
                      className="text-button"
                      onClick={() => setDialog("new")}
                    >
                      Replace with a new event
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
          {actionError && (
            <div className="alert alert-error" role="alert">
              <CircleAlert size={19} />
              <p>{actionError}</p>
              <button
                className="icon-button"
                onClick={() => setActionError(null)}
                aria-label="Dismiss error"
              >
                <X size={16} />
              </button>
            </div>
          )}
          <div className="page-heading">
            <div>
              <div className="heading-kicker">
                <span className="eyebrow">YOUR EVENT, COMING TOGETHER</span>
                {brief.sample && (
                  <span className="tag sample-tag">Fictional demo</span>
                )}
              </div>
              <h1>{brief.name || "Make room for a good idea."}</h1>
              <p>
                {brief.community ? `${brief.community} · ` : ""}
                {brief.idea ||
                  "One thoughtful brief. Everything you need to bring people together."}
              </p>
            </div>
            <div className="heading-actions">
              <button
                className="button secondary"
                onClick={() => setDialog("brief")}
              >
                <FileText size={16} />
                Edit brief
              </button>
              <button
                className="button primary"
                onClick={pack ? () => setDialog("export") : requestGenerate}
              >
                {pack ? (
                  <ArrowDownToLine size={17} />
                ) : (
                  <WandSparkles size={17} />
                )}
                {pack ? "Review & export" : "Create event pack"}
              </button>
            </div>
          </div>
          <div className="event-meta">
            <span>
              <CalendarDays size={16} />
              {eventDate}
            </span>
            <span>
              <Clock3 size={16} />
              {brief.startTime || "—"}–{brief.endTime || "—"}{" "}
              <small>{brief.timezone}</small>
            </span>
            <span>
              <MapPin size={16} />
              {brief.venue || "Venue to be confirmed"}
            </span>
            <span>
              <Users size={16} />
              {brief.capacity} places
            </span>
          </div>
          <div
            className="tab-row"
            role="tablist"
            aria-label="Event pack sections"
          >
            {tabs.map((item) => (
              <button
                key={item.id}
                id={`tab-${item.id}`}
                role="tab"
                aria-selected={tab === item.id}
                aria-controls={`panel-${item.id}`}
                tabIndex={tab === item.id ? 0 : -1}
                onKeyDown={(event) => {
                  if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                    event.preventDefault();
                    const next =
                      tabs[
                        (tabs.findIndex(
                          (candidate) => candidate.id === item.id,
                        ) +
                          (event.key === "ArrowRight" ? 1 : 3)) %
                          4
                      ];
                    setTab(next.id);
                    document.getElementById(`tab-${next.id}`)?.focus();
                  }
                }}
                className={tab === item.id ? "selected" : ""}
                onClick={() => setTab(item.id)}
              >
                {item.label}
                {item.id === "promotion" && <span>6</span>}
              </button>
            ))}
            <span className={`pack-state ${approved ? "approved" : ""}`}>
              <span />
              {stale
                ? "Brief updated · pack needs refresh"
                : approved
                  ? "Approved for export"
                  : pack
                    ? "Ready for your review"
                    : "Brief in progress"}
            </span>
          </div>
          {stale && (
            <div className="alert stale-alert">
              <RefreshCw size={18} />
              <div>
                <strong>Your brief has changed.</strong>
                <p>
                  Your existing copy is preserved. Regenerate the pack to apply
                  the new details, then review it again.
                </p>
              </div>
              <button
                className="button small secondary"
                onClick={requestGenerate}
              >
                Regenerate pack
              </button>
            </div>
          )}
          <section
            id={`panel-${tab}`}
            role="tabpanel"
            aria-labelledby={`tab-${tab}`}
          >
            {tab === "overview" && (
              <>
                <div className="overview-grid">
                  <div className="overview-main">
                    <section className="welcome-card">
                      <div className="welcome-copy">
                        <span className="eyebrow">
                          {pack
                            ? "LESS ADMIN. MORE COMMUNITY."
                            : "LET’S GET THE GOOD PART STARTED."}
                        </span>
                        <h2>
                          {pack ? (
                            <>
                              The plan is here.
                              <br />
                              Make it yours.
                            </>
                          ) : (
                            <>
                              One brief.
                              <br />A gathering in the making.
                            </>
                          )}
                        </h2>
                        <p>
                          {pack
                            ? "Your run sheet, promotional copy and event visual are ready. Give them a human touch, then approve what’s going out."
                            : "Turn your event idea into a practical run sheet, five promotional drafts and a ready-to-share visual."}
                        </p>
                        <button
                          className="button primary"
                          onClick={
                            pack ? () => setTab("promotion") : requestGenerate
                          }
                        >
                          {pack
                            ? "Review your drafts"
                            : "Create your event pack"}
                          <ArrowRight size={17} />
                        </button>
                        <div className="engine-label">
                          <span className="mini-spark">
                            <Sparkles size={12} />
                          </span>
                          {pack?.assets.some(
                            (asset) => asset.origin === "imported",
                          )
                            ? "Local event pack · imported copy for review"
                            : "Local template engine · no AI service connected"}
                        </div>
                      </div>
                      <div className="gathering-art" aria-hidden="true">
                        <div className="art-orbit orbit-one" />
                        <div className="art-orbit orbit-two" />
                        <span className="art-circle circle-orange" />
                        <span className="art-circle circle-olive" />
                        <span className="art-circle circle-cream" />
                        <span className="art-circle circle-forest" />
                        <div className="art-label">
                          <span>GOOD PEOPLE.</span>
                          <span>GOOD IDEAS.</span>
                          <span>IN ONE ROOM.</span>
                        </div>
                        <span className="art-plus">+</span>
                      </div>
                    </section>
                    <div className="stats-grid">
                      <div className="stat-card">
                        <span>
                          <ShieldCheck size={16} />
                          Ready to share
                        </span>
                        <strong>
                          {approvedCount}
                          <small> / 6</small>
                        </strong>
                        <p>Assets approved by you</p>
                        <div className="progress-track">
                          <i
                            style={{ width: `${(approvedCount / 6) * 100}%` }}
                          />
                        </div>
                      </div>
                      <div className="stat-card">
                        <span>
                          <Users size={16} />
                          People in the room
                        </span>
                        <strong>
                          {brief.capacity}
                          <small> places</small>
                        </strong>
                        <p>
                          {brief.ticketPrice === 0
                            ? "Free to attend"
                            : `${money(brief.ticketPrice)} per ticket`}
                        </p>
                        <span className="stat-footnote">
                          Capacity from your brief
                        </span>
                      </div>
                      <div className="stat-card">
                        <span>
                          <HeartHandshake size={16} />
                          Planned event costs
                        </span>
                        <strong>{money(budgetTotal)}</strong>
                        <p>{brief.budget.length} planned cost items</p>
                        <button
                          className="inline-link"
                          onClick={() => setTab("team")}
                        >
                          See budget & team <ArrowRight size={13} />
                        </button>
                      </div>
                    </div>
                    <section className="card checklist-card">
                      <div className="section-heading">
                        <div>
                          <p className="eyebrow">A CLEAR PATH TO READY</p>
                          <h2>Your event toolkit</h2>
                        </div>
                        <span className="soft-tag">
                          {pack
                            ? "6 assets, one shared brief"
                            : "Built from your brief"}
                        </span>
                      </div>
                      <div className="toolkit-list">
                        {[
                          {
                            title: "The practical plan",
                            desc: "A timed run sheet, costs and volunteer roles.",
                            icon: CalendarDays,
                            target: "run-sheet" as Tab,
                            num: "01",
                          },
                          {
                            title: "The words to bring people in",
                            desc: "Event page, LinkedIn, WhatsApp, Discord and newsletter.",
                            icon: FileText,
                            target: "promotion" as Tab,
                            num: "02",
                          },
                          {
                            title: "The finishing touch",
                            desc: "A branded visual, human approval and portable exports.",
                            icon: ShieldCheck,
                            target: "promotion" as Tab,
                            num: "03",
                          },
                        ].map((row) => (
                          <button
                            key={row.num}
                            onClick={() => setTab(row.target)}
                          >
                            <span className="step-number">{row.num}</span>
                            <IconBadge>
                              <row.icon size={19} />
                            </IconBadge>
                            <div>
                              <strong>{row.title}</strong>
                              <p>{row.desc}</p>
                            </div>
                            <span className="toolkit-status">
                              {pack ? "Review" : "Preview"}
                              <ArrowUpRight size={16} />
                            </span>
                          </button>
                        ))}
                      </div>
                    </section>
                  </div>
                  <aside className="overview-aside">
                    <section className="card brief-summary">
                      <div className="section-heading">
                        <h2>The brief</h2>
                        <button
                          className="icon-button"
                          onClick={() => setDialog("brief")}
                          aria-label="Edit event brief"
                        >
                          <ArrowUpRight size={18} />
                        </button>
                      </div>
                      <div className="brief-summary-item">
                        <span>THE COMMUNITY</span>
                        <strong>{brief.community || "Your community"}</strong>
                        <p>
                          {brief.audience || "Who are you bringing together?"}
                        </p>
                      </div>
                      <div className="brief-summary-item">
                        <span>THE FEELING</span>
                        <p>{brief.tone || "Choose a tone in your brief."}</p>
                      </div>
                      <div className="brief-summary-item">
                        <span>THE DETAILS</span>
                        <p>
                          {brief.venue || "Venue to be confirmed"}
                          {brief.address ? `, ${brief.address}` : ""}
                        </p>
                        {brief.registrationUrl ? (
                          <a
                            href={
                              /^https?:\/\//i.test(brief.registrationUrl)
                                ? brief.registrationUrl
                                : undefined
                            }
                            target="_blank"
                            rel="noreferrer"
                          >
                            Registration link <ArrowUpRight size={13} />
                          </a>
                        ) : (
                          <span className="pending-detail">
                            RSVP link still needed
                          </span>
                        )}
                      </div>
                      {brief.sample && (
                        <div className="fictional-note">
                          This community and event are fictional. Replace the
                          sample details before real use.
                        </div>
                      )}
                    </section>
                    <section
                      className={`card readiness-card ${issues.length ? "" : "ready"}`}
                    >
                      <div className="section-heading">
                        <h2>
                          {issues.length
                            ? "A few things to check"
                            : "The details are in place"}
                        </h2>
                        {issues.length ? (
                          <CircleAlert size={19} />
                        ) : (
                          <Check size={19} />
                        )}
                      </div>
                      {issues.length ? (
                        <ul>
                          {issues.slice(0, 4).map((issue) => (
                            <li key={issue.id}>
                              <span
                                className={
                                  issue.level === "error"
                                    ? "issue-dot error"
                                    : "issue-dot"
                                }
                              />
                              {issue.message}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p>
                          Your brief has the essentials. Review every draft
                          before sharing.
                        </p>
                      )}
                      {issues.length > 4 && (
                        <p className="small-text">
                          Plus {issues.length - 4} more checks in your brief.
                        </p>
                      )}
                      <button
                        className="text-button"
                        onClick={() => setDialog("brief")}
                      >
                        Check event details <ArrowRight size={14} />
                      </button>
                    </section>
                    <section className="estimate-card">
                      <div className="estimate-heading">
                        <Clock3 size={17} />
                        <span>Time back for the good stuff</span>
                      </div>
                      <p className="estimate-number">
                        {Math.round(estimatedMinutes)}
                        <span> min</span>
                      </p>
                      <p>Estimated admin time saved</p>
                      <details>
                        <summary>
                          Edit planning assumptions <ChevronDown size={14} />
                        </summary>
                        <div className="estimate-inputs">
                          <Field label="Manual preparation (min)">
                            <input
                              type="number"
                              min="0"
                              max="10000"
                              value={workspace.baselineMinutes}
                              onChange={(event) =>
                                setWorkspace((current) => ({
                                  ...current,
                                  baselineMinutes: Math.max(
                                    0,
                                    Number(event.target.value),
                                  ),
                                }))
                              }
                            />
                          </Field>
                          <Field label="Your review time (min)">
                            <input
                              type="number"
                              min="0"
                              max="10000"
                              value={workspace.reviewMinutes}
                              onChange={(event) =>
                                setWorkspace((current) => ({
                                  ...current,
                                  reviewMinutes: Math.max(
                                    0,
                                    Number(event.target.value),
                                  ),
                                }))
                              }
                            />
                          </Field>
                        </div>
                      </details>
                      <small>
                        An estimate from your assumptions, not measured time
                        saved.
                        {pack
                          ? ` Local template assembly: ${pack.generationMs.toFixed(1)} ms.`
                          : " Generate a pack to measure assembly time."}
                      </small>
                    </section>
                  </aside>
                </div>
              </>
            )}
            {tab === "run-sheet" && (
              <>
                <div className="section-page-heading">
                  <div>
                    <p className="eyebrow">KEEP THE DAY FLOWING</p>
                    <h2>A little structure. Room for spontaneity.</h2>
                    <p>
                      A shared plan for the people making your gathering happen.
                    </p>
                  </div>
                  {pack && (
                    <button
                      className="button secondary"
                      onClick={() => setEditingRunSheet(!editingRunSheet)}
                    >
                      {editingRunSheet ? (
                        <Check size={16} />
                      ) : (
                        <FileText size={16} />
                      )}
                      {editingRunSheet ? "Done editing" : "Edit run sheet"}
                    </button>
                  )}
                </div>
                {!pack ? (
                  <EmptyState
                    title="Every good gathering has a plan."
                    description="Generate your event pack to create a timed run sheet and assign your team."
                    onGenerate={requestGenerate}
                  />
                ) : (
                  <>
                    <section className="card run-sheet">
                      <div className="run-sheet-top">
                        <span>
                          <CalendarDays size={17} />
                          {eventDate}
                        </span>
                        <span>
                          <MapPin size={16} />
                          {brief.venue || "Venue to be confirmed"}
                        </span>
                      </div>
                      {editingRunSheet && (
                        <p className="edit-notice">
                          Editing the plan resets approvals so the final pack
                          can be reviewed together.
                        </p>
                      )}
                      <div className="run-sheet-rows">
                        {pack.runSheet.map((item, index) => (
                          <div className="run-sheet-row" key={item.id}>
                            <div className="timeline-marker">
                              <span />
                              {index < pack.runSheet.length - 1 && <i />}
                            </div>
                            {editingRunSheet ? (
                              <>
                                <label
                                  className="sr-only"
                                  htmlFor={`time-${item.id}`}
                                >
                                  Time for {item.title}
                                </label>
                                <input
                                  id={`time-${item.id}`}
                                  className="run-time-input"
                                  value={item.time}
                                  onChange={(event) =>
                                    updatePack((current) =>
                                      invalidateOperations({
                                        ...current,
                                        runSheet: current.runSheet.map((row) =>
                                          row.id === item.id
                                            ? {
                                                ...row,
                                                time: event.target.value,
                                              }
                                            : row,
                                        ),
                                      }),
                                    )
                                  }
                                />
                                <div className="run-row-edit">
                                  <input
                                    aria-label={`Title for run sheet item ${index + 1}`}
                                    value={item.title}
                                    onChange={(event) =>
                                      updatePack((current) =>
                                        invalidateOperations({
                                          ...current,
                                          runSheet: current.runSheet.map(
                                            (row) =>
                                              row.id === item.id
                                                ? {
                                                    ...row,
                                                    title: event.target.value,
                                                  }
                                                : row,
                                          ),
                                        }),
                                      )
                                    }
                                  />
                                  <textarea
                                    aria-label={`Details for ${item.title}`}
                                    rows={2}
                                    value={item.detail}
                                    onChange={(event) =>
                                      updatePack((current) =>
                                        invalidateOperations({
                                          ...current,
                                          runSheet: current.runSheet.map(
                                            (row) =>
                                              row.id === item.id
                                                ? {
                                                    ...row,
                                                    detail: event.target.value,
                                                  }
                                                : row,
                                          ),
                                        }),
                                      )
                                    }
                                  />
                                </div>
                                <input
                                  aria-label={`Owner for ${item.title}`}
                                  className="run-owner-input"
                                  value={item.owner}
                                  onChange={(event) =>
                                    updatePack((current) =>
                                      invalidateOperations({
                                        ...current,
                                        runSheet: current.runSheet.map((row) =>
                                          row.id === item.id
                                            ? {
                                                ...row,
                                                owner: event.target.value,
                                              }
                                            : row,
                                        ),
                                      }),
                                    )
                                  }
                                />
                              </>
                            ) : (
                              <>
                                <time>{item.time}</time>
                                <div>
                                  <h3>{item.title}</h3>
                                  <p>{item.detail}</p>
                                </div>
                                <span className="owner-tag">
                                  <Users size={13} />
                                  {item.owner}
                                </span>
                              </>
                            )}
                          </div>
                        ))}
                      </div>
                    </section>
                    <div className="quiet-note">
                      <CircleAlert size={16} />
                      Confirm timings, owners and venue access with your team
                      before the event.
                    </div>
                  </>
                )}
              </>
            )}
            {tab === "promotion" && (
              <>
                <div className="section-page-heading">
                  <div>
                    <p className="eyebrow">INVITATIONS WITH A HUMAN TOUCH</p>
                    <h2>Find the right words. Make them yours.</h2>
                    <p>
                      Five editable drafts and one visual, made from the same
                      brief.
                    </p>
                  </div>
                  {pack && (
                    <div className="promotion-actions">
                      <button
                        className="button primary"
                        onClick={openGrokHandoff}
                        disabled={stale || hasErrors}
                        title={
                          stale
                            ? "Regenerate the pack to match your updated brief first"
                            : undefined
                        }
                      >
                        <Sparkles size={16} />
                        Draft with Grok Bot
                      </button>
                      <button
                        className="button secondary"
                        onClick={requestGenerate}
                      >
                        <RefreshCw size={16} />
                        Regenerate
                      </button>
                    </div>
                  )}
                </div>
                {pack && (
                  <div className="grok-handoff-note">
                    <Clipboard size={15} />
                    <p>
                      Optional desktop handoff: copy your brief into Grok Bot,
                      then paste its reply here. You review and approve every
                      imported draft. Provider attribution is unverified.
                    </p>
                  </div>
                )}
                {!pack ? (
                  <EmptyState
                    title="Your next gathering deserves a good invitation."
                    description="Create a pack for your event page, social channels, newsletter and visual template."
                    onGenerate={requestGenerate}
                  />
                ) : (
                  <div className="promotion-grid">
                    <section className="card copy-workspace">
                      <div
                        className="asset-tabs"
                        aria-label="Choose a copy asset"
                      >
                        {pack.assets.map((asset) => (
                          <button
                            key={asset.id}
                            className={
                              selectedAsset?.id === asset.id ? "active" : ""
                            }
                            onClick={() => setActiveAsset(asset.id)}
                          >
                            {asset.status === "approved" && !stale ? (
                              <Check size={13} />
                            ) : (
                              <FileText size={13} />
                            )}
                            {asset.channel || asset.title}
                          </button>
                        ))}
                      </div>
                      {selectedAsset && (
                        <>
                          <div className="copy-heading">
                            <div>
                              <h3>{selectedAsset.title}</h3>
                              <p>
                                {selectedAsset.origin === "imported"
                                  ? "Imported copy · source not verified"
                                  : selectedAsset.edited
                                    ? "Edited by you"
                                    : "Generated from your brief"}{" "}
                                · {selectedAsset.body.length.toLocaleString()}{" "}
                                characters
                              </p>
                            </div>
                            <span
                              className={`tag ${selectedAsset.status === "approved" && !stale ? "approved-tag" : "draft-tag"}`}
                            >
                              {selectedAsset.status === "approved" && !stale
                                ? "Approved"
                                : "Draft"}
                            </span>
                          </div>
                          <label className="sr-only" htmlFor="asset-body">
                            {selectedAsset.title} copy
                          </label>
                          <textarea
                            id="asset-body"
                            className="copy-editor"
                            value={selectedAsset.body}
                            spellCheck
                            onChange={(event) =>
                              updatePack((current) =>
                                editAsset(
                                  current,
                                  selectedAsset.id,
                                  event.target.value,
                                ),
                              )
                            }
                          />
                          <div className="copy-footer">
                            <span>Edits reset this asset’s approval.</span>
                            <div>
                              <button
                                className="button small secondary"
                                onClick={async () => {
                                  try {
                                    await navigator.clipboard.writeText(
                                      selectedAsset.body,
                                    );
                                    setNotice(
                                      "Draft text copied. Review before publishing.",
                                    );
                                  } catch {
                                    setActionError(
                                      "Clipboard access is unavailable. Select and copy the text in the editor.",
                                    );
                                  }
                                }}
                              >
                                <Clipboard size={14} />
                                Copy
                              </button>
                              <button
                                className="button small primary"
                                disabled={
                                  stale ||
                                  hasErrors ||
                                  selectedAsset.status === "approved"
                                }
                                onClick={() =>
                                  updatePack((current) =>
                                    approveAsset(
                                      brief,
                                      current,
                                      selectedAsset.id,
                                    ),
                                  )
                                }
                              >
                                <Check size={15} />
                                {selectedAsset.status === "approved" && !stale
                                  ? "Approved"
                                  : "Approve text"}
                              </button>
                            </div>
                          </div>
                        </>
                      )}
                    </section>
                    <aside className="card poster-card">
                      <div className="section-heading">
                        <div>
                          <p className="eyebrow">THE VISUAL</p>
                          <h3>Your event, in a frame</h3>
                        </div>
                        <span
                          className={`tag ${pack.posterApproved && !stale ? "approved-tag" : "draft-tag"}`}
                        >
                          {pack.posterApproved && !stale ? "Approved" : "Draft"}
                        </span>
                      </div>
                      <div className="poster-preview">
                        <img
                          src={posterData}
                          alt={`Poster preview for ${brief.name || "your event"}`}
                        />
                      </div>
                      <p>
                        A code-based SVG template. Review event details and text
                        before sharing.
                      </p>
                      <div className="poster-actions">
                        <button
                          className="button small secondary"
                          onClick={() =>
                            attempt(() => {
                              downloadText(
                                `${slug(brief.name)}-draft-poster.svg`,
                                buildPosterSvg(brief),
                                "image/svg+xml",
                              );
                              setNotice(
                                "Draft visual downloaded. It has not been approved for sharing.",
                              );
                            })
                          }
                        >
                          <ArrowDownToLine size={14} />
                          Draft SVG
                        </button>
                        <button
                          className="button small primary"
                          disabled={stale || hasErrors || pack.posterApproved}
                          onClick={() =>
                            updatePack((current) =>
                              approvePoster(brief, current),
                            )
                          }
                        >
                          <Check size={15} />
                          {pack.posterApproved && !stale
                            ? "Approved"
                            : "Approve visual"}
                        </button>
                      </div>
                    </aside>
                  </div>
                )}
              </>
            )}
            {tab === "team" && (
              <>
                <div className="section-page-heading">
                  <div>
                    <p className="eyebrow">THE PEOPLE AND THE PRACTICALITIES</p>
                    <h2>Make a little go a long way.</h2>
                    <p>
                      A clear view of the costs, and the people sharing the
                      work.
                    </p>
                  </div>
                </div>
                <div className="team-grid">
                  <section className="card budget-card">
                    <div className="section-heading">
                      <h2>Event budget</h2>
                      <span className="soft-tag">GBP · planned costs</span>
                    </div>
                    <div className="budget-total">
                      <span>Estimated spend</span>
                      <strong>{money(budgetTotal)}</strong>
                    </div>
                    <div className="budget-items">
                      {brief.budget.map((item) => (
                        <div className="budget-row" key={item.id}>
                          <input
                            aria-label="Budget item name"
                            value={item.label}
                            onChange={(event) =>
                              updateBrief(
                                "budget",
                                brief.budget.map((row) =>
                                  row.id === item.id
                                    ? { ...row, label: event.target.value }
                                    : row,
                                ),
                              )
                            }
                          />
                          <label className="amount-field">
                            <span>£</span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              aria-label={`Cost for ${item.label}`}
                              value={item.amount}
                              onChange={(event) =>
                                updateBrief(
                                  "budget",
                                  brief.budget.map((row) =>
                                    row.id === item.id
                                      ? {
                                          ...row,
                                          amount: Math.max(
                                            0,
                                            Number(event.target.value),
                                          ),
                                        }
                                      : row,
                                  ),
                                )
                              }
                            />
                          </label>
                          <label className="checkbox-label">
                            <input
                              type="checkbox"
                              checked={item.confirmed}
                              onChange={(event) =>
                                updateBrief(
                                  "budget",
                                  brief.budget.map((row) =>
                                    row.id === item.id
                                      ? {
                                          ...row,
                                          confirmed: event.target.checked,
                                        }
                                      : row,
                                  ),
                                )
                              }
                            />
                            <span>Confirmed</span>
                          </label>
                          <button
                            className="icon-button"
                            aria-label={`Remove ${item.label} budget item`}
                            onClick={() =>
                              updateBrief(
                                "budget",
                                brief.budget.filter(
                                  (row) => row.id !== item.id,
                                ),
                              )
                            }
                          >
                            <X size={15} />
                          </button>
                        </div>
                      ))}
                    </div>
                    <button
                      className="text-button"
                      onClick={() =>
                        updateBrief("budget", [
                          ...brief.budget,
                          {
                            id: `cost-${Date.now()}`,
                            label: "New cost",
                            amount: 0,
                            confirmed: false,
                          },
                        ])
                      }
                    >
                      <Plus size={15} />
                      Add a cost
                    </button>
                    <div className="budget-foot">
                      <div>
                        <span>Potential ticket income</span>
                        <strong>{money(budget.potentialRevenue)}</strong>
                      </div>
                      <p>
                        At full capacity. This is a planning estimate, not
                        confirmed revenue.
                      </p>
                      <div className="budget-balance">
                        <span>Projected balance at full capacity</span>
                        <strong>{money(budget.projectedBalance)}</strong>
                      </div>
                      <div className="budget-balance">
                        <span>Confirmed costs</span>
                        <strong>{money(budget.confirmedCosts)}</strong>
                      </div>
                    </div>
                  </section>
                  <section className="card team-card">
                    <div className="section-heading">
                      <h2>People make it happen</h2>
                      <Users size={20} />
                    </div>
                    {pack ? (
                      <div className="rota-list">
                        {pack.rota.map((row, index) => (
                          <div key={index} className="rota-item">
                            <span className="person-avatar">
                              {String(index + 1).padStart(2, "0")}
                            </span>
                            <div>
                              <h3>{row.role}</h3>
                              <p>{row.task}</p>
                              <label>
                                <span className="sr-only">
                                  Person responsible for {row.role}
                                </span>
                                <input
                                  value={row.person}
                                  placeholder="Assign a person"
                                  onChange={(event) =>
                                    updatePack((current) =>
                                      invalidateOperations({
                                        ...current,
                                        rota: current.rota.map(
                                          (person, personIndex) =>
                                            personIndex === index
                                              ? {
                                                  ...person,
                                                  person: event.target.value,
                                                }
                                              : person,
                                        ),
                                        runSheet: current.runSheet.map(
                                          (item) =>
                                            item.owner ===
                                            `${row.role} · ${row.person}`
                                              ? {
                                                  ...item,
                                                  owner: `${row.role} · ${event.target.value || "Unassigned"}`,
                                                }
                                              : item,
                                        ),
                                      }),
                                    )
                                  }
                                />
                              </label>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="small-empty">
                        <Users size={30} />
                        <p>
                          Create your event pack to draft volunteer roles from
                          your brief.
                        </p>
                        <button
                          className="text-button"
                          onClick={requestGenerate}
                        >
                          Create event pack <ArrowRight size={14} />
                        </button>
                      </div>
                    )}
                    <div className="quiet-note">
                      <HeartHandshake size={16} />
                      Check availability with each person. Assignments here do
                      not send notifications.
                    </div>
                  </section>
                </div>
              </>
            )}
          </section>
          <footer className="workspace-footer">
            <span>
              <span className="footer-dot" />A thoughtful plan. A human final
              say.
            </span>
            <span>Local drafts · Nothing is posted automatically</span>
          </footer>
        </main>
      </div>
      <input
        ref={importRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(event) => void importBackup(event.target.files?.[0])}
      />
      {dialog && actionError && (
        <div className="toast toast-error" role="alert">
          <CircleAlert size={18} />
          <span>{actionError}</span>
          <button
            className="icon-button"
            onClick={() => setActionError(null)}
            aria-label="Dismiss error"
          >
            <X size={15} />
          </button>
        </div>
      )}
      {notice && (
        <div className="toast" role="status">
          <Check size={17} />
          <span>{notice}</span>
          <button
            className="icon-button"
            onClick={() => setNotice(null)}
            aria-label="Dismiss notification"
          >
            <X size={15} />
          </button>
        </div>
      )}
      {dialog === "brief" && (
        <Modal
          title="A good brief goes a long way."
          description="Give the pack a clear starting point. Your changes are saved locally as you go."
          wide
          onClose={() => setDialog(null)}
        >
          <div className="brief-editor">
            <div className="brief-editor-main">
              <div className="form-section">
                <h3>
                  <span>01</span>The idea & the people
                </h3>
                <div className="form-grid">
                  <Field label="Community name">
                    <input
                      value={brief.community}
                      onChange={(event) =>
                        updateBrief("community", event.target.value)
                      }
                      placeholder="Your community"
                    />
                  </Field>
                  <Field label="Event name">
                    <input
                      value={brief.name}
                      onChange={(event) =>
                        updateBrief("name", event.target.value)
                      }
                      placeholder="Give your gathering a name"
                    />
                  </Field>
                </div>
                <Field label="What is the event about?">
                  <textarea
                    rows={3}
                    value={brief.idea}
                    onChange={(event) =>
                      updateBrief("idea", event.target.value)
                    }
                    placeholder="What will people do, learn or share?"
                  />
                </Field>
                <Field label="Who is it for?">
                  <input
                    value={brief.audience}
                    onChange={(event) =>
                      updateBrief("audience", event.target.value)
                    }
                    placeholder="Describe the people you want to bring together"
                  />
                </Field>
                <Field label="Tone & personality">
                  <input
                    value={brief.tone}
                    onChange={(event) =>
                      updateBrief("tone", event.target.value)
                    }
                  />
                </Field>
                <label className="checkbox-label fictional-checkbox">
                  <input
                    type="checkbox"
                    checked={brief.sample}
                    onChange={(event) =>
                      updateBrief("sample", event.target.checked)
                    }
                  />
                  <span>This is a fictional demo community and event</span>
                </label>
              </div>
              <div className="form-section">
                <h3>
                  <span>02</span>When & where
                </h3>
                <div className="form-grid three">
                  <Field label="Date">
                    <input
                      type="date"
                      value={brief.date}
                      onChange={(event) =>
                        updateBrief("date", event.target.value)
                      }
                    />
                  </Field>
                  <Field label="Start time">
                    <input
                      type="time"
                      value={brief.startTime}
                      onChange={(event) =>
                        updateBrief("startTime", event.target.value)
                      }
                    />
                  </Field>
                  <Field label="End time">
                    <input
                      type="time"
                      value={brief.endTime}
                      onChange={(event) =>
                        updateBrief("endTime", event.target.value)
                      }
                    />
                  </Field>
                </div>
                <Field
                  label="Time zone"
                  hint="Use an IANA zone, such as Europe/London."
                >
                  <input
                    value={brief.timezone}
                    onChange={(event) =>
                      updateBrief("timezone", event.target.value)
                    }
                  />
                </Field>
                <div className="form-grid">
                  <Field label="Venue">
                    <input
                      value={brief.venue}
                      onChange={(event) =>
                        updateBrief("venue", event.target.value)
                      }
                      placeholder="Venue name, or To be confirmed"
                    />
                  </Field>
                  <Field label="Address">
                    <input
                      value={brief.address}
                      onChange={(event) =>
                        updateBrief("address", event.target.value)
                      }
                      placeholder="Street, city and postcode"
                    />
                  </Field>
                </div>
                <Field label="Accessibility & access notes">
                  <textarea
                    rows={2}
                    value={brief.accessibility}
                    onChange={(event) =>
                      updateBrief("accessibility", event.target.value)
                    }
                    placeholder="Only state access details you have confirmed"
                  />
                </Field>
              </div>
              <div className="form-section">
                <h3>
                  <span>03</span>Joining & helping out
                </h3>
                <Field label="Registration URL">
                  <input
                    type="url"
                    value={brief.registrationUrl}
                    onChange={(event) =>
                      updateBrief("registrationUrl", event.target.value)
                    }
                    placeholder="https://…"
                  />
                </Field>
                <div className="form-grid">
                  <Field label="Capacity">
                    <input
                      type="number"
                      min="1"
                      value={brief.capacity}
                      onChange={(event) =>
                        updateBrief("capacity", Number(event.target.value))
                      }
                    />
                  </Field>
                  <Field label="Ticket price (£)">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={brief.ticketPrice}
                      onChange={(event) =>
                        updateBrief("ticketPrice", Number(event.target.value))
                      }
                    />
                  </Field>
                </div>
                <Field label="Contact details">
                  <input
                    value={brief.contact}
                    onChange={(event) =>
                      updateBrief("contact", event.target.value)
                    }
                    placeholder="An organiser email or contact route"
                  />
                </Field>
                <Field
                  label="Volunteers"
                  hint="List available people and any roles they can help with."
                >
                  <textarea
                    rows={2}
                    value={brief.volunteers}
                    onChange={(event) =>
                      updateBrief("volunteers", event.target.value)
                    }
                  />
                </Field>
                <Field label="Additional organiser notes">
                  <textarea
                    rows={3}
                    value={brief.notes}
                    onChange={(event) =>
                      updateBrief("notes", event.target.value)
                    }
                  />
                </Field>
                <Field label="Poster accent colour">
                  <div className="colour-control">
                    <input
                      type="color"
                      value={
                        /^#[0-9a-f]{6}$/i.test(brief.accent)
                          ? brief.accent
                          : "#e67c47"
                      }
                      onChange={(event) =>
                        updateBrief("accent", event.target.value)
                      }
                    />
                    <span>{brief.accent}</span>
                  </div>
                </Field>
              </div>
            </div>
            <aside className="brief-editor-aside">
              <div className="brief-checks">
                <ShieldCheck size={23} />
                <h3>The detail check</h3>
                <p>Good inputs make useful drafts.</p>
                {issues.length ? (
                  <ul>
                    {issues.map((issue) => (
                      <li
                        key={issue.id}
                        className={issue.level === "error" ? "error-text" : ""}
                      >
                        <CircleAlert size={14} />
                        {issue.message}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="all-clear">
                    <Check size={17} />
                    All required details are present.
                  </div>
                )}
                <p className="small-text">
                  Missing details stay visible. The template engine won’t invent
                  a venue, registration link or confirmed accessibility.
                </p>
              </div>
            </aside>
          </div>
          <div className="modal-footer">
            <span>
              {stale
                ? "Current drafts are preserved until you regenerate."
                : "Budget items are editable in Budget & team."}
            </span>
            <button
              className="button secondary"
              onClick={() => setDialog(null)}
            >
              Save & close
            </button>
            <button
              className="button primary"
              disabled={hasErrors}
              onClick={requestGenerate}
            >
              {pack ? <RefreshCw size={16} /> : <WandSparkles size={16} />}
              {pack ? "Regenerate pack" : "Create event pack"}
            </button>
          </div>
        </Modal>
      )}
      {dialog === "export" && (
        <Modal
          title="A human final say."
          description="Read your drafts, confirm the details and approve the complete pack before sharing."
          onClose={() => setDialog(null)}
        >
          <div className="export-body">
            <div className="approval-summary">
              <div className="approval-ring">
                {approvedCount}
                <small>/6</small>
              </div>
              <div>
                <h3>
                  {approved
                    ? "Ready to leave the workspace."
                    : "Your review makes it ready."}
                </h3>
                <p>
                  {stale
                    ? "Your brief changed. Regenerate the pack before approving."
                    : !pack
                      ? "Create an event pack to begin the review."
                      : `${6 - approvedCount} ${6 - approvedCount === 1 ? "asset needs" : "assets need"} your approval.`}
                </p>
              </div>
            </div>
            {pack && (
              <>
                <div className="approval-list">
                  {pack.assets.map((asset) => (
                    <button
                      key={asset.id}
                      onClick={() => {
                        setActiveAsset(asset.id);
                        setTab("promotion");
                        setDialog(null);
                      }}
                    >
                      <span
                        className={`approval-check ${asset.status === "approved" && !stale ? "checked" : ""}`}
                      >
                        {asset.status === "approved" && !stale ? (
                          <Check size={13} />
                        ) : null}
                      </span>
                      <span>{asset.title}</span>
                      <span className="muted">
                        Review <ChevronRight size={13} />
                      </span>
                    </button>
                  ))}
                  <button
                    onClick={() => {
                      setTab("promotion");
                      setDialog(null);
                    }}
                  >
                    <span
                      className={`approval-check ${pack.posterApproved && !stale ? "checked" : ""}`}
                    >
                      {pack.posterApproved && !stale && <Check size={13} />}
                    </span>
                    <span>Event poster</span>
                    <span className="muted">
                      Review <ChevronRight size={13} />
                    </span>
                  </button>
                </div>
                {issues.length > 0 && (
                  <div className="export-warnings">
                    <CircleAlert size={17} />
                    <span>
                      {issues.length} detail{" "}
                      {issues.length === 1 ? "check remains" : "checks remain"}.{" "}
                      {hasErrors
                        ? "Resolve required details in the brief first."
                        : "Confirm the pending details before sharing."}
                    </span>
                  </div>
                )}
                <button
                  className="button primary approve-all"
                  disabled={stale || hasErrors || approved}
                  onClick={() =>
                    updatePack((current) => approveAll(brief, current))
                  }
                >
                  <CheckCheck size={17} />
                  {approved
                    ? "All assets approved"
                    : "I’ve reviewed the pack — approve all"}
                </button>
              </>
            )}
            <div className="download-section">
              <p className="eyebrow">TAKE IT FROM HERE</p>
              <div className="download-grid">
                {[
                  {
                    format: "md" as const,
                    label: "Markdown",
                    detail: "Editable event pack",
                  },
                  {
                    format: "html" as const,
                    label: "HTML",
                    detail: "Print or save as PDF",
                  },
                  {
                    format: "ics" as const,
                    label: "Calendar",
                    detail: "An .ics event file",
                  },
                  {
                    format: "svg" as const,
                    label: "SVG poster",
                    detail: "Scalable visual",
                  },
                  {
                    format: "png" as const,
                    label: "PNG poster",
                    detail: pngBusy ? "Preparing image…" : "Ready for sharing",
                  },
                ].map((item) => (
                  <button
                    key={item.format}
                    disabled={!approved || (item.format === "png" && pngBusy)}
                    onClick={() => void exportPack(item.format)}
                  >
                    <ArrowDownToLine size={18} />
                    <strong>{item.label}</strong>
                    <small>{item.detail}</small>
                  </button>
                ))}
                <button onClick={backup}>
                  <FolderOpen size={18} />
                  <strong>JSON backup</strong>
                  <small>Full workspace + drafts</small>
                </button>
              </div>
              <p className="small-text">
                Downloads happen on your device. No publishing, emails or
                calendar invitations are sent.
              </p>
            </div>
          </div>
          <div className="modal-footer">
            <button
              className="text-button"
              onClick={() => {
                setDialog(null);
                setTab("promotion");
              }}
            >
              <ArrowLeft size={14} />
              Back to drafts
            </button>
            <button
              className="button secondary"
              onClick={() => setDialog(null)}
            >
              Done
            </button>
          </div>
        </Modal>
      )}
      {dialog === "grok" && (
        <Modal
          title="Draft with Grok Bot. Keep your final say."
          description="A manual handoff between this workspace and your signed-in desktop app. GatherKit does not connect to or verify the app."
          wide
          onClose={() => setDialog(null)}
        >
          <div className="grok-handoff-body">
            <div className="grok-handoff-intro">
              <span className="soft-tag">Manual desktop workflow</span>
              <span>
                {brief.community} · {brief.name}
              </span>
              {brief.sample && (
                <span className="tag sample-tag">Fictional demo</span>
              )}
            </div>
            <div className="grok-handoff-steps">
              <section className="grok-handoff-step">
                <span className="grok-step-number">01</span>
                <div>
                  <h3>Copy your event brief prompt</h3>
                  <p>
                    The prompt includes the event details, tone and required
                    reply format. Check the information before sharing it with
                    the desktop app.
                  </p>
                  <div className="grok-step-actions">
                    <button
                      className="button secondary"
                      onClick={() => void copyGrokPrompt()}
                    >
                      <Clipboard size={15} />
                      Copy prompt
                    </button>
                    <button
                      className="text-button"
                      onClick={() =>
                        attempt(() => {
                          downloadText(
                            `${slug(brief.name)}-grok-prompt.txt`,
                            grokPrompt,
                            "text/plain",
                          );
                          setNotice("Drafting prompt downloaded.");
                        })
                      }
                    >
                      <ArrowDownToLine size={14} />
                      Download prompt
                    </button>
                  </div>
                  <details className="grok-prompt-details">
                    <summary>
                      Read or manually copy the prompt <ChevronDown size={14} />
                    </summary>
                    <label className="sr-only" htmlFor="grok-prompt">
                      Event brief prompt for Grok Bot
                    </label>
                    <textarea
                      id="grok-prompt"
                      readOnly
                      value={grokPrompt}
                      rows={8}
                      spellCheck={false}
                      onFocus={(event) => event.currentTarget.select()}
                    />
                  </details>
                </div>
              </section>
              <section className="grok-handoff-step">
                <span className="grok-step-number">02</span>
                <div>
                  <h3>Use your signed-in Grok Bot desktop app</h3>
                  <p>
                    Paste the prompt into a new conversation. Ask for the
                    structured JSON reply, then copy the complete reply back
                    here. You control what is sent to the app.
                  </p>
                  <div className="grok-boundary-note">
                    No sign-in details or API keys are needed in GatherKit. A
                    pasted reply does not prove which provider generated it.
                  </div>
                </div>
              </section>
              <section className="grok-handoff-step grok-reply-step">
                <span className="grok-step-number">03</span>
                <div>
                  <h3>Paste the reply. Review before replacing.</h3>
                  <p>
                    Paste the complete JSON object, including all five copy
                    assets. Your existing drafts stay in place until you choose
                    “Use these drafts”.
                  </p>
                  <label className="sr-only" htmlFor="grok-reply">
                    Structured JSON reply from Grok Bot
                  </label>
                  <textarea
                    id="grok-reply"
                    className="grok-reply-editor"
                    value={grokReplyText}
                    placeholder="Paste the complete JSON reply here…"
                    spellCheck={false}
                    rows={7}
                    onChange={(event) => {
                      setGrokReplyText(event.target.value);
                      setGrokPreview(null);
                      setGrokError(null);
                    }}
                  />
                  <div className="grok-reply-actions">
                    <span>
                      {grokReplyText.length.toLocaleString()} characters pasted
                    </span>
                    <button
                      className="button secondary"
                      disabled={!grokReplyText.trim()}
                      onClick={previewGrokReply}
                    >
                      <FileText size={15} />
                      Preview reply
                    </button>
                  </div>
                  {grokError && (
                    <div
                      className="alert alert-error grok-inline-error"
                      role="alert"
                    >
                      <CircleAlert size={18} />
                      <p>{grokError}</p>
                    </div>
                  )}
                  {grokPreview && (
                    <div
                      ref={grokPreviewRef}
                      className="grok-preview"
                      aria-live="polite"
                    >
                      <div className="grok-preview-heading">
                        <div>
                          <CheckCheck size={18} />
                          <strong>
                            {grokPreview.assets.length} copy drafts ready to
                            review
                          </strong>
                        </div>
                        <span>Matches the current event brief</span>
                      </div>
                      <div className="grok-preview-list">
                        {grokPreview.assets.map((asset) => (
                          <details key={asset.id}>
                            <summary>
                              <span>
                                {pack?.assets.find(
                                  (current) => current.id === asset.id,
                                )?.title || asset.id}
                              </span>
                              <small>
                                {asset.body.length.toLocaleString()} characters
                              </small>
                              <ChevronDown size={14} />
                            </summary>
                            <pre>{asset.body}</pre>
                          </details>
                        ))}
                      </div>
                      <p className="grok-attribution-note">
                        {GROK_IMPORT_NOTICE} Check all details and claims before
                        approving.
                      </p>
                    </div>
                  )}
                  {brief.sample && (
                    <div className="fictional-note">
                      This is a fictional community and event. Imported drafts
                      must retain the fictional-demo warning and must not imply
                      a live booking or invitation.
                    </div>
                  )}
                </div>
              </section>
            </div>
          </div>
          <div className="modal-footer grok-modal-footer">
            <p>
              Using these drafts replaces all five copy assets and clears their
              approvals. Your poster, run sheet and volunteer rota are
              preserved.
            </p>
            <button
              className="button secondary"
              onClick={() => setDialog(null)}
            >
              Keep current drafts
            </button>
            <button
              className="button primary"
              disabled={!grokPreview || stale || hasErrors}
              onClick={useGrokDrafts}
            >
              <ArrowRight size={16} />
              Use these drafts
            </button>
          </div>
        </Modal>
      )}
      {dialog === "regenerate" && (
        <Modal
          title="Refresh the whole pack?"
          description="This replaces the existing copy and operational plan using your current brief, and resets all approvals. Your edited drafts will be replaced."
          onClose={() => setDialog(null)}
        >
          <div className="confirm-body">
            <div className="alert">
              <FolderOpen size={20} />
              <p>
                Keep a copy of your current work first if you might need it
                again.
              </p>
            </div>
            <button className="text-button" onClick={backup}>
              Download current workspace backup <ArrowDownToLine size={15} />
            </button>
          </div>
          <div className="modal-footer">
            <button
              className="button secondary"
              onClick={() => setDialog(null)}
            >
              Keep current drafts
            </button>
            <button
              className="button primary"
              disabled={hasErrors}
              onClick={generate}
            >
              <RefreshCw size={16} />
              Replace & regenerate
            </button>
          </div>
        </Modal>
      )}
      {dialog === "new" && (
        <Modal
          title="Start with a fresh page."
          description="This replaces the event in this local workspace. Download a backup first to keep your current brief and drafts."
          onClose={() => setDialog(null)}
        >
          <div className="confirm-body">
            <button className="button secondary" onClick={backup}>
              <ArrowDownToLine size={16} />
              Back up current event
            </button>
            <div className="new-options">
              <button onClick={() => reset(false)}>
                <Plus size={24} />
                <strong>New blank brief</strong>
                <span>Your community, your next idea.</span>
                <ArrowRight size={17} />
              </button>
              <button onClick={() => reset(true)}>
                <Sparkles size={24} />
                <strong>Load the fictional demo</strong>
                <span>Explore a London community example.</span>
                <ArrowRight size={17} />
              </button>
            </div>
          </div>
          <div className="modal-footer">
            <button
              className="button secondary"
              onClick={() => setDialog(null)}
            >
              Keep current event
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function EmptyState({
  title,
  description,
  onGenerate,
}: {
  title: string;
  description: string;
  onGenerate: () => void;
}) {
  return (
    <div className="empty-state card">
      <IconBadge>
        <WandSparkles size={27} />
      </IconBadge>
      <h2>{title}</h2>
      <p>{description}</p>
      <button className="button primary" onClick={onGenerate}>
        Create event pack <ArrowRight size={16} />
      </button>
      <small>Local templates · Editable drafts · Your approval</small>
    </div>
  );
}
