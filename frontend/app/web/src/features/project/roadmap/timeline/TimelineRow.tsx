// One row of the roadmap: a label column, a meta column, and the track the
// bars sit in. Purely presentational -- the release head, sprint, epic and
// requirement rows all use it, differing only in class and content. The id
// rides on a data attribute rather than being parsed back out of the label
// (an epic titled "Auth · SSO" would otherwise break the drill-in), as in
// the reference app's tlRow (static/js/timeline.js).
import type { MouseEvent, ReactNode, Ref } from "react";

export interface TimelineRowProps {
  /** Row kind classes: "tl-release tl-cardhead", "tl-sprint tl-sp-active", … */
  cls: string;
  label: string;
  /** An icon before the label. */
  pre?: ReactNode;
  meta?: ReactNode;
  /** The track's content: a bar, a marker, or a "no dates" note. */
  children?: ReactNode;
  id?: string;
  onClick?: (e: MouseEvent<HTMLDivElement>) => void;
  rowRef?: Ref<HTMLDivElement>;
  /** Transient state classes (dragging). */
  className?: string;
}

export function TimelineRow({ cls, label, pre, meta, children, id, onClick, rowRef, className }: TimelineRowProps) {
  return (
    <div ref={rowRef} className={`tl-row ${cls}${className ? ` ${className}` : ""}`} data-id={id} onClick={onClick}>
      <div className="tl-label" title={label}>
        {pre}
        {label}
      </div>
      <div className="tl-meta">{meta}</div>
      <div className="tl-track">{children}</div>
    </div>
  );
}
