// A wireframe shell: the split with a vertical navbar in "Nav" and the
// "Content" region every other page is placed into. On narrow screens the
// sidebar collapses into a navigation drawer behind a menu button.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { HostOutlet, usePageLink, useShownLocation } from "../lib/nav";
import { Icon, IconName } from "./icons";

export interface NavItem {
  label: string;
  pageId: string;
  icon: IconName;
}

export function Wordmark() {
  return (
    <span className="wordmark">
      <span className="wordmark-mark" aria-hidden="true">
        T
      </span>
      <span>True Sales AI</span>
    </span>
  );
}

export function Shell({ items, label }: { items: NavItem[]; label: string }) {
  const [open, setOpen] = useState(false);
  const shown = useShownLocation();
  useEffect(() => setOpen(false), [shown.pathname]);

  return (
    <div className={`shell${open ? " nav-open" : ""}`}>
      <header className="mobile-bar">
        <button className="icon-button" aria-label="Open navigation" aria-expanded={open} onClick={() => setOpen(true)}>
          <Icon name="menu" size={20} />
        </button>
        <Wordmark />
      </header>
      <div className="nav-scrim" onClick={() => setOpen(false)} aria-hidden="true" />
      <nav className="sidebar" aria-label={label}>
        <div className="sidebar-head">
          <Wordmark />
          <button className="icon-button sidebar-close" aria-label="Close navigation" onClick={() => setOpen(false)}>
            <Icon name="close" />
          </button>
        </div>
        <div className="nav-list">
          {items.map((item) => (
            <SideLink key={item.pageId} {...item} />
          ))}
        </div>
      </nav>
      <main className="content">
        <HostOutlet fallbackPageId={items[0].pageId} />
      </main>
    </div>
  );
}

function SideLink({ label, pageId, icon }: NavItem) {
  const { href, active } = usePageLink(pageId);
  return (
    <Link to={href} className={`nav-item${active ? " active" : ""}`} aria-current={active ? "page" : undefined}>
      <Icon name={icon} />
      {label}
    </Link>
  );
}
