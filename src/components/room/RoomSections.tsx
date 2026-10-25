"use client";

import { canAnswerOption, hasDisclosure, ownDisclosureValue, ownBriefFieldValue, missingOptionDetail, type DisclosureOption } from "./requestConsent";

import { waitingText, passRequestText, countCodePoints, TEXT_LIMITS } from "@core/engine/ui";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ITEM_KEY_RE,
  isValidCatalogTitle,
  parseCents,
  centsToInputString,
  cents,
  parseIsoDate,
} from "@core/engine/ui";
import {
  AgentBox,
  ApprovalButton,
  ApprovalPanel,
  BudgetPanel,
  CatalogTitleText,
  ChangeOrderDisclaimer,
  ChecksList,
  DeliveryDate,
  HumanBox,
  SimulatedBadge,
  StaleBanner,
  VersionBadge,
  type RecordDecisionInput,
} from "@/components/prototype/markers";
import { useDraftProtection } from "./useDraftProtection";
import { parseUiError } from "@/lib/errors";
import { formatCents, formatRole, formatSharedValue, formatFieldLabel, formatItemKeys, formatCatalogReferences, formatDisclosureConsent } from "@/lib/format";
import type {
  MyBriefView,
  ExecutionView,
  PreviewChangeView,
  ProposalDetailView,
  Role,
  RoomView,
  TimelineEntry,
} from "@/lib/viewModels/types";

export function ConfirmConstraintChangeDialog({
  preview,
  currentConstraintsVersion,
  onConfirm,
  onCancel,
}: {
  preview: PreviewChangeView;
  currentConstraintsVersion: number;
  onConfirm: () => Promise<void> | void;
  onCancel: () => void;
}) {
  const [openedCv] = useState(currentConstraintsVersion);
  const stale = openedCv !== currentConstraintsVersion;
  const [submitting, setSubmitting] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current;
    if (element && typeof element.showModal === "function") element.showModal();
    else element?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => { element?.close?.(); if (previous instanceof HTMLElement) previous.focus(); };
  }, []);


  if (preview === null) return null;

  return (
    <dialog
      ref={dialog}
      onCancel={(event) => { event.preventDefault(); onCancel(); }}
      className="panel muted stack"
      aria-labelledby="confirm-constraint-change-title"
      aria-modal="true"
      data-testid="confirm-constraint-change-dialog"
    >
      <h3 id="confirm-constraint-change-title" style={{ margin: 0 }}>
        Confirm constraint update (v{currentConstraintsVersion} → v
        {"nextConstraintsVersion" in preview ? preview.nextConstraintsVersion : currentConstraintsVersion}
        )
      </h3>
      {"invalidatedApprovals" in preview && preview.invalidatedApprovals > 0 ? (
        <p style={{ margin: 0 }} data-testid="preview-invalidated-approvals">
          Approvals from{" "}
          {preview.invalidatedApprovals} people will be
          marked &ldquo;No longer applies&rdquo; and must be re-confirmed.
        </p>
      ) : (
        <p className="subtle" style={{ margin: 0 }}>
          No existing approvals will be invalidated.
        </p>
      )}

      {preview.verdict === "after" ? (
        <p style={{ margin: 0 }} data-testid="preview-cap-verdict">
          Proposal v{preview.verdictAfter.proposalVersion} after change:{" "}
          {preview.verdictAfter.budgetCheck === "pass"
            ? "Within cap"
            : `Over budget by ${formatCents(preview.verdictAfter.overByCents ?? 0)}`}
        </p>
      ) : null}

      {preview.verdict === "recheck" ? (
        <p style={{ margin: 0 }} data-testid="preview-recheck-note">
          {preview.willSupersedeRun
            ? "Active agent run will restart under the new constraints."
            : "Current proposal will be re-checked under the new constraints."}
        </p>
      ) : null}

      {stale ? <p id="constraint-change-stale" role="alert">Constraints changed to v{currentConstraintsVersion} while you were reviewing</p> : null}
      <div className="row">
        <button
          type="button"
          className="btn primary"
          data-testid="confirm-constraint-change-btn"
          aria-disabled={submitting || stale}
          aria-describedby={stale ? "constraint-change-stale" : undefined}
          onClick={async () => {
            if (stale || submitting) return;
            setSubmitting(true);
            try {
              await onConfirm();
            } finally {
              setSubmitting(false);
            }
          }}
        >
          {submitting ? "Applying…" : "Confirm & bump constraints"}
        </button>
        <button
          type="button"
          className="btn"
          data-testid="cancel-constraint-change-btn"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </dialog>
  );
}

