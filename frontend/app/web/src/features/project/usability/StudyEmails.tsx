// The Emails sub-section of a study: the words of the two booking emails.
// The invite goes when a participant with a contact email is added; the
// confirmation when they book. Studio adds the parts that must always be
// there (the Choose a time button; the time, Meet link and rebooking link),
// so only the words around them are edited here. Saved as you go.
import { AutosaveStatus } from "../../../components/AutosaveStatus";
import { useAutosave } from "../../../core/useAutosave";
import { Card, Labelled, Paragraphs } from "./StudyEditor";
import { EMAIL_PLACEHOLDERS, Study, StudyContent, updateStudy } from "./usabilityApi";

const EMAIL_KINDS = [
  { id: "invite", label: "Booking invite", note: "Sent when a participant is added; a Choose a time button follows" },
  { id: "confirmation", label: "Booking confirmation", note: "Sent when they book; the time, Meet link and rebooking link follow" },
] as const;

export function StudyEmails({
  projectId,
  study,
  onSaved,
}: {
  projectId: string;
  study: Study;
  onSaved: () => Promise<unknown>;
}) {
  // The emails live in the study's content, which is saved whole.
  const auto = useAutosave<{ content: StudyContent }>(
    { content: study.content },
    {
      save: async (f) => {
        await updateStudy(projectId, study.id, { content: f.content });
        await onSaved();
      },
    },
  );
  const emails = auto.value.content.emails;
  const setEmail = (kind: keyof StudyContent["emails"], patch: Partial<StudyContent["emails"]["invite"]>) =>
    auto.set((f) => ({
      content: { ...f.content, emails: { ...f.content.emails, [kind]: { ...f.content.emails[kind], ...patch } } },
    }));

  return (
    <div className="stack" onBlur={() => void auto.flush()}>
      <div className="row">
        <AutosaveStatus auto={auto} />
        <span className="shell-spacer" />
        <span className="muted">Placeholders: {EMAIL_PLACEHOLDERS.map((p) => `{${p}}`).join(", ")}</span>
      </div>
      {EMAIL_KINDS.map((kind) => (
        <Card key={kind.id} title={kind.label} note={kind.note}>
          <Labelled label="Subject">
            <input className="input" value={emails[kind.id].subject} onChange={(e) => setEmail(kind.id, { subject: e.target.value })} />
          </Labelled>
          <Paragraphs
            label={`${kind.label} paragraph`}
            value={emails[kind.id].body}
            onChange={(body) => setEmail(kind.id, { body })}
            addLabel="Add paragraph"
          />
        </Card>
      ))}
    </div>
  );
}
