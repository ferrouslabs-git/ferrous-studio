// The Slots sub-section of a study: when participants can book. A person adds
// windows of time (in the study's time zone); each is cut, from its start,
// into session-long slots with the study's gap between them, and held on the
// moderator's Google calendar so nothing else is booked over it. A window can
// be changed until someone books in it. The preview shows every slot as free,
// booked (by whom), busy (the moderator's calendar has something then) or
// past (already started). Everything saves when chosen.
import { FormEvent, useState } from "react";
import { errorMessage } from "../../../core/api";
import { useLoad } from "../../../core/useLoad";
import { Card } from "./StudyEditor";
import {
  addAvailability,
  getAvailability,
  removeAvailability,
  Study,
  syncHolds,
  updateAvailability,
  updateStudy,
} from "./usabilityApi";
import { dateIn, dayIn, slotsByDay, timeIn, timeZones, zonedToUtc, zoneName } from "./usabilityModel";

type Draft = { date: string; from: string; to: string };

export function StudySlots({
  projectId,
  study,
  onSaved,
}: {
  projectId: string;
  study: Study;
  onSaved: () => Promise<unknown>;
}) {
  // Reloads whenever the study is saved: a new moderator, length or gap changes the slots.
  const loaded = useLoad(() => getAvailability(projectId, study.id), [projectId, study.id, study.updated_at]);
  const shown = loaded.data;
  const [timezone, setTimezone] = useState(study.timezone);
  const [gap, setGap] = useState(String(study.slot_gap_minutes ?? 0));
  const [draft, setDraft] = useState<Draft>({ date: "", from: "09:00", to: "17:00" });
  // The window being changed, if any, and its new times.
  const [editing, setEditing] = useState<{ id: string } & Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await loaded.reload();
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  // Study settings saved from here; the study reload then confirms them.
  const saveStudy = (patch: { timezone?: string; slot_gap_minutes?: number }) =>
    void run(async () => {
      await updateStudy(projectId, study.id, patch);
      await onSaved();
    });

  const span = (d: Draft) => ({ starts_at: zonedToUtc(d.date, d.from, timezone), ends_at: zonedToUtc(d.date, d.to, timezone) });

  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!draft.date) return setError("Choose a date.");
    void run(() => addAvailability(projectId, study.id, span(draft)));
  };

  const saveEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    if (await run(() => updateAvailability(projectId, study.id, editing.id, span(editing)))) setEditing(null);
  };

  if (loaded.error) return <div className="usab-warning">{loaded.error}</div>;
  if (!shown) return <div className="muted">Loading…</div>;
  const unheld = shown.windows.some((w) => !w.held);
  const days = slotsByDay(
    shown.slots.map((s) => s.start),
    timezone,
  );
  const slotAt = new Map(shown.slots.map((s) => [s.start, s]));

  return (
    <div className="stack">
      {shown.problems.length > 0 && (
        <div className="usab-warning" role="status">
          Before participants can book: {shown.problems.join(", ")}.
        </div>
      )}
      {!shown.calendar_connected && (
        <div className="usab-warning" role="status">
          Google Calendar is not connected: no sessions or holds go on the moderator's calendar, and their busy times
          are not checked.
        </div>
      )}
      {shown.calendar_error && (
        <div className="usab-warning" role="alert">
          {shown.calendar_error}
        </div>
      )}
      {error && (
        <div className="usab-warning" role="alert">
          {error}
        </div>
      )}

      <Card
        title="Bookable times"
        note={study.session_minutes ? `${study.session_minutes}-minute slots` : undefined}
        action={
          shown.calendar_connected && unheld ? (
            <button type="button" className="btn small ghost" disabled={busy} onClick={() => void run(() => syncHolds(projectId, study.id))}>
              Hold on calendar
            </button>
          ) : undefined
        }
      >
        <div className="usab-grid">
          <label className="drawer-field">
            <span className="drawer-field-label">Time zone</span>
            <select
              className="input"
              value={timezone}
              onChange={(e) => {
                setTimezone(e.target.value);
                saveStudy({ timezone: e.target.value });
              }}
            >
              {timeZones().map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          </label>
          <label className="drawer-field">
            <span className="drawer-field-label">Gap between slots (minutes)</span>
            <input
              className="input"
              type="number"
              min={0}
              max={240}
              step={5}
              value={gap}
              onChange={(e) => setGap(e.target.value)}
              onBlur={() => {
                const next = Math.min(240, Math.max(0, Number(gap) || 0));
                setGap(String(next));
                if (next !== (study.slot_gap_minutes ?? 0)) saveStudy({ slot_gap_minutes: next });
              }}
            />
          </label>
        </div>

        <form className="usab-window-form" onSubmit={add}>
          <WindowFields draft={draft} onChange={setDraft} />
          <button className="btn primary" disabled={busy}>
            Add
          </button>
        </form>

        {shown.windows.length === 0 ? (
          <div className="empty">No times yet.</div>
        ) : (
          <ul className="usab-windows">
            {shown.windows.map((w) =>
              editing?.id === w.id ? (
                <li key={w.id}>
                  <form className="usab-window-form usab-window-edit" onSubmit={saveEdit}>
                    <WindowFields draft={editing} onChange={(d) => setEditing({ ...editing, ...d })} />
                    <button className="btn primary" disabled={busy}>
                      Save
                    </button>
                    <button type="button" className="btn ghost" onClick={() => setEditing(null)}>
                      Cancel
                    </button>
                  </form>
                </li>
              ) : (
                <li key={w.id}>
                  <span>
                    {dayIn(w.starts_at, timezone)}, {timeIn(w.starts_at, timezone)} to {timeIn(w.ends_at, timezone)}{" "}
                    {zoneName(w.starts_at, timezone)}
                  </span>
                  <span className={w.held ? "usab-held" : "muted"}>
                    {w.held ? "Held on calendar" : w.hold_error ? `Not held: ${w.hold_error}` : "Not held"}
                  </span>
                  <span className="shell-spacer" />
                  {/* Times someone has booked in stay as they are. */}
                  <button
                    type="button"
                    className="btn small ghost"
                    disabled={busy || w.booked}
                    title={w.booked ? "Someone has booked in these times" : undefined}
                    onClick={() =>
                      setEditing({
                        id: w.id,
                        date: dateIn(w.starts_at, timezone),
                        from: timeIn(w.starts_at, timezone),
                        to: timeIn(w.ends_at, timezone),
                      })
                    }
                  >
                    {w.booked ? "Booked" : "Edit"}
                  </button>
                  <button
                    type="button"
                    className="btn small ghost"
                    disabled={busy}
                    onClick={() => void run(() => removeAvailability(projectId, study.id, w.id))}
                  >
                    Remove
                  </button>
                </li>
              ),
            )}
          </ul>
        )}
      </Card>

      <Card title="Slots" note={`${shown.slots.filter((s) => s.state === "free").length} free`}>
        {days.length === 0 && <div className="empty">No slots yet. Add times and set the session length.</div>}
        {days.map((d) => (
          <div key={d.day} className="usab-block">
            <h3>{d.day}</h3>
            <div className="usab-slots">
              {d.slots.map((iso) => {
                const slot = slotAt.get(iso);
                if (!slot) return null;
                return (
                  <span key={iso} className={`usab-slot ${slot.state}`}>
                    {timeIn(iso, timezone)}
                    {slot.state === "booked" && slot.participant && (
                      <b> {slot.participant.name || slot.participant.code}</b>
                    )}
                    {slot.state === "busy" && <i> busy</i>}
                    {slot.state === "past" && <i> past</i>}
                  </span>
                );
              })}
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}

function WindowFields({ draft, onChange }: { draft: Draft; onChange: (d: Draft) => void }) {
  return (
    <>
      <label className="drawer-field">
        <span className="drawer-field-label">Date</span>
        <input className="input" type="date" value={draft.date} onChange={(e) => onChange({ ...draft, date: e.target.value })} />
      </label>
      <label className="drawer-field">
        <span className="drawer-field-label">From</span>
        <input className="input" type="time" value={draft.from} onChange={(e) => onChange({ ...draft, from: e.target.value })} />
      </label>
      <label className="drawer-field">
        <span className="drawer-field-label">To</span>
        <input className="input" type="time" value={draft.to} onChange={(e) => onChange({ ...draft, to: e.target.value })} />
      </label>
    </>
  );
}
