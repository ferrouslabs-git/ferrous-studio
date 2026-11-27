// The Participants sub-section of a study: who is taking part, the test
// account each one uses, their booking and their personal session link.
// A participant with a contact email is sent the booking invite when added
// (and again on request); the session link is never emailed: an admin copies
// it and sends it at the start of the call.
import { FormEvent, useState } from "react";
import { ConfirmDrawer } from "../../../components/ConfirmDrawer";
import { Drawer, Field } from "../../../components/Drawer";
import { ListTable, NameCell } from "../../../components/ListTable";
import { errorMessage } from "../../../core/api";
import { formatDateTime } from "../../../core/format";
import {
  addParticipant,
  Participant,
  ParticipantInput,
  removeParticipant,
  sendBookingEmail,
  Study,
  updateParticipant,
} from "./usabilityApi";
import { bookingStatus, participantLink, progressLabel } from "./usabilityModel";

export function StudyParticipants({
  projectId,
  study,
  onChanged,
  onOpenCapture,
}: {
  projectId: string;
  study: Study;
  onChanged: () => Promise<unknown>;
  onOpenCapture: (participantId: string) => void;
}) {
  const [drawer, setDrawer] = useState<{ participant: Participant | null } | null>(null);
  const [removing, setRemoving] = useState<Participant | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  // Send (or send again) the thank-you with the booking link; the list shows how it went.
  const send = async (p: Participant) => {
    setSendError(null);
    try {
      await sendBookingEmail(projectId, study.id, p.id);
    } catch (err) {
      setSendError(errorMessage(err));
    }
    await onChanged();
  };

  const copy = (p: Participant) => {
    void navigator.clipboard?.writeText(participantLink(p.token));
    setCopied(p.id);
    setTimeout(() => setCopied((id) => (id === p.id ? null : id)), 1500);
  };

  return (
    <div className="stack">
      <div className="row">
        <span className="shell-spacer" />
        <button className="btn primary" onClick={() => setDrawer({ participant: null })}>
          Add participant
        </button>
      </div>
      {sendError && (
        <div className="usab-warning" role="alert">
          {sendError}
        </div>
      )}
      <ListTable
        columns={[
          {
            header: "Participant",
            className: "primary",
            render: (p) => (
              <NameCell sub={[p.role, p.company].filter(Boolean).join(" · ") || undefined} onOpen={() => onOpenCapture(p.id)}>
                {p.name ? `${p.code} · ${p.name}` : p.code}
              </NameCell>
            ),
          },
          {
            header: "Booking",
            render: (p) => {
              const booking = bookingStatus(p, study.timezone);
              return (
                <span className={`badge ${booking.tone}`} title={booking.detail}>
                  {booking.text}
                </span>
              );
            },
          },
          {
            header: "Progress",
            render: (p) => {
              const progress = progressLabel(p);
              return <span className={`badge ${progress.tone}`}>{progress.text}</span>;
            },
          },
          { header: "Session", className: "when", render: (p) => (p.scheduled_at ? formatDateTime(p.scheduled_at) : <span className="muted">—</span>) },
          { header: "Consent", render: (p) => p.consent_name ?? <span className="muted">—</span> },
          {
            header: "Link",
            render: (p) => (
              <button type="button" className="btn small ghost" onClick={() => copy(p)}>
                {copied === p.id ? "Copied" : "Copy link"}
              </button>
            ),
          },
        ]}
        rows={study.participant_list}
        rowKey={(p) => p.id}
        rowLabel={(p) => p.code}
        actions={(p) => [
          { label: "Observation capture", onSelect: () => onOpenCapture(p.id) },
          { label: "Edit", onSelect: () => setDrawer({ participant: p }) },
          ...(p.contact_email
            ? [{ label: p.invite_sent_at ? "Resend booking email" : "Send booking email", onSelect: () => void send(p) }]
            : []),
          ...(p.meet_url ? [{ label: "Open Meet link", onSelect: () => window.open(p.meet_url, "_blank", "noopener") }] : []),
          { label: "Remove", danger: true, onSelect: () => setRemoving(p) },
        ]}
        empty={
          <>
            <b>No participants yet.</b> Add one to get their link.
          </>
        }
      />

      {drawer && (
        <ParticipantDrawer
          key={drawer.participant?.id ?? "new"}
          projectId={projectId}
          study={study}
          participant={drawer.participant}
          onClose={() => setDrawer(null)}
          onSaved={onChanged}
        />
      )}
      <ConfirmDrawer
        open={removing !== null}
        title="Remove participant"
        confirmLabel="Remove"
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return;
          await removeParticipant(projectId, study.id, removing.id);
          await onChanged();
        }}
      >
        <p>
          Remove <b>{removing?.code}</b>? Everything captured for them is deleted and their link stops working.
        </p>
      </ConfirmDrawer>
    </div>
  );
}

