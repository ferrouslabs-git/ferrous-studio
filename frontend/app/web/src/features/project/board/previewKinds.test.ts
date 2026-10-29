import { describe, expect, it } from "vitest";
import { isHtmlAttachment, previewKindFor, uploaderName } from "./previewKinds";

describe("HTML attachments", () => {
  const page = { filename: "report.html", content_type: "text/html" };

  it("are recognised by type or by extension", () => {
    expect(isHtmlAttachment(page)).toBe(true);
    expect(isHtmlAttachment({ filename: "mock.htm", content_type: "" })).toBe(true);
    expect(isHtmlAttachment({ filename: "notes.txt", content_type: "text/plain" })).toBe(false);
    expect(isHtmlAttachment({ filename: "data.json", content_type: "application/json" })).toBe(false);
  });

  it("get no preview inside the app -- they open from storage instead", () => {
    expect(previewKindFor(page)).toBeNull();
  });
});

describe("uploaderName", () => {
  const memberName = (id: string | null | undefined) => (id === "u1" ? "Elliott" : "someone");

  it("names the agent for an agent's upload", () => {
    expect(uploaderName({ agent_name: "Builder", created_by: "u1" }, memberName)).toBe("Builder (agent)");
  });

  it("names the person otherwise", () => {
    expect(uploaderName({ agent_name: null, created_by: "u1" }, memberName)).toBe("Elliott");
    expect(uploaderName({ created_by: "u1" }, memberName)).toBe("Elliott");
  });
});
