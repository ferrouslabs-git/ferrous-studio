// Minimal safe markdown renderer, ported from software-management's
// mdToHtml (static/js/docs.js): escape everything first, then rebuild a
// small subset (headings, bold/italic/code/links, lists, blockquotes, hr,
// paragraphs, fenced code). ```mermaid fences are the one special-cased
// language -- rendered as diagrams once the HTML is in the DOM.
//
// mermaid is dynamically imported so it's only pulled into a separate chunk
// the first time a doc actually has a mermaid fence in it, not on every page
// load -- same lazy-load intent as the reference app's loadScriptOnce.
import { useEffect, useRef } from "react";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function inline(s: string): string {
  return s
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/\*([^*]+)\*/g, "<i>$1</i>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, `<a href="$2" target="_blank" rel="noopener">$1</a>`);
}

function mdToHtml(md: string): string {
  let html = "";
  let inCode = false;
  let codeLang = "";
  let list: "ul" | "ol" | null = null;
  let para: string[] = [];
  const closeList = () => {
    if (list) {
      html += `</${list}>`;
      list = null;
    }
  };
  const flush = () => {
    if (para.length) {
      html += "<p>" + inline(para.join(" ")) + "</p>";
      para = [];
    }
  };
  for (const raw of String(md ?? "").split("\n")) {
    const line = esc(raw);
    const fence = line.trim().match(/^```(\S*)/);
    if (fence) {
      flush();
      closeList();
      if (!inCode) {
        codeLang = fence[1] || "";
        html += codeLang === "mermaid" ? `<pre class="mermaid">` : "<pre><code>";
      } else {
        html += codeLang === "mermaid" ? "</pre>" : "</code></pre>";
        codeLang = "";
      }
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      html += line + "\n";
      continue;
    }
    const h = line.match(/^(#{1,3})\s+(.*)/);
    if (h) {
      flush();
      closeList();
      const level = h[1].length;
      html += `<h${level}>${inline(h[2])}</h${level}>`;
      continue;
    }
    if (/^\s*---+\s*$/.test(line)) {
      flush();
      closeList();
      html += "<hr>";
      continue;
    }
    if (/^&gt;\s?/.test(line.trim())) {
      flush();
      closeList();
      html += `<blockquote>${inline(line.trim().replace(/^&gt;\s?/, ""))}</blockquote>`;
      continue;
    }
    const ul = line.match(/^\s*[-*]\s+(.*)/);
    const ol = line.match(/^\s*\d+\.\s+(.*)/);
    if (ul || ol) {
      flush();
      const want = ul ? "ul" : "ol";
      if (list !== want) {
        closeList();
        html += `<${want}>`;
        list = want;
      }
      html += `<li>${inline((ul ?? ol)![1])}</li>`;
      continue;
    }
    if (!line.trim()) {
      flush();
      closeList();
      continue;
    }
    para.push(line);
  }
  flush();
  closeList();
  if (inCode) html += codeLang === "mermaid" ? "</pre>" : "</code></pre>";
  return html;
}

export function MarkdownWithMermaid({ body }: { body: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const html = mdToHtml(body);

  useEffect(() => {
    const container = ref.current;
    const nodes = [...(container?.querySelectorAll<HTMLElement>(".mermaid") ?? [])];
    if (!nodes.length) return;
    let cancelled = false;
    import("mermaid").then(({ default: mermaid }) => {
      if (cancelled) return;
      mermaid.initialize({
        startOnLoad: false,
        theme: document.documentElement.dataset.theme === "dark" ? "dark" : "default",
      });
      return mermaid.run({ nodes });
    }).catch(() => {
      for (const n of nodes) if (!n.querySelector("svg")) n.textContent = "Couldn't render this diagram.";
    });
    return () => {
      cancelled = true;
    };
  }, [html]);

  if (!body.trim()) return <span className="muted">Empty.</span>;
  // eslint-disable-next-line react/no-danger -- html is built entirely from
  // esc()-escaped input above; nothing here comes back out unescaped.
  return <div ref={ref} className="md-body" dangerouslySetInnerHTML={{ __html: html }} />;
}