type Form = Required<Omit<ParticipantInput, "session_notes">>;

function ParticipantDrawer({
  projectId,
  study,
  participant,
  onClose,
  onSaved,
}: {
  projectId: string;
  study: Study;
  participant: Participant | null;
  onClose: () => void;
  onSaved: () => Promise<unknown>;
}) {
  const [form, setForm] = useState<Form>({
    name: participant?.name ?? "",
    contact_email: participant?.contact_email ?? "",
    scheduled_at: participant?.scheduled_at ?? "",
    role: participant?.role ?? "",
    company: participant?.company ?? "",
    characteristics: participant?.characteristics ?? "",
    // A new participant starts with the study's email, which can be changed for them.
    account_email: participant ? participant.account_email : study.account_email,
    account_password: participant?.account_password ?? "",
    account_notes: participant?.account_notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof Form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (participant) await updateParticipant(projectId, study.id, participant.id, form);
      else await addParticipant(projectId, study.id, form);
      onClose();
      await onSaved();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  };

  return (
    <Drawer
      open
      title={participant ? `Edit ${participant.code}` : "Add participant"}
      // The application address is the study's, shared by every participant; it is changed on the study.
      description={
        participant
          ? `They open ${study.app_url || "the study's application address (not set yet)"}.`
          : `With a contact email, they are sent the booking invite when you add them. They open ${
              study.app_url || "the study's application address (not set yet)"
            }.`
      }
      onClose={onClose}
      onSubmit={submit}
      width={520}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={saving}>
            {saving ? "Saving…" : participant ? "Save" : "Add participant"}
          </button>
        </>
      }
    >
      {error && (
        <div className="usab-warning" role="alert">
          {error}
        </div>
      )}
      <Field label="Name">
        <input className="input" value={form.name} onChange={set("name")} />
      </Field>
      {/* Where the booking emails go: their own inbox, not the test account. */}
      <Field label="Contact email">
        <input className="input" type="email" value={form.contact_email} onChange={set("contact_email")} />
      </Field>
      <Field label="Scheduled session">
        <input className="input" type="datetime-local" value={form.scheduled_at} onChange={set("scheduled_at")} />
      </Field>
      <Field label="Role">
        <input className="input" value={form.role} onChange={set("role")} />
      </Field>
      <Field label="Company">
        <input className="input" value={form.company} onChange={set("company")} />
      </Field>
      <Field label="Other characteristics">
        <textarea className="input textarea" rows={2} value={form.characteristics} onChange={set("characteristics")} />
      </Field>
      <Field label={study.content.sign_up ? "Email to sign up with" : "Test account email"}>
        <input
          className="input"
          autoComplete="off"
          value={form.account_email}
          placeholder={study.account_email}
          onChange={set("account_email")}
        />
      </Field>
      {/* A study that tests signing up has participants choose their own password. */}
      {!study.content.sign_up && (
        <Field label="Test account password">
          <input
            className="input"
            autoComplete="off"
            value={form.account_password}
            placeholder={study.account_password}
            onChange={set("account_password")}
          />
        </Field>
      )}
      <Field label="Anything else they need to sign in">
        <textarea
          className="input textarea"
          rows={2}
          value={form.account_notes}
          placeholder={study.account_notes}
          onChange={set("account_notes")}
        />
      </Field>
    </Drawer>
  );
}
