// A "⋯" button opening a right-aligned menu of row actions, for list tables
// where a strip of buttons per row would be too noisy. Items are plain
// callbacks; navigation items should call useNavigate in their handler.
//
// The menu is fixed to the window, placed from the button's position, rather
// than hung off the row: a table narrower than its columns scrolls inside its
// panel, and that scroller would clip a menu positioned inside it. A fixed
// menu cannot follow the row as the page moves, so scrolling closes it.
import { CSSProperties, useEffect, useLayoutEffect, useRef, useState } from "react";

export interface RowMenuItem {
  label: string;
  onSelect: () => void;
  /** Destructive actions render in the warning colour. */
  danger?: boolean;
}

export function RowMenu({ label = "Actions", items }: { label?: string; items: RowMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<CSSProperties>({ visibility: "hidden" });

  // Right-aligned under the button, or above it when the window has no room
  // below -- the last rows of a long list sit at the bottom of the screen.
  useLayoutEffect(() => {
    if (!open) return;
    const b = buttonRef.current?.getBoundingClientRect();
    const h = popRef.current?.offsetHeight ?? 0;
    if (!b) return;
    const below = b.bottom + 4 + h <= window.innerHeight - 8 || b.top - 4 - h < 8;
    setPlace({
      right: Math.max(8, window.innerWidth - b.right),
      ...(below ? { top: b.bottom + 4 } : { top: b.top - 4 - h }),
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    // Capture: a scroll inside any container, not just the page.
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      setPlace({ visibility: "hidden" });
    };
  }, [open]);

  return (
    <div className="row-menu" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="btn small ghost"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        ⋯
      </button>
      {open && (
        <div className="row-menu-pop" role="menu" ref={popRef} style={place}>
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              className={item.danger ? "row-menu-item danger" : "row-menu-item"}
              role="menuitem"
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
