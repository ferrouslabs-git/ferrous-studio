// The chrome of a page that has a `presentation`: a modal in the middle, or a
// drawer from the right or left edge. Closing it goes back, which is also
// what a wireframe's "@back" link does.
import { ReactNode, useEffect, useRef } from "react";
import type { Presentation } from "../pages";
import { Icon } from "../ui/icons";
import { BACK, useGo } from "./nav";

export function Overlay({
  presentation,
  title,
  children,
}: {
  presentation: Presentation;
  title: string;
  children: ReactNode;
}) {
  const go = useGo();
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") go(BACK);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);
  useEffect(() => {
    const first = panel.current?.querySelector<HTMLElement>(
      ".overlay-body input, .overlay-body select, .overlay-body textarea",
    );
    (first ?? panel.current?.querySelector<HTMLElement>("button"))?.focus();
  }, []);

  return (
    <div className="overlay-scrim" onClick={() => go(BACK)}>
      <section
        ref={panel}
        className={`overlay overlay-${presentation}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="overlay-head">
          <h2>{title}</h2>
          <button className="icon-button" aria-label="Close" onClick={() => go(BACK)}>
            <Icon name="close" />
          </button>
        </header>
        <div className="overlay-body">{children}</div>
      </section>
    </div>
  );
}
