// The Page list in the link menu offers every page, not only top-level ones:
// the page a list's Edit button should open is usually placed in a region
// (FS-REQ-27), and a nav item already links to placed pages.
import { describe, expect, it } from "vitest";
import type { PageSummary } from "../../projects/projectsApi";
import { linkChoices } from "./LinkPicker";

const page = (id: string, name: string, parent?: string): PageSummary =>
  ({ id, name, route: null, placement: parent ? { page_id: parent, region_id: "r" } : null, presentation: null }) as unknown as PageSummary;

describe("linkChoices", () => {
  const home = page("home", "Home");
  const users = page("users", "Users", "home");
  const edit = page("edit", "Edit", "users");
  const standalone = page("login", "Login");

  it("lists placed pages too, so an existing Edit page can be linked", () => {
    expect(linkChoices([home, users, edit]).map((c) => c.page.id)).toEqual(["home", "users", "edit"]);
  });

  it("puts top-level pages first and names a placed page by its path", () => {
    const choices = linkChoices([users, edit, home, standalone]);
    expect(choices.map((c) => c.label)).toEqual(["Home", "Login", "Home ▸ Users", "Home ▸ Users ▸ Edit"]);
  });

  it("still lists an orphan (its parent is gone) as a top-level page", () => {
    const orphan = page("o", "Orphan", "deleted");
    expect(linkChoices([home, orphan]).map((c) => c.label)).toEqual(["Home", "Orphan"]);
  });
});
