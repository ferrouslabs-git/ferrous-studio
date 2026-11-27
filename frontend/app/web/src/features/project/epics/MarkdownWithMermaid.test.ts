import { describe, expect, it } from "vitest";
import { mdToHtml } from "./MarkdownWithMermaid";

describe("markdown tables", () => {
  it("renders a pipe table with a header row", () => {
    const html = mdToHtml("| You're asked for | Use |\n|---|---|\n| Email | The **one** your moderator gives you |\n\nAfter.");
    expect(html).toContain(`<div class="md-table"><table><thead><tr><th>You're asked for</th><th>Use</th></tr></thead>`);
    expect(html).toContain("<tbody><tr><td>Email</td><td>The <b>one</b> your moderator gives you</td></tr></tbody></table></div>");
    expect(html).toContain("<p>After.</p>");
  });
  it("escapes cell text like any other line", () => {
    expect(mdToHtml("| <script>x</script> |")).not.toContain("<script>");
  });
  it("leaves a table with no separator as plain rows", () => {
    expect(mdToHtml("| a | b |\n| c | d |")).toBe("<div class=\"md-table\"><table><tbody><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></tbody></table></div>");
  });
});
