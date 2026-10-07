// The device stage: how a framed wireframe (mobile, tablet) is fitted into the
// canvas area.
//
// The design canvas is a fixed logical resolution — a phone is 390×844 on
// every monitor, so a wireframe lays out the same for everyone who opens it.
// That resolution is almost always taller than the room the studio has, so the
// stage is *scaled* to fit rather than resized: the whole screen stays visible
// without the mat scrolling to find the bottom of the device, and the design
// still measures 844px. Content taller than the screen scrolls inside the
// device, exactly as it would on the hardware.
//
// Scaling costs one thing, and `stageScale` below is the price: the browser
// reports two different pixels inside a scaled stage. `getBoundingClientRect`
// and pointer coordinates come back in *screen* pixels (scaled), while
// `clientWidth`, `scrollWidth`, `offsetWidth` and everything the document
// stores are in the device's *own* pixels. Any screen-space measurement that
// becomes a stored size, or is compared with a layout value, must be divided
// by the scale first.
import { CSSProperties, ReactNode, RefObject, useLayoutEffect, useState } from "react";
import type { InterfaceType } from "../project/wireframes/wireframesApi";

/** Logical CSS resolution of each framed device. Desktop is unframed — it
 *  fills the mat and widens for its fixed-px columns — so it has no entry. */
export const DEVICE_SIZE: Partial<Record<InterfaceType, { w: number; h: number }>> = {
  mobile: { w: 390, h: 844 },
  tablet: { w: 768, h: 1024 },
  tablet_landscape: { w: 1024, h: 768 },
};

export interface StageFit {
  /** Screen pixels per device pixel; 1 when the device fits at full size. */
  scale: number;
  /** The footprint the mat lays out and centres: the device's scaled size. */
  box: CSSProperties;
  /** The device itself, at its logical resolution, scaled down to fit. */
  device: CSSProperties;
}

/** Fit a framed device into the canvas area it is given. Only ever shrinks:
 *  there is nothing to gain from magnifying a phone past its own resolution.
 *  Returns null for desktop, which is not framed.
 *
 *  `widthOnly` fits the width alone and lets the mat scroll to the rest -- the
 *  preview on a phone, where fitting the height as well would shrink a phone
 *  wireframe to little more than half the screen it is being looked at on. */
export function useStageFit(wrap: RefObject<HTMLElement | null>, type: InterfaceType, widthOnly = false): StageFit | null {
  const size = DEVICE_SIZE[type] ?? null;
  const [scale, setScale] = useState(1);

  // Layout effect, not effect: the scale is part of the first paint, so a
  // device switch never flashes at the outgoing device's scale.
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el || !size) return;
    const measure = () => {
      const cs = getComputedStyle(el);
      const room = {
        w: el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
        h: el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom),
      };
      // A collapsed or not-yet-laid-out panel measures zero; keep the last
      // good scale rather than collapsing the device to nothing.
      if (room.w <= 0 || room.h <= 0) return;
      setScale(Math.min(1, room.w / size.w, widthOnly ? Infinity : room.h / size.h));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [wrap, size, widthOnly]);

  if (!size) return null;
  return {
    scale,
    box: { width: size.w * scale, height: size.h * scale },
    device: { width: size.w, height: size.h, transform: scale < 1 ? `scale(${scale})` : undefined },
  };
}

/** The width a desktop wireframe is designed at: below this much room the
 *  page is not re-flowed (squeezing its flexible columns while the fixed ones
 *  hold) but drawn at this width and scaled down whole, so every region
 *  shrinks in proportion and the page always fits the canvas (FS-REQ-37).
 *  At or above it the desktop page fills the room as before. */
export const DESKTOP_DESIGN_W = 960;
/** Least width a flexible column is counted at when working out how wide a
 *  page must be drawn (see fixedWidthDemand's flexFloor). */
export const DESKTOP_FLEX_FLOOR = 240;

/** Fit an unframed desktop page into the canvas width. Returns null while the
 *  room is at least `designWidth` — the page then fills it, unscaled. Below
 *  that the page is laid out at `designWidth` and scaled to the room's width;
 *  its height still grows with its content (the mat scrolls vertically), so
 *  the scaled footprint is re-measured whenever the page's height changes. */
export function useDesktopFit(wrap: RefObject<HTMLElement | null>, designWidth: number, enabled: boolean): StageFit | null {
  const [room, setRoom] = useState<{ w: number; h: number } | null>(null);
  const [deviceH, setDeviceH] = useState(0);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el || !enabled) return;
    const measure = () => {
      const cs = getComputedStyle(el);
      const w = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const h = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      if (w <= 0 || h <= 0) return;
      setRoom((r) => (r && r.w === w && r.h === h ? r : { w, h }));
      const device = el.querySelector<HTMLElement>(":scope > .stage > .device");
      if (device) setDeviceH(device.offsetHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    const device = el.querySelector<HTMLElement>(":scope > .stage > .device");
    if (device) observer.observe(device);
    return () => observer.disconnect();
  }, [wrap, enabled]);

  if (!enabled || !room || room.w >= designWidth) return null;
  const scale = room.w / designWidth;
  const minHeight = room.h / scale;
  return {
    scale,
    box: { width: room.w, height: Math.max(minHeight, deviceH) * scale },
    device: { width: designWidth, minHeight, transform: `scale(${scale})` },
  };
}

/** The box a framed device sits in. `transform` scales what you see but leaves
 *  layout at full size, so without this the mat would still scroll to a device
 *  that only *looks* like it fits. Desktop renders no wrapper at all — its
 *  device stays a direct flex child of the mat, which its sizing relies on. */
export function Stage({ fit, desktop = false, children }: { fit: StageFit | null; desktop?: boolean; children: ReactNode }) {
  // Desktop always renders its wrapper — box-less (display: contents) until
  // it is fitted — so crossing the fit threshold while the window resizes
  // never remounts the canvas underneath.
  if (desktop) {
    return (
      <div className={`stage desktop${fit ? " fitted" : ""}`} style={fit?.box}>
        {children}
      </div>
    );
  }
  if (!fit) return <>{children}</>;
  return (
    <div className="stage" style={fit.box}>
      {children}
    </div>
  );
}

/** Screen pixels per device pixel at `node`, read live off the DOM rather than
 *  passed down: the scale is a property of where a node sits, and the handlers
 *  that need it are spread across the canvas. 1 outside a scaled stage, so
 *  dividing by it is a no-op on desktop. */
export function stageScale(node: Element | null | undefined): number {
  const device = node?.closest?.(".device") as HTMLElement | null | undefined;
  const width = device?.offsetWidth;
  if (!device || !width) return 1;
  return device.getBoundingClientRect().width / width;
}
