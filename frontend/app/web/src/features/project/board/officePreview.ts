// Word and Excel previews: conversions, not the document -- pagination and
// formatting do not survive, and each carries a note saying so. The
// converters are loaded on first use; most sessions never open one.
//
// mammoth performs no sanitisation of the source document, so its HTML goes
// through DOMPurify before it reaches the DOM, and links/images are then
// held to the same rules the reference app applied: only http(s)/mailto
// hrefs (opened in a new tab), only data:/https images.
import DOMPurify from "dompurify";
import { SHEET_ROW_LIMIT } from "./previewKinds";

function note(text: string): HTMLElement {
  const n = document.createElement("div");
  n.className = "att-conv-note";
  n.textContent = text;
  return n;
}

function sanitiseInto(target: HTMLElement, html: string): void {
  target.innerHTML = DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, ADD_ATTR: ["target"] });
  for (const a of target.querySelectorAll("a")) {
    const href = a.getAttribute("href") ?? "";
    if (/^(https?:|mailto:)/i.test(href)) {
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener");
    } else a.removeAttribute("href");
  }
  for (const img of target.querySelectorAll("img")) {
    if (!/^(data:image\/|https?:)/i.test(img.getAttribute("src") ?? "")) img.removeAttribute("src");
  }
}

export async function renderDocx(buf: ArrayBuffer): Promise<HTMLElement> {
  const mammoth = await import("mammoth");
  const { value } = await mammoth.convertToHtml({ arrayBuffer: buf });
  const wrap = document.createElement("div");
  wrap.className = "att-doc";
  const doc = document.createElement("div");
  sanitiseInto(doc, value || "<p><i>This document has no readable body text.</i></p>");
  wrap.append(doc, note("Converted preview — download for the original formatting."));
  return wrap;
}

// One table per sheet, tabs across the top when there is more than one. Big
// sheets are capped by narrowing the worksheet's own range before rendering.
export async function renderXlsx(buf: ArrayBuffer): Promise<HTMLElement> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buf, { type: "array" });
  const wrap = document.createElement("div");
  wrap.className = "att-sheet";
  const tabs = document.createElement("div");
  tabs.className = "att-sheet-tabs";
  const pane = document.createElement("div");
  pane.className = "att-sheet-pane";

  const draw = (name: string) => {
    const ws = wb.Sheets[name];
    const ref = ws?.["!ref"];
    let total = 0;
    if (ws && ref) {
      const r = XLSX.utils.decode_range(ref);
      total = r.e.r - r.s.r + 1;
      if (total > SHEET_ROW_LIMIT) {
        r.e.r = r.s.r + SHEET_ROW_LIMIT - 1;
        ws["!ref"] = XLSX.utils.encode_range(r);
      }
      sanitiseInto(pane, XLSX.utils.sheet_to_html(ws));
      ws["!ref"] = ref; // restore, so a redraw is not lossy
    } else {
      pane.innerHTML = "";
      pane.appendChild(note("This sheet is empty."));
    }
    if (total > SHEET_ROW_LIMIT) pane.appendChild(note(`First ${SHEET_ROW_LIMIT} of ${total} rows — download for the whole sheet.`));
    for (const b of tabs.children) b.classList.toggle("on", (b as HTMLElement).dataset.sheet === name);
  };

  for (const name of wb.SheetNames) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn mini-x";
    b.textContent = name;
    b.dataset.sheet = name;
    b.addEventListener("click", () => draw(name));
    tabs.appendChild(b);
  }
  if (wb.SheetNames.length > 1) wrap.appendChild(tabs);
  wrap.appendChild(pane);
  if (!wb.SheetNames.length) pane.appendChild(note("No sheets in this workbook."));
  else draw(wb.SheetNames[0]);
  return wrap;
}