export function BriefScreen({
  view,
  brief = null,
  catalog = null,
  previewChange = null,
  onConfirmBrief,
  onSetCap,
  onSaveNotes,
  onRecordBaseline,
  onAddSharedFact,
  onConfirmCatalog,
  onRetireCatalogItem,
}: {
  view: RoomView;
  brief?: MyBriefView | null;
  catalog?: import("convex/server").FunctionReturnType<typeof import("@/lib/api").api.catalog.list>;
  previewChange?: PreviewChangeView;
  onConfirmBrief?: (input: {
    hardFields: import("convex/server").FunctionArgs<typeof import("@/lib/api").api.briefs.confirm>["hardFields"];
    softFields: import("convex/server").FunctionArgs<typeof import("@/lib/api").api.briefs.confirm>["softFields"];
    disclosures: Record<string, Role[]>;
  }) => Promise<void | false> | void | false;
  onSaveNotes?: (notes: string) => Promise<void> | void;
  onSetCap?: (capCents: number) => Promise<void | false> | void | false;
  onRecordBaseline?: (amountCents: number) => Promise<void> | void;
  onAddSharedFact?: (input: {
    field:
      | "deadline"
      | "requiredItemKeys"
      | "preferredItemKeys"
      | "capCents"
      | "committedCents"
      | "headroomCents";
    audience: Role[];
    confirmOwnDisclosure: boolean;
  }) => Promise<void> | void;
  onConfirmCatalog?: (rows: {
    itemKey: string;
    kind: "item" | "modifier";
    priceCents: number;
    leadDays: number;
    title: string;
    taskTemplates: { title: string; assigneeRole: Role }[];
  }[]) => Promise<void | false> | void | false;
  onRetireCatalogItem?: (itemKey: string) => Promise<void | false> | void | false;
}) {
  const role = view.header.viewingAs;
  const [deadlineInput, setDeadlineInput] = useState(brief?.latest?.hardFields.schemaKey === "scope_change.customer.v1" ? brief.latest.hardFields.deadline : "");
  const [requiredKeysInput, setRequiredKeysInput] = useState(brief?.latest?.hardFields.schemaKey === "scope_change.customer.v1" ? brief.latest.hardFields.requiredItemKeys.join(", ") : "");
  const [capInput, setCapInput] = useState(brief?.latest?.hardFields.schemaKey === "scope_change.finance.v1" ? centsToInputString(cents(brief.latest.hardFields.capCents)) : "");
  const [baselineInput, setBaselineInput] = useState(brief?.finance?.baselineSuggestionCents != null ? centsToInputString(cents(brief.finance.baselineSuggestionCents)) : "");
  const [softNotes, setSoftNotes] = useState(brief?.latest?.softFields.notes ?? "");
  const [confirmOwnDisclosure, setConfirmOwnDisclosure] = useState(false);
  const [preferredKeys, setPreferredKeys] = useState<string[]>(brief?.latest?.softFields.schemaKey === "scope_change.customer.v1" ? brief.latest.softFields.preferredItemKeys : []);
  type ShareField = "deadline" | "requiredItemKeys" | "preferredItemKeys" | "capCents" | "committedCents" | "headroomCents";
  const [shareField,setShareField] = useState<ShareField>(role === "finance" ? "capCents" : "deadline");
  const [shareAudience,setShareAudience] = useState<Role[]>(role === "finance" ? ["customer"] : ["provider","finance"]);
  const [dirtyGroups,setDirtyGroups] = useState<string[]>([]);
  const [pending,setPending] = useState(false);
  const pendingRef = useRef(false);
  const terminal = view.header.status === "executed" || view.header.status === "closed";
  useDraftProtection(dirtyGroups.length > 0);
  const selectableItems = (catalog?.items ?? []).filter(item => item.status === "confirmed" && item.kind === "item" && !view.followUpOf?.deliveredItems.some(delivered=>delivered.itemKey === item.itemKey));
  const requiredKeys = requiredKeysInput.split(",").map(key=>key.trim()).filter(Boolean);
  const notesTooLong = countCodePoints(softNotes.normalize("NFC")) > TEXT_LIMITS.briefNote;


  // Provider catalog draft form
  const draft = catalog?.mine?.drafts[0];
  const [catKey, setCatKey] = useState(draft?.itemKey ?? "");
  const [catTitle, setCatTitle] = useState(draft?.title ?? "");
  const [catPrice, setCatPrice] = useState(draft ? centsToInputString(cents(draft.priceCents)) : "");
  const [catLeadDays, setCatLeadDays] = useState(draft ? String(draft.leadDays) : "");
  const [catKind, setCatKind] = useState<"item" | "modifier">(draft?.kind ?? "item");
  const [catTasks,setCatTasks] = useState<{title:string;assigneeRole:Role}[]>(draft?.taskTemplates ?? []);

  const [showPreviewDialog, setShowPreviewDialog] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);

  async function runBriefMutation(fn: () => Promise<void | false> | void | false, group = "brief", alsoSaved: readonly string[] = []) {
    if(pendingRef.current || terminal) return;
    const savedGroups = new Set([group, ...alsoSaved]);
    if (dirtyGroups.some(item => !savedGroups.has(item)) && !window.confirm("Saving this section refreshes your brief. Unconfirmed changes in other sections may be discarded. Continue?")) return;
    if(notesTooLong && (savedGroups.has("brief") || savedGroups.has("notes"))) { setErrorText(`Private notes must be at most ${TEXT_LIMITS.briefNote} characters.`); return; }
    pendingRef.current = true; setPending(true);
    setErrorText(null);
    setStatusNote(null);
    try {
      const result = await fn();
      if (result === false) return;
      setStatusNote("Saved.");
      setDirtyGroups(groups=>groups.filter(item=>!savedGroups.has(item)));
      setShowPreviewDialog(false);
    } catch (err) {
      setErrorText(parseUiError(err).message);
    } finally { pendingRef.current = false; setPending(false); }
  }

  return (
    <section className="stack" data-testid="brief-page" onChangeCapture={event=>{const group=(event.target as HTMLElement).closest("[data-draft-scope]")?.getAttribute("data-draft-scope") ?? "brief";setDirtyGroups(groups=>groups.includes(group) ? groups : [...groups,group]);}}>
      <div>
        <h1>My brief</h1>
        <VersionBadge header={view.header} />
      </div>

      {view.followUpOf && view.followUpOf.deliveredItems.length > 0 ? (
        <div
          className="panel muted stack"
          data-testid="delivered-items-list"
        >
          <h2 style={{ margin: 0, fontSize: "1.05rem" }}>
            Delivered in previous change orders
          </h2>
          <ul>
            {view.followUpOf.deliveredItems.map((item) => (
              <li key={item.itemKey}>
                {item.title} — Delivered in CO-{view.followUpOf?.changeOrderNumber}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p>{brief?.latest ? `Confirmed brief v${brief.latest.version}` : "Confirm your initial brief to complete setup."}</p>
      <BudgetPanel budget={view.budget} />

      <h2>What others can see from you</h2>
      {(brief?.othersSee ?? []).length === 0 ? (
        <p>Nothing you have shared.</p>
      ) : null}
      {(brief?.othersSee ?? []).map((mirror) => (
        <div key={mirror.role}>
          <h3>{mirror.role}</h3>
          <ul>
            {mirror.fields.map((field) => (
              <li key={field.field}>
                {formatFieldLabel(field.field)}: {formatSharedValue(field.value, view.catalog)}
              </li>
            ))}
          </ul>
        </div>
      ))}

      {errorText ? (
        <div className="stale-banner" role="alert" data-testid="brief-error">
          {errorText}
        </div>
      ) : null}
      {statusNote ? (
        <p className="subtle" data-testid="brief-status-note">
          {statusNote}
        </p>
      ) : null}

      <fieldset className="brief-fields stack" disabled={pending || terminal}>
      <legend className="sr-only">Your private brief and confirmed terms</legend>
      {terminal ? <p className="banner">This room is {view.header.status}. Its terms are read-only.</p> : null}
      {role === "customer" ? (
        <form
          className="panel stack"
          data-testid="customer-brief-form"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            const parsedDate = parseIsoDate(deadlineInput.trim());
            if (!parsedDate.ok) {
              setErrorText("Enter a valid YYYY-MM-DD calendar date.");
              return;
            }
            const itemKeys = requiredKeysInput
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
            for (const key of itemKeys) {
              if (!ITEM_KEY_RE.test(key)) {
                setErrorText("Unknown catalog item key.");
                return;
              }
            }
            if (previewChange && view.header.constraintsVersion >= 1) {
              setShowPreviewDialog(true);
              return;
            }
            void runBriefMutation(() =>
              onConfirmBrief?.({
                hardFields: {
                  schemaKey: "scope_change.customer.v1",
                  requiredItemKeys: itemKeys,
                  deadline: parsedDate.value,
                },
                softFields: { schemaKey: "scope_change.customer.v1", preferredItemKeys: preferredKeys, notes: softNotes.trim() },
                disclosures: brief?.latest?.disclosures ?? {},
              }),
            );
          }}
        >
          <h2 style={{ margin: 0, fontSize: "1.1rem" }}>
            Customer constraints & disclosures
          </h2>
          {selectableItems.length > 0 ? <fieldset className="item-picker"><legend>Required scope</legend><p className="subtle">Choose confirmed supplier items that must be included.</p>{selectableItems.map(item=><label key={item.itemKey} className="item-choice" aria-label={`Require ${item.title}`}><input type="checkbox" checked={requiredKeys.includes(item.itemKey)} onChange={event=>setRequiredKeysInput((event.target.checked ? [...requiredKeys,item.itemKey] : requiredKeys.filter(key=>key!==item.itemKey)).join(", "))}/><span><strong>{item.title}</strong><small>{formatCents(item.priceCents)} · {item.leadDays} days</small></span></label>)}</fieldset> : <p className="subtle">Your provider has not published any confirmed items yet. Ask them to confirm the catalog.</p>}
          <div className="stack">
            <label htmlFor="customer-required-items">
              Required item keys (comma-separated)
            </label>
            <input
              id="customer-required-items"
              type="text"
              value={requiredKeysInput}
              onChange={(e) => setRequiredKeysInput(e.target.value)}
              data-testid="customer-required-items-input"
            />
          </div>
          <div className="stack">
            <label htmlFor="customer-deadline">
              Target delivery deadline (YYYY-MM-DD)
            </label>
            <input
              id="customer-deadline"
              type="date"
              value={deadlineInput}
              onChange={(e) => setDeadlineInput(e.target.value)}
              data-testid="customer-deadline-input"
            />
          </div>
          {selectableItems.length > 0 ? <fieldset className="item-picker"><legend>Wishlist — preferred, not required</legend>{selectableItems.map(item=><label className="row" key={item.itemKey}><input type="checkbox" checked={preferredKeys.includes(item.itemKey)} onChange={event=>setPreferredKeys(event.target.checked ? [...preferredKeys,item.itemKey] : preferredKeys.filter(key=>key!==item.itemKey))}/>{item.title}</label>)}</fieldset> : null}
          <div className="stack">
            <label htmlFor="customer-soft-notes">Soft priority notes</label>
            <textarea
              id="customer-soft-notes"
              rows={2}
              value={softNotes}
              onChange={(e) => setSoftNotes(e.target.value)}
              data-testid="customer-soft-notes-input"
            />
          </div>
          <div className="row">
            <button
              type="submit"
              className="btn primary"
              data-testid="confirm-customer-brief-btn"
            >
              Confirm brief
            </button>
          </div>
        </form>
      ) : null}

      <p className="subtle">{countCodePoints(softNotes.normalize("NFC"))}/{TEXT_LIMITS.briefNote} private-note characters. Only you and your agent see these notes.</p>
      {role !== "customer" ? <div className="stack" data-draft-scope="notes"><label className="stack">Private notes<textarea data-testid="role-soft-notes" value={softNotes} onChange={(event) => setSoftNotes(event.target.value)} /></label>{brief?.latest && onSaveNotes ? <button type="button" className="btn" disabled={notesTooLong} onClick={()=>void runBriefMutation(()=>onSaveNotes(softNotes),"notes")}>Save private notes</button> : null}</div> : null}
      {role === "finance" ? (
        <div className="panel stack" data-testid="finance-brief-controls">
          <h2 style={{ margin: 0, fontSize: "1.1rem" }}>
            Finance budget cap & baseline ledger
          </h2>
          {brief?.finance &&
          !brief.finance.baselineRecorded ? (
            <div className="panel muted stack" data-testid="baseline-form">
              <label htmlFor="finance-baseline-input">
                Initial committed baseline (USD)
              </label>
              <div className="row">
                <input
                  id="finance-baseline-input"
                  type="text"
                  value={baselineInput}
                  onChange={(e) => setBaselineInput(e.target.value)}
                  data-testid="finance-baseline-input"
                />
                <button
                  type="button"
                  className="btn"
                  data-testid="record-baseline-btn"
                  onClick={() => {
                    const parsed = parseCents(baselineInput);
                    if (!parsed.ok) {
                      setErrorText("Enter a valid non-negative USD amount.");
                      return;
                    }
                    void runBriefMutation(() =>
                      onRecordBaseline?.(parsed.value),
                    );
                  }}
                >
                  Record baseline
                </button>
              </div>
            </div>
          ) : null}

          <div className="stack">
            <label htmlFor="finance-cap-input">Budget cap (USD)</label>
            <div className="row">
              <input
                id="finance-cap-input"
                type="text"
                value={capInput}
                onChange={(e) => setCapInput(e.target.value)}
                data-testid="finance-cap-input"
              />
              <button
                type="button"
                className="btn primary"
                data-testid="confirm-cap-btn"
                onClick={() => {
                  const parsed = parseCents(capInput);
                  if (!parsed.ok) {
                    setErrorText("Enter a valid non-negative USD amount.");
                    return;
                  }
                  if (previewChange && view.header.constraintsVersion >= 1) {
                    setShowPreviewDialog(true);
                    return;
                  }
                  void runBriefMutation(() => brief?.latest ? onSetCap?.(parsed.value) : onConfirmBrief?.({ hardFields: { schemaKey: "scope_change.finance.v1", capCents: parsed.value }, softFields: { schemaKey: "scope_change.finance.v1", notes: softNotes }, disclosures: {} }), "brief", brief?.latest ? [] : ["notes"]);
                }}
              >
                {brief?.latest ? "Update budget cap" : "Confirm finance brief"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {role === "provider" ? (
        <div className="panel stack" data-testid="catalog-editor" data-draft-scope="catalog">
          <h2 style={{ margin: 0, fontSize: "1.1rem" }}>
            Provider catalog & lead times
          </h2>
          {(catalog?.items.length ?? 0) > 0 ? (
            <ul data-testid="brief-catalog-list">
              {catalog?.items.map((entry) => (
                <li key={entry.itemKey} className="row-between">
                  <span>
                    <CatalogTitleText
                      title={entry.title}
                      revision={entry.revision}
                    />{" "}
                    · <code>{entry.itemKey}</code> ({entry.kind}) ·{" "}
                    {formatCents(entry.priceCents)} · {entry.leadDays}d ·{" "}
                    {entry.status}
                  </span>
                  <button type="button" className="btn" data-testid={`edit-catalog-${entry.itemKey}`} onClick={() => { setCatKey(entry.itemKey); setCatTitle(entry.title); setCatPrice(centsToInputString(cents(entry.priceCents))); setCatLeadDays(String(entry.leadDays)); setCatKind(entry.kind); setCatTasks(entry.taskTemplates.map(task=>({...task}))); }}>Edit</button>
                  {entry.status === "confirmed" ? (
                    <button
                      type="button"
                      className="btn"
                      data-testid={`retire-catalog-${entry.itemKey}`}
                      onClick={() => {
                        void runBriefMutation(() =>
                          onRetireCatalogItem?.(entry.itemKey),
                        );
                      }}
                    >
                      Retire
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}

          <button type="button" className="btn primary" data-testid="confirm-provider-brief-btn" onClick={() => void runBriefMutation(() => onConfirmBrief?.({ hardFields: { schemaKey: "scope_change.provider.v1" }, softFields: { schemaKey: "scope_change.provider.v1", notes: softNotes }, disclosures: brief?.latest?.disclosures ?? {} }), "brief", ["notes"])}>Confirm provider brief</button>
          <div className="panel muted stack">
            <h3 style={{ margin: 0, fontSize: "1rem" }}>
              Confirm catalog item
            </h3>
            <div className="row">
              <label className="stack" style={{ flex: 1 }}>
                <span>Item key</span>
                <input
                  type="text"
                  value={catKey}
                  onChange={(e) => setCatKey(e.target.value)}
                  data-testid="catalog-key-input"
                />
              </label>
              <label className="stack" style={{ flex: 2 }}>
                <span>Plain-text title (≤ 80 chars)</span>
                <input
                  type="text"
                  value={catTitle}
                  onChange={(e) => setCatTitle(e.target.value)}
                  data-testid="catalog-title-input"
                />
              </label>
              <label className="stack" style={{ flex: 1 }}>
                <span>Kind</span>
                <select
                  value={catKind}
                  onChange={(e) =>
                    setCatKind(e.target.value as "item" | "modifier")
                  }
                  data-testid="catalog-kind-select"
                >
                  <option value="item">Item</option>
                  <option value="modifier">Modifier</option>
                </select>
              </label>
            </div>
            <div className="row">
              <label className="stack" style={{ flex: 1 }}>
                <span>Price (USD)</span>
                <input
                  type="text"
                  value={catPrice}
                  onChange={(e) => setCatPrice(e.target.value)}
                  data-testid="catalog-price-input"
                />
              </label>
              <label className="stack" style={{ flex: 1 }}>
                <span>Lead time (days)</span>
                <input
                  type="number"
                  min={0}
                  max={365}
                  value={catLeadDays}
                  onChange={(e) => setCatLeadDays(e.target.value)}
                  data-testid="catalog-lead-input"
                />
              </label>
            </div>
            {catKind === "item" ? <fieldset className="task-template-editor"><legend>Delivery task templates</legend><p className="subtle">Tasks are created only after all required people approve. If no template is added, one “Deliver item title” task is assigned to Provider.</p>{catTasks.map((task,index)=><div className="row" key={index}><label className="stack">Task title<input value={task.title} onChange={event=>setCatTasks(tasks=>tasks.map((item,i)=>i===index ? {...item,title:event.target.value} : item))}/></label><label className="stack">Assignee<select value={task.assigneeRole} onChange={event=>setCatTasks(tasks=>tasks.map((item,i)=>i===index ? {...item,assigneeRole:event.target.value as Role} : item))}><option value="customer">Customer</option><option value="provider">Provider</option><option value="finance">Finance</option></select></label><button type="button" className="btn" aria-label={`Remove task ${index+1}`} onClick={()=>{setCatTasks(tasks=>tasks.filter((_,i)=>i!==index));setDirtyGroups(groups=>groups.includes("catalog")?groups:[...groups,"catalog"]);}}>Remove</button></div>)}<button type="button" className="btn" onClick={()=>{setCatTasks(tasks=>[...tasks,{title:"",assigneeRole:"provider"}]);setDirtyGroups(groups=>groups.includes("catalog")?groups:[...groups,"catalog"]);}}>Add task template</button></fieldset> : null}
            <div className="row">
              <button
                type="button"
                className="btn primary"
                data-testid="confirm-catalog-btn"
                onClick={() => {
                  const key = catKey.trim();
                  if (!ITEM_KEY_RE.test(key)) {
                    setErrorText("Unknown catalog item key.");
                    return;
                  }
                  const trimmedTitle = catTitle.trim();
                  if (!isValidCatalogTitle(trimmedTitle)) {
                    setErrorText(
                      "Check the highlighted field and try again.",
                    );
                    return;
                  }
                  const parsedPrice = parseCents(catPrice);
                  if (!parsedPrice.ok) {
                    setErrorText("Enter a valid non-negative USD amount.");
                    return;
                  }
                  if (catKind === "item" && catTasks.some(task => !task.title.trim())) {
                    setErrorText("Give every task template a title, or remove the empty template.");
                    return;
                  }
                  const lead = Number(catLeadDays);
                  if (!Number.isInteger(lead) || lead < 0) {
                    setErrorText("Enter a valid lead time in days.");
                    return;
                  }
                  void runBriefMutation(() =>
                    onConfirmCatalog?.([
                      {
                        itemKey: key,
                        kind: catKind,
                        priceCents: parsedPrice.value,
                        leadDays: lead,
                        title: trimmedTitle,
                        taskTemplates: catKind === "modifier" ? [] : catTasks.length ? catTasks.map(task=>({...task,title:task.title.trim()})) : [
                          {
                            title: `Deliver ${trimmedTitle}`,
                            assigneeRole: "provider",
                          },
                        ],
                      },
                    ]), "catalog",
                  );
                }}
              >
                Confirm catalog
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {role === "customer" || role === "finance" ? (
        <div className="panel muted stack" data-testid="disclosure-gate-box" data-draft-scope="sharing">
          <h3 style={{ margin: 0, fontSize: "1rem" }}>
            Explicit field disclosure gate
          </h3>
          <label className="stack">Field to share<select aria-label="Field to share" value={shareField} onChange={event=>{setShareField(event.target.value as ShareField);setConfirmOwnDisclosure(false);}}>{(role === "finance" ? [["capCents","Budget cap"],["committedCents","Committed amount"],["headroomCents","Remaining headroom"]] : [["deadline","Delivery deadline"],["requiredItemKeys","Required scope"],["preferredItemKeys","Wishlist"]]).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
          <fieldset className="sharing-audience"><legend>Who will see the confirmed value</legend>{(role === "finance" ? ["customer"] as const : ["provider","finance"] as const).map(recipient=><label className="row" key={recipient}><input type="checkbox" checked={shareAudience.includes(recipient)} onChange={event=>{setShareAudience(event.target.checked ? [...shareAudience,recipient] : shareAudience.filter(item=>item!==recipient));setConfirmOwnDisclosure(false);}}/>{formatRole(recipient)} and their agent</label>)}</fieldset>
          {brief?.latest ? <p>{shareAudience.length ? <>{formatDisclosureConsent(shareAudience,shareField)} {formatSharedValue(ownBriefFieldValue(shareField, brief), view.catalog)}</> : "No participants selected. Confirming withdraws this field from the shared view; earlier recipients may already know its value."}</p> : <p>Confirm your brief before sharing any values.</p>}
          <label className="row">
            <input
              type="checkbox"
              checked={confirmOwnDisclosure}
              onChange={(e) => setConfirmOwnDisclosure(e.target.checked)}
              data-testid="confirm-own-disclosure-checkbox"
            />
            <span>
              I confirm sharing my own private field value with the selected
              participants
            </span>
          </label>
          <div className="row">
            <button
              type="button"
              className="btn"
              data-testid="share-field-btn"
              disabled={!brief?.latest}
              onClick={() => {
                if (!confirmOwnDisclosure) {
                  setErrorText(
                    "Confirm sharing your private value before disclosing it.",
                  );
                  return;
                }
                void runBriefMutation(() =>
                  onAddSharedFact?.({
                    field: shareField,
                    audience: shareAudience,
                    confirmOwnDisclosure: true,
                  }), "sharing",
                );
              }}
            >
              {!shareAudience.length ? "Withdraw shared field" : shareField === "capCents" ? "Share budget cap with Customer" : shareField === "deadline" ? "Share deadline with room" : "Share selected field"}
            </button>
          </div>
        </div>
      ) : null}

      </fieldset>
      {showPreviewDialog && previewChange ? (
        <ConfirmConstraintChangeDialog
          preview={previewChange}
          currentConstraintsVersion={view.header.constraintsVersion}
          onCancel={() => setShowPreviewDialog(false)}
          onConfirm={() => {
            if (role === "finance") {
              const parsed = parseCents(capInput);
              if (parsed.ok) {
                return runBriefMutation(() => onSetCap?.(parsed.value));
              }
            }
            const parsedDate = parseIsoDate(deadlineInput.trim());
            const itemKeys = requiredKeysInput
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
            return runBriefMutation(() =>
              onConfirmBrief?.({
                hardFields: {
                  schemaKey: "scope_change.customer.v1",
                  requiredItemKeys: itemKeys,
                  deadline: parsedDate.ok ? parsedDate.value : deadlineInput,
                },
                softFields: { schemaKey: "scope_change.customer.v1", preferredItemKeys: preferredKeys, notes: softNotes.trim() },
                disclosures: brief?.latest?.disclosures ?? {},
              }),
            );
          }}
        />
      ) : null}
    </section>
  );
}

export function ResultsScreen({
  view,
  execution = null,
  onMarkTaskDone,
  onStartFollowUp,
  onRequestRenegotiation,
}: {
  view: RoomView;
  execution?: ExecutionView | null;
  onMarkTaskDone?: (taskId: import("@convex/_generated/dataModel").Id<"tasks">) => Promise<void> | void;
  onStartFollowUp?: () => Promise<void> | void;
  onRequestRenegotiation?: () => Promise<void> | void;
}) {
  const [errorText, setErrorText] = useState<string | null>(null);

  async function runResultAction(fn?: () => Promise<void> | void) {
    if (!fn) return;
    setErrorText(null);
    try {
      await fn();
    } catch (err) {
      setErrorText(parseUiError(err).message);
    }
  }

  return (
    <section className="stack" data-testid="results-page">
      <div>
        <h1>Results</h1>
        <VersionBadge header={view.header} />
      </div>

      {errorText ? (
        <div className="stale-banner" role="alert" data-testid="results-error">
          {errorText}
        </div>
      ) : null}

      {execution === null ? (
        <div className="stack">
          <p>No change order has been recorded yet.</p>
          {view.header.phase.phase === "stopped" ||
          view.run?.status === "ended_no_agreement" ||
          view.run?.status === "canceled" ? (
            <div className="panel muted stack" data-testid="no-agreement-card">
              <h2 style={{ margin: 0 }}>Run ended without agreement</h2>
              <p style={{ margin: 0 }}>
                Reason:{" "}
                {view.header.phase.phase === "stopped"
                  ? view.header.phase.reason
                  : (view.run?.endedReason ?? "ended_no_agreement")}
              </p>
              {view.header.isCreator ? (
                <div className="row">
                  <button
                    type="button"
                    className="btn primary"
                    data-testid="results-renegotiate-btn"
                    onClick={() => {
                      void runResultAction(onRequestRenegotiation);
                    }}
                  >
                    Start new negotiation run
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="panel muted stack" data-testid="whats-in-the-way">
            <h2 style={{ margin: 0, fontSize: "1.05rem" }}>
              What&apos;s in the way
            </h2>
            {view.currentProposal === null ? (
              <p className="subtle" style={{ margin: 0 }}>
                Agents have not yet converged on a proposal for review.
              </p>
            ) : (
              <ul>
                {view.currentProposal.approvals
                  .filter((slot) => slot.state !== "approved")
                  .map((slot) => (
                    <li key={slot.role}>
                      {slot.displayName} ({formatRole(slot.role)}): {slot.state}
                    </li>
                  ))}
              </ul>
            )}
          </div>
        </div>
      ) : (
        <div className="stack">
          <div className="row-between">
            <ChangeOrderDisclaimer />
            {execution.provenance !== "live" ? <SimulatedBadge /> : null}
          </div>

          <p data-testid="change-order">
            {execution.provenance !== "live" ? <SimulatedBadge /> : null}{" "}
            Change Order CO-{execution.changeOrder.number}
          </p>

          {execution.approvalsSnapshot &&
          execution.approvalsSnapshot.length > 0 ? (
            <div
              className="panel muted stack"
              data-testid="approvals-snapshot"
            >
              <h2 style={{ margin: 0, fontSize: "1.05rem" }}>
                Frozen approvals snapshot (constraints v
                {execution.constraintsVersion})
              </h2>
              <ul>
                {execution.approvalsSnapshot.map((entry) => (
                  <li key={entry.role}>
                    {entry.displayName} ({formatRole(entry.role)}) · bound to
                    constraints v{execution.constraintsVersion}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {execution.changeOrder.amountChain ? <ul data-testid="amount-chain">
            {([
              ["Baseline", execution.changeOrder.amountChain.baselineCents],
              ["Previously approved", execution.changeOrder.amountChain.approvedToDateCents],
              ["Committed before", execution.changeOrder.amountChain.committedBeforeCents],
              ["This change", execution.changeOrder.amountChain.thisChangeCents],
              ["Committed after", execution.changeOrder.amountChain.committedAfterCents],
            ] as const).map(([label, amount]) => amount === null ? null : <li key={label}>{label} {formatCents(amount)}</li>)}
          </ul> : null}

          <h2>Why this happened</h2>
          <ol data-testid="why-chain">{execution.whyChain.map((step, index) => <li key={index}>{step.href ? <a href={step.href}>{step.text}</a> : step.text}</li>)}</ol>
          <h2>Tasks</h2>
          <ul data-testid="execution-tasks">
            {execution.tasks.map((task) => (
              <li key={task.taskKey || task.title} className="row-between">
                <span>
                  {task.title} · assigned to {formatRole(task.assigneeRole)} ·
                  due <DeliveryDate iso={task.dueDate} /> ·{" "}
                  <strong>{task.status}</strong>
                  {task.canMarkDone ? " · you can mark this done" : ""}
                </span>
                {task.canMarkDone && task.status === "open" ? (
                  <button
                    type="button"
                    className="btn"
                    data-testid={`mark-task-done-${task.taskId}`}
                    onClick={() => {
                      void runResultAction(() => onMarkTaskDone?.(task.taskId));
                    }}
                  >
                    Mark done
                  </button>
                ) : null}
              </li>
            ))}
          </ul>

          <div className="row">
            <button
              type="button"
              className="btn primary"
              data-testid="start-follow-up-btn"
              onClick={() => {
                void runResultAction(onStartFollowUp);
              }}
            >
              Start follow-up room
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

export function PeopleScreen({
  view,
  onCreateInvite,
  onCreateInviteLink,
}: {
  view: RoomView;
  onCreateInvite?: (input: {
    role: Role;
    invitedEmail: string;
  }) => Promise<void> | void;
  onCreateInviteLink?: (role: Role) => Promise<{ token: string }> | void;
}) {
  const [selectedInviteRole, setInviteRole] = useState<Role | null>(null);
  const availableSeats = (view.seats ?? []).filter(seat => seat.state !== "filled");
  // Keep an explicit available choice, prefer never-invited seats by default, and
  // react immediately when a subscription reports that the chosen seat filled.
  const inviteRole = availableSeats.find(seat => seat.role === selectedInviteRole)?.role
    ?? availableSeats.find(seat => seat.state === "empty")?.role
    ?? availableSeats[0]?.role
    ?? null;
  const [inviteEmail, setInviteEmail] = useState("");
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  return (
    <section className="stack" data-testid="people-page">
      <div>
        <h1>People</h1>
        <VersionBadge header={view.header} />
      </div>
      <ul>
        {view.members.map((member) => (
          <li key={member.role} data-testid={`member-row-${member.role}`}>
            {member.displayName}
            {member.isMe ? " (you)" : ""} · {member.joinedVia}
            {member.briefVersion !== null
              ? ` · brief v${member.briefVersion}`
              : member.briefConfirmed
                ? " · brief confirmed"
                : " · brief pending"}
          </li>
        ))}
      </ul>
      {view.seats !== null ? (
        <>
          <h2>Seats</h2>
          <ul>
            {view.seats.map((seat) => (
              <li key={seat.role}>
                {seat.role}: {seat.state}
                {seat.invitedEmail ? ` (${seat.invitedEmail})` : ""}
              </li>
            ))}
          </ul>

          {view.header.isCreator ? (
            <div
              className="panel muted stack"
              data-testid="creator-invite-controls"
            >
              <h3 style={{ margin: 0, fontSize: "1rem" }}>
                Invite participant (Creator only)
              </h3>
              <div className="row">
                <label className="row">
                  <span>Seat</span>
                  <select
                    value={inviteRole ?? ""}
                    disabled={inviteRole === null}
                    onChange={(e) => setInviteRole(e.target.value as Role)}
                    data-testid="invite-role-select"
                  >
                    {inviteRole === null ? <option value="">No open seats</option> : null}
                    {view.seats.map(seat => <option key={seat.role} value={seat.role} disabled={seat.state === "filled"}>{formatRole(seat.role)}{seat.state === "filled" ? " (filled)" : seat.state === "invited" ? " (invited)" : ""}</option>)}
                  </select>
                </label>
                <label className="row" style={{ flex: 1 }}>
                  <span>Email</span>
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="colleague@example.com"
                    data-testid="invite-email-input"
                    disabled={inviteRole === null}
                  />
                </label>
                <button
                  type="button"
                  className="btn primary"
                  data-testid="send-email-invite-btn"
                  disabled={inviteRole === null}
                  onClick={async () => {
                    if (inviteRole === null) return;
                    setErrorText(null);
                    try {
                      await onCreateInvite?.({
                        role: inviteRole,
                        invitedEmail: inviteEmail.trim(),
                      });
                      setInviteEmail("");
                    } catch (err) {
                      setErrorText(parseUiError(err).message);
                    }
                  }}
                >
                  Send email invite
                </button>
                <button
                  type="button"
                  className="btn"
                  data-testid="create-invite-link-btn"
                  disabled={inviteRole === null}
                  onClick={async () => {
                    if (inviteRole === null) return;
                    setErrorText(null);
                    try {
                      const res = await onCreateInviteLink?.(inviteRole);
                      if (res && "token" in res) {
                        setGeneratedLink(`/invite#t=${res.token}`);
                      }
                    } catch (err) {
                      setErrorText(parseUiError(err).message);
                    }
                  }}
                >
                  Create single-use link
                </button>
              </div>
              {inviteRole === null ? <p role="status">All three seats are filled. No further invitations are needed.</p> : null}
              {generatedLink ? (
                <p data-testid="generated-invite-link">
                  Single-use fragment link: <code>{generatedLink}</code>
                </p>
              ) : null}
              {errorText ? (
                <div
                  className="stale-banner"
                  role="alert"
                  data-testid="people-invite-error"
                >
                  {errorText}
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

export function DecisionScreen({
  view,
  version,
  proposalId,
  historicalDetail,
  onRecordDecision,
}: {
  view: RoomView;
  version?: number;
  proposalId?: string;
  historicalDetail?: ProposalDetailView | null;
  onRecordDecision?: (input: RecordDecisionInput) => Promise<void> | void;
}) {
  const current = view.currentProposal;
  const matchesCurrent =
    current !== null &&
    ((version !== undefined && current.version === version) ||
      (proposalId !== undefined &&
        current.proposalId === proposalId));

  if (current !== null && matchesCurrent) {
    const question =
      current.myAction.kind === "budget"
        ? `Approve the budget commitment for proposal v${current.version}?`
        : `Accept the terms of proposal v${current.version}?`;
    return (
      <article className="stack" data-testid="decision-page">
        <h1
          id="decision-proposal-title"
          tabIndex={-1}
          data-testid="decision-proposal-title"
          style={{ margin: 0 }}
        >
          {question}
        </h1>
        <p style={{ margin: 0 }}>
          These exact terms under constraints v{view.header.constraintsVersion}
        </p>
        <VersionBadge header={view.header} />
        <p style={{ margin: 0 }}>{current.origin === "agent" ? "Proposed by an agent" : "Chosen by a person"}</p>
        {current.provenance !== "live" ? <SimulatedBadge /> : null}
        <ul data-testid="decision-lines">
          {current.lines.map((line) => (
            <li key={line.itemKey}>
              <CatalogTitleText title={line.title} />{" "}
              {formatCents(line.priceCents)}
            </li>
          ))}
        </ul>
        <p style={{ margin: 0 }}>
          Delivery <DeliveryDate iso={current.terms.deliveryDate} /> · Total{" "}
          {formatCents(current.terms.amountCents)}
        </p>
        {current.notIncludedForMe !== null &&
        current.notIncludedForMe.length > 0 ? (
          <p style={{ margin: 0 }} data-testid="not-included-for-me">
            Not included from your wishlist:{" "}
            {formatItemKeys(current.notIncludedForMe, view.catalog)}.
          </p>
        ) : null}
        {current.diffFromPrevious !== null ? (
          <div>
            <h2>What changed from v{current.diffFromPrevious.previousVersion}</h2>
            <ul>
              {current.diffFromPrevious.changes.map((change) => (
                <li key={change}>{change}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {current.createdAtConstraintsVersion !== view.header.constraintsVersion ? (
          <StaleBanner
            constraintsVersion={view.header.constraintsVersion}
            focusTargetId="decision-proposal-title"
          />
        ) : null}
        <ChecksList
          fit={current.fit}
          constraintsVersion={view.header.constraintsVersion}
        />
        {current.myAgentSuggestion?.proposalVersion === current.version ? <AgentBox suggestion={current.myAgentSuggestion} /> : <p>Your agent hasn&apos;t commented on this version.</p>}
        <HumanBox>
          {current.recordsPreview !== null ? (
            <p>
              If all required people approve: 1 change order · a {formatCents(current.terms.amountCents)} change order ·{" "}
              {current.recordsPreview.taskCount} tasks · written once,
              atomically · internal records only
              {current.recordsPreview.myTaskTitles.length > 0
                ? ` · Your tasks: ${current.recordsPreview.myTaskTitles.join("; ")}`
                : ""}
            </p>
          ) : null}
          <ApprovalPanel
            slots={current.approvals}
            proposalVersion={current.version}
            constraintsVersion={view.header.constraintsVersion}
            usedForExecution={
              view.execution !== null &&
              view.execution.proposalVersion === current.version
            }
          />
          <ApprovalButton
            key={`${current.proposalId}:${current.termsKey}:${view.header.constraintsVersion}`}
            proposalId={current.proposalId}
            termsKey={current.termsKey}
            role={view.header.viewingAs}
            version={current.version}
            constraintsVersion={view.header.constraintsVersion}
            action={current.myAction}
            amountCents={current.terms.amountCents}
            onRecordDecision={onRecordDecision}
          />
        </HumanBox>
        <details>
          <summary>Learn more</summary>
          <p>{formatCatalogReferences(current.summaryText, view.catalog)}</p>
        </details>
      </article>
    );
  }

  const archived = historicalDetail?.card;
  if (archived === undefined || archived === null) {
    return <p>This proposal is not available to you.</p>;
  }
  return (
    <article className="stack" data-testid="decision-page">
      <h1 id="decision-proposal-title" tabIndex={-1} style={{ margin: 0 }}>Proposal v{archived.version}</h1>
      {archived.createdAtConstraintsVersion !== view.header.constraintsVersion ? (
        <StaleBanner constraintsVersion={view.header.constraintsVersion} focusTargetId="decision-stale-banner" />
      ) : null}
      <p style={{ margin: 0 }}>Storage status: {archived.status}</p>
      <p style={{ margin: 0 }} data-testid="historical-checks-note">
        Checks are shown for the current proposal only.
      </p>
      {archived.provenance !== "live" ? <SimulatedBadge /> : null}
      <ul data-testid="decision-lines">
        {archived.lines.map((line) => (
          <li key={line.itemKey}>
            <CatalogTitleText title={line.title} />{" "}
            {formatCents(line.priceCents)}
          </li>
        ))}
      </ul>
      <p style={{ margin: 0 }}>
        Delivery <DeliveryDate iso={archived.terms.deliveryDate} />
      </p>
      <ApprovalPanel
        slots={archived.approvals}
        proposalVersion={archived.version}
        constraintsVersion={archived.createdAtConstraintsVersion}
        usedForExecution={false}
      />
    </article>
  );
}

export function DisclosureConfirmation({ option, brief, catalog = [] }: { option: DisclosureOption; brief?: MyBriefView | null; catalog?: RoomView["catalog"] }) {
  const value = ownDisclosureValue(option, brief);
  if (value === null) return null;
  return <>{formatDisclosureConsent(option.disclose.toRoles, option.disclose.field)} {formatSharedValue(value, catalog)}</>;
}

export function RequestScreen({
  view,
  requestId,
  requestDetail,
  brief,
  onAnswerRequest,
}: {
  view: RoomView;
  requestId?: string;
  brief?: MyBriefView | null;
  requestDetail?: import("convex/server").FunctionReturnType<typeof import("@/lib/api").api.humanRequests.get> | null;
  onAnswerRequest?: (optionKey: string) => Promise<void> | void;
}) {
  const request = requestDetail === undefined ? view.openRequest : requestDetail;
  const [selection, setSelection] = useState<{ requestId: string; key: string } | null>(null);
  const selectedKey = request?.mine && selection?.requestId === request.requestId ? selection.key : null;
  const setSelectedKey = (key: string) => { if (request?.mine) { setSelection({ requestId: request.requestId, key }); setConfirmationBinding(null); } };
  const [confirmationBinding, setConfirmationBinding] = useState<string | null>(null);
  const ownBrief = brief?.role === view.header.viewingAs ? brief : null;
  const consentBinding = JSON.stringify([request, selectedKey, ownBrief]);
  const endConfirm = confirmationBinding === consentBinding;
  const [submitting, setSubmitting] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  if (request === null || ("status" in request && request.status !== "open")) {
    return (
      <section className="panel stack" data-testid="request-closed">
        <h1>This request is already closed.</h1>
        {request && "status" in request ? <p>Status: {String(request.status)}{"closedReason" in request && request.closedReason ? ` · ${request.closedReason}` : ""}{"closedAtConstraintsVersion" in request && request.closedAtConstraintsVersion != null ? ` · Constraints v${request.closedAtConstraintsVersion}` : ""}</p> : null}
        <VersionBadge header={view.header} />
      </section>
    );
  }

  if (!request.mine) {
    if ("waitingOnRole" in request) {
      return (
        <section className="panel stack" data-testid="request-waiting-buyer">
          <h1>Trade-off in progress</h1>
          <VersionBadge header={view.header} />
          <p>
            {waitingText(request.kind, request.waitingOnRole)}
          </p>
        </section>
      );
    }
    return (
      <section className="panel stack" data-testid="request-waiting-provider">
        <h1>Run waiting</h1>
        <VersionBadge header={view.header} />
        <p>Waiting on others</p><p>Waiting on the buyer side</p>
      </section>
    );
  }

  if (requestId && request.requestId !== requestId && requestId !== "open") {
    return (
      <section className="panel stack" data-testid="request-closed">
        <h1>This request is already closed.</h1>
        <VersionBadge header={view.header} />
      </section>
    );
  }

  async function handleConfirm() {
    if (!selectedKey) return;
    setSubmitting(true);
    setErrorText(null);
    try {
      const selected = request?.mine ? request.options.find((o) => o.optionKey === selectedKey) : null;
      if (!selected || !canAnswerOption(selected, ownBrief)) return;
      if (["end_run", "choose_candidate", "disclose", "pass_to_next"].includes(selected.type) && !endConfirm) { setConfirmationBinding(consentBinding); return; }
      await onAnswerRequest?.(selectedKey);
    } catch (err) {
      setErrorText(parseUiError(err).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <article className="panel stack" data-testid="request-page">
      <div className="row-between">
        <div>
          <p className="eyebrow">Human Input Request · {request.kind.replaceAll("_", " ")}</p>
          <h1 style={{ margin: "0.25rem 0 0" }}>Choose how to proceed</h1>
        </div>
        <VersionBadge header={view.header} />
      </div>

      <p>Agents did not pick this. This is a human choice.</p>
      <div
        role="radiogroup"
        aria-label="Choose how to proceed"
        className="stack"
        data-testid="request-options-group"
      >
        {request.options.map((opt) => {
          if (!opt.answerable && !["disclose", "pass_to_next", "raise_cap", "drop_items", "extend_deadline"].includes(opt.type)) return <div key={opt.optionKey} className="panel muted" data-testid={`request-option-${opt.optionKey}`}><p data-testid={`option-blocked-${opt.optionKey}`}>{formatCatalogReferences(opt.text, view.catalog)}</p></div>;
          const disabled = !canAnswerOption(opt, ownBrief);
          return (
            <label
              key={opt.optionKey}
              aria-label={formatCatalogReferences(opt.text, view.catalog)}
              htmlFor={`request-option-input-${opt.optionKey}`}
              className="panel muted stack"
              data-testid={`request-option-${opt.optionKey}`}
              style={{ opacity: disabled ? 0.65 : 1 }}
            >
              <div className="row-between">
                <span className="row">
                  <input
                    type="radio"
                    id={`request-option-input-${opt.optionKey}`}
                    name="request-option"
                    value={opt.optionKey}
                    checked={selectedKey === opt.optionKey}
                    disabled={disabled}
                    aria-disabled={disabled ? "true" : undefined}
                    aria-describedby={disabled ? `option-detail-${opt.optionKey}` : undefined}
                    onChange={() => {
                      if (!disabled) setSelectedKey(opt.optionKey);
                    }}
                    data-testid={`request-radio-${opt.optionKey}`}
                  />
                  <strong>{!disabled && opt.type === "pass_to_next" ? passRequestText(opt.toRole) : opt.text}</strong>
                </span>
                {!disabled ? <span className="pill">{opt.type}</span> : null}
              </div>
              {disabled ? <p id={`option-detail-${opt.optionKey}`}>{missingOptionDetail}</p> : null}
              {!disabled && "itemKeys" in opt.shown && opt.shown.itemKeys ? <p>{opt.shown.itemKeys.join(", ")}</p> : null}
              {!disabled && "amountCents" in opt.shown && opt.shown.amountCents != null ? <p>{formatCents(opt.shown.amountCents)}</p> : null}
              {!disabled && "deliveryDate" in opt.shown && opt.shown.deliveryDate ? <p>Delivery <DeliveryDate iso={opt.shown.deliveryDate} /></p> : null}
            </label>
          );
        })}
      </div>

      {errorText ? (
        <div className="stale-banner" role="alert" data-testid="request-error">
          {errorText}
        </div>
      ) : null}

      <p id="request-choice-reason" tabIndex={-1}>{!selectedKey ? "Select an option before confirming." : "Review your choice before confirming."}</p>
      {endConfirm ? (() => {
        const option = request.options.find(o => o.optionKey === selectedKey);
        return <div role="alertdialog" aria-label="Confirm your choice">
          <p>{option?.type === "choose_candidate" ? "This creates a proposal. You will still need to approve it." : option && hasDisclosure(option) ? <DisclosureConfirmation option={option} brief={ownBrief} catalog={view.catalog} /> : option?.type === "pass_to_next" ? passRequestText(option.toRole) : "Confirm ending the negotiation without agreement."}</p>
        </div>;
      })() : null}
      <div className="row">
        <a className="btn" href={`/rooms/${view.header.roomId}`}>Answer later (expires after 7 days)</a>
        <button
          type="button"
          className="btn primary"
          data-testid="confirm-request-answer"
          aria-disabled={!selectedKey || submitting}
          aria-describedby="request-choice-reason"
          onClick={() => {
            if (!selectedKey || submitting) { document.getElementById("request-choice-reason")?.focus(); return; }
            void handleConfirm();
          }}
        >
          {submitting ? "Submitting…" : endConfirm ? (request.options.find(o => o.optionKey === selectedKey)?.type === "end_run" ? "Confirm end negotiation" : "Confirm choice") : "Confirm choice"}
        </button>
      </div>
    </article>
  );
}

const TIMELINE_FILTERS = [
  { id: "all", label: "Everything" },
  { id: "decisions", label: "Decisions" },
  { id: "constraints", label: "Constraints" },
  { id: "runs", label: "Agent runs" },
  { id: "private", label: "Private to you" },
] as const;

export type TimelineFilterKey = (typeof TIMELINE_FILTERS)[number]["id"];

function matchesTimelineFilter(
  entry: TimelineEntry,
  filter: TimelineFilterKey,
): boolean {
  if (filter === "all") return true;
  if (filter === "private") return entry.privateToYou;
  if (filter === "decisions") return /^(approval_|proposal_|reapproval_|room_executed)/.test(entry.type);
  if (filter === "constraints") return /^(constraints_|brief_|baseline_|catalog_|disclosure_)/.test(entry.type) || entry.type === "room_opened";
  return /^(run_|turn_|human_request_)/.test(entry.type);
}

export function TimelineScreen({
  view,
  items,
  hasMore = false,
  newEventCount = 0,
  onLoadOlder,
  onClearNewEvents,
}: {
  view: RoomView;
  items?: readonly TimelineEntry[];
  hasMore?: boolean;
  newEventCount?: number;
  onLoadOlder?: () => void;
  onClearNewEvents?: () => void;
}) {
  const [filter, setFilter] = useState<TimelineFilterKey>("all");
  const allEntries = items ?? [];
  const filtered = allEntries.filter((e) => matchesTimelineFilter(e, filter));

  return (
    <section className="stack" data-testid="timeline-page">
      <div className="row-between">
        <div>
          <h1>Room timeline</h1>
          <VersionBadge header={view.header} />
        </div>
        {newEventCount > 0 ? (
          <button
            type="button"
            className="btn primary"
            data-testid="timeline-new-events-pill"
            onClick={onClearNewEvents}
          >
            {newEventCount} new {newEventCount === 1 ? "event" : "events"}
          </button>
        ) : null}
      </div>

      <div
        className="chip-bar"
        role="toolbar"
        aria-label="Filter timeline events"
        data-testid="timeline-filter-chips"
      >
        {TIMELINE_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className="chip"
            aria-pressed={filter === f.id}
            data-testid={`timeline-filter-${f.id}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <ul className="check-list" data-testid="timeline-page-list">
        {filtered.map((entry) => (
          <li
            key={entry.eventId}
            className="panel muted row-between"
            data-actor={entry.actorKind}
          >
            <div>
              <span className={`actor actor-${entry.actorKind} pill`}>
                {entry.actorKind}
              </span>{" "}
              <span>{entry.text}</span>
              {entry.privateToYou ? (
                <span className="private-flag pill"> Private to you</span>
              ) : null}
            </div>
            <div className="row">
              {entry.refs.proposalVersion !== null ? (
                <span className="pill">
                  Proposal v{entry.refs.proposalVersion}
                </span>
              ) : null}
              {entry.refs.constraintsVersion !== null ? (
                <span className="pill">
                  Constraints v{entry.refs.constraintsVersion}
                </span>
              ) : null}
              {entry.provenance !== "live" ? <SimulatedBadge /> : null}
            </div>
          </li>
        ))}
      </ul>

      {hasMore ? (
        <div className="row">
          <button
            type="button"
            className="btn"
            data-testid="timeline-load-older"
            onClick={onLoadOlder}
          >
            Load older events
          </button>
        </div>
      ) : null}

      <p className="subtle" data-testid="timeline-footer">
        Showing all {filtered.length} events visible to{" "}
        {formatRole(view.header.viewingAs)} in this room.
      </p>
    </section>
  );
}
