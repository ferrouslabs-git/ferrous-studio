// Where a participant's booking email lands: /book/:booking_token.
//
// Public, like the study page: no account, and holding the link is the proof.
// It is not the session link (that is sent at the start of the call). The
// participant picks one of the free slots, shown in their own time zone; the
// session then goes on the moderator's calendar with them as a guest, and they
// are emailed what to prepare. The same link moves the booking later.
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { errorMessage } from "../../../core/api";
import { useFixedTheme } from "../../../core/theme";
import { bookSlot, Booking, getBooking } from "./usabilityApi";
import { dayIn, localZone, slotsByDay, timeIn, zoneName } from "./usabilityModel";

export function BookingPage() {
  // Participants always see Studio's light theme.
  useFixedTheme("light");
  const { token = "" } = useParams();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Showing the slots: on the first visit, or after "Choose a different time".
  const [choosing, setChoosing] = useState(false);
  const [justBooked, setJustBooked] = useState(false);
  const zone = localZone();

  const load = () =>
    getBooking(token)
      .then((b) => {
        setBooking(b);
        setChoosing(!b.booked);
      })
      .catch((err) => setError(errorMessage(err)));

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const book = async () => {
    if (!picked) return;
    setSaving(true);
    setSaveError(null);
    try {
      const b = await bookSlot(token, picked);
      setBooking(b);
      setChoosing(false);
      setJustBooked(true);
      setPicked(null);
    } catch (err) {
      setSaveError(errorMessage(err));
      // The slot may have gone: show what is free now.
      const fresh = await getBooking(token).catch(() => null);
      if (fresh) setBooking(fresh);
    } finally {
      setSaving(false);
    }
  };

  if (error) {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <h1>This link is not working</h1>
          <p>{error}</p>
          <p>If you were sent this link to book a usability session, reply to the email you got it in.</p>
        </div>
      </div>
    );
  }
  if (!booking) {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <p>Loading…</p>
        </div>
      </div>
    );
  }

  const length = booking.duration || `${booking.session_minutes} minutes`;
  const days = slotsByDay(booking.slots, zone);
  const when = (iso: string) => `${dayIn(iso, zone)} at ${timeIn(iso, zone)} (${zoneName(iso, zone)})`;

  return (
    <div className="auth-wrap">
      <div className="auth-card book-card">
        <div className="ustudy-eyebrow">{booking.organisation}</div>
        <h1>{booking.title}</h1>
        <p className="ustudy-lead">
          A usability session of {length} on a video call{booking.moderator ? ` with ${booking.moderator}` : ""}.
        </p>

        {booking.booked && !choosing && (
          <section className="book-done">
            <h2>{justBooked ? "You are booked" : "Your session"}</h2>
            <p className="book-when">{when(booking.booked.start)}</p>
            {booking.booked.meet_url && (
              <p>
                Join on the day:{" "}
                <a href={booking.booked.meet_url} target="_blank" rel="noopener noreferrer">
                  {booking.booked.meet_url}
                </a>
              </p>
            )}
            <p className="muted">
              {justBooked
                ? "A calendar invite and an email with what to prepare are on their way."
                : "Your calendar invite and confirmation email have the details."}
            </p>
            <button
              type="button"
              className="btn ghost"
              onClick={async () => {
                // What is free now, not what was free when the page first loaded.
                const fresh = await getBooking(token).catch((err) => {
                  setSaveError(errorMessage(err));
                  return null;
                });
                if (fresh) setBooking(fresh);
                setJustBooked(false);
                setChoosing(true);
              }}
            >
              Choose a different time
            </button>
          </section>
        )}

        {choosing && (
          <section>
            <h2>{booking.booked ? "Choose a different time" : "Choose a time"}</h2>
            <p className="muted">Times are shown in your time zone, {zone}.</p>
            {saveError && (
              <div className="usab-warning" role="alert">
                {saveError}
              </div>
            )}
            {days.length === 0 && (
              <p>There are no times left to book. Please reply to the email you were sent and we will find one.</p>
            )}
            {days.map((d) => (
              <div key={d.day} className="book-day">
                <h3>{d.day}</h3>
                <div className="book-slots" role="radiogroup" aria-label={d.day}>
                  {d.slots.map((iso) => (
                    <button
                      key={iso}
                      type="button"
                      role="radio"
                      aria-checked={picked === iso}
                      className={`btn${picked === iso ? " primary" : ""}`}
                      onClick={() => setPicked(iso)}
                    >
                      {timeIn(iso, zone)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <div className="ustudy-nav">
              {booking.booked ? (
                <button type="button" className="btn ghost" onClick={() => setChoosing(false)}>
                  Keep my current time
                </button>
              ) : (
                <span />
              )}
              <button type="button" className="btn primary" disabled={!picked || saving} onClick={() => void book()}>
                {saving ? "Booking…" : picked ? `Book ${dayIn(picked, zone)}, ${timeIn(picked, zone)}` : "Choose a time"}
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
