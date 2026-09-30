// On a phone ListTable draws each row as a card, and a cell can only say which
// column it belongs to through its own data-label -- the heading row is gone.
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { columnLabel, ListTable } from "./ListTable";

describe("columnLabel", () => {
  it("is the header when that is text", () => {
    expect(columnLabel({ header: "Updated" })).toBe("Updated");
  });
  it("prefers an explicit label", () => {
    expect(columnLabel({ header: <i>Up</i>, label: "Updated" })).toBe("Updated");
  });
  it("is absent for an empty or non-text header", () => {
    expect(columnLabel({ header: "" })).toBeUndefined();
    expect(columnLabel({ header: <i>Up</i> })).toBeUndefined();
  });
});

describe("ListTable", () => {
  it("labels every cell with its column and wraps the table in a scroller", () => {
    const html = renderToString(
      <MemoryRouter>
        <ListTable
          columns={[
            { header: "Name", className: "primary", render: (r: { n: string }) => r.n },
            { header: "Role", render: () => "Admin" },
          ]}
          rows={[{ n: "Ada" }]}
          rowKey={(r) => r.n}
          empty="None"
        />
      </MemoryRouter>,
    );
    expect(html).toContain('<div class="list-scroll"><table class="data-table list-table">');
    expect(html).toContain('<td class="primary" data-label="Name">Ada</td>');
    expect(html).toContain('<td data-label="Role">Admin</td>');
  });
});
