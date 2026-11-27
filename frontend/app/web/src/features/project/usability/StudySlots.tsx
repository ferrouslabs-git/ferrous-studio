// The Slots sub-section of a study: when participants can book. A person adds
// windows of time (in the study's time zone); each is cut into session-long
// slots and held on the moderator's Google calendar so nothing else is booked
// over it. The preview shows every slot as free, booked (by whom) or busy
// (the moderator's calendar has something then). Everything saves when chosen.
import { FormEvent, useState } from "react";
import { errorMessage } from "../../../core/api";
import { useLoad } from "../../../core/useLoad";
import { Card } from "./StudyEditor";
import { addAvailability, getAvailability, removeAvailability, Study, syncHolds, updateStudy } from "./usabilityApi";
import { dayIn, slotsByDay, timeIn, timeZones, zonedToUtc, zoneName } from "./usabilityModel";

export function StudySlots({
  projectId,
  study,
  onSaved,
}: {
  projectId: string;
  study: Study;
  onSaved: () => Promise<unknown>;
}) {
  // Shown at once while it saves; the study reload then confirms it.
  const [timezone, setTimezone] = useState(study.timezone);
  const onTimezone = (next: string) => {
    setTimezone(next);
    void run(async () => {
      await updateStudy(projectId, study.id, { timezone: next });
      await onSaved();
    });
  };
  // Reloads whenever the study is saved: a new moderator or length changes the slots.
  const loaded = useLoad(() => getAvailability(projectId, study.id), [projectId, study.id, study.updated_at]);
  const shown = loaded.data;
  const [draft, setDraft] = useState({ date: "", from: "09:00", to: "17:00" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await loaded.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!draft.date) return setError("Choose a date.");
    void run(() =>
      addAvailability(projectId, study.id, {
        starts_at: zonedToUtc(draft.date, draft.from, timezone),
        ends_at: zonedToUtc(draft.date, draft.to, timezone),
      }),
    );
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
        <label className="drawer-field">
          <span className="drawer-field-label">Time zone</span>
          <select className="input" value={timezone} onChange={(e) => onTimezone(e.target.value)}>
            {timeZones().map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </label>

        <form className="usab-window-form" onSubmit={add}>
          <label className="drawer-field">
            <span className="drawer-field-label">Date</span>
            <input className="input" type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
          </label>
          <label className="drawer-field">
            <span className="drawer-field-label">From</span>
            <input className="input" type="time" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
          </label>
          <label className="drawer-field">
            <span className="drawer-field-label">To</span>
            <input className="input" type="time" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
          </label>
          <button className="btn primary" disabled={busy}>
            Add
          </button>
        </form>

        {shown.windows.length === 0 ? (
          <div className="empty">No times yet.</div>
        ) : (
          <ul className="usab-windows">
            {shown.windows.map((w) => (
              <li key={w.id}>
                <span>
                  {dayIn(w.starts_at, timezone)}, {timeIn(w.starts_at, timezone)} to {timeIn(w.ends_at, timezone)}{" "}
                  {zoneName(w.starts_at, timezone)}
                </span>
                <span className={w.held ? "usab-held" : "muted"}>
                  {w.held ? "Held on calendar" : w.hold_error ? `Not held: ${w.hold_error}` : "Not held"}
                </span>
                <span className="shell-spacer" />
                <button
                  type="button"
                  className="btn small ghost"
                  disabled={busy}
                  onClick={() => void run(() => removeAvailability(projectId, study.id, w.id))}
                >
                  Remove
                </button>
              </li>
            ))}
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
