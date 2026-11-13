// The frame a design revision is shown in.
//
// A revision is generated HTML with its own inline script. Studio's CSP
// (script-src 'self') refuses to run that on Studio's origin, and should: so
// the file is loaded from the storage bucket's origin instead, in a sandbox.
//
// The sandbox is the security boundary, and what it leaves out matters more
// than what it lists:
//   * no allow-same-origin -- the prototype runs in an opaque origin, so it
//     cannot read Studio's storage or cookies, cannot call Studio's API as
//     the signed-in user, and cannot reach this page's DOM;
//   * no allow-top-navigation, allow-popups or allow-modals -- it cannot
//     move Studio away, open windows, or put up dialogs.
// allow-forms is listed because without it the browser drops a form's submit
// event entirely, and a prototype's "Save" button is usually a form submit
// handled in script. It grants nothing the script could not already do.
export const PROTOTYPE_SANDBOX = "allow-scripts allow-forms";

export function PrototypeFrame({ url, title }: { url: string; title: string }) {
  return <iframe className="design-frame" src={url} title={title} sandbox={PROTOTYPE_SANDBOX} referrerPolicy="no-referrer" />;
}
