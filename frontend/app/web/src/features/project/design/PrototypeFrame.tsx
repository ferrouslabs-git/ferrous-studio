// The frame a design is shown in: the site published from its Figma Make file.
//
// The site is on figma.site, another origin, so the browser already keeps it
// away from Studio's DOM, storage, cookies and API; Studio's CSP lets a frame
// load from https://*.figma.site and nowhere else. The sandbox adds the rest:
//   * allow-same-origin gives the site its OWN origin (figma.site), which it
//     needs for its own storage. It never grants Studio's, because the frame
//     is cross-origin; a script inside cannot reach this element to lift its
//     sandbox.
//   * no allow-top-navigation, allow-popups or allow-modals -- it cannot
//     move Studio away, open windows, or put up dialogs.
// allow-forms is listed because without it the browser drops a form's submit
// event, and a prototype's "Save" button is usually a form submit.
export const PROTOTYPE_SANDBOX = "allow-scripts allow-forms allow-same-origin";

export function PrototypeFrame({ url, title }: { url: string; title: string }) {
  return <iframe className="design-frame" src={url} title={title} sandbox={PROTOTYPE_SANDBOX} referrerPolicy="no-referrer" />;
}
