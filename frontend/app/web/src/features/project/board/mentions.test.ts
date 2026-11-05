import { describe, expect, it } from "vitest";
import { activeQuery, insertMention, matchPeople, mentionedIds, mentionToken, splitMentions, toEditable, toStored } from "./mentions";

const ADA = "11111111-1111-4111-8111-111111111111";
const ADAM = "22222222-2222-4222-8222-222222222222";
const names: Record<string, string> = { [ADA]: "Ada Lovelace", [ADAM]: "Ada" };

describe("stored mentions", () => {
  it("splits a comment into text and mentions", () => {
    expect(splitMentions(`hi ${mentionToken(ADA)}, see this`)).toEqual([
      { kind: "text", text: "hi " },
      { kind: "mention", userId: ADA },
      { kind: "text", text: ", see this" },
    ]);
  });

  it("leaves text without a well-formed token alone", () => {
    expect(splitMentions("mail me@[user:nope] or @Ada")).toEqual([{ kind: "text", text: "mail me@[user:nope] or @Ada" }]);
  });

  it("lists who is mentioned once each", () => {
    expect(mentionedIds(`${mentionToken(ADA)} ${mentionToken(ADAM)} ${mentionToken(ADA)}`)).toEqual([ADA, ADAM]);
  });
});

describe("composer round trip", () => {
  it("shows names and stores ids", () => {
    const body = `${mentionToken(ADA)} and ${mentionToken(ADAM)}: please check`;
    const { text, picked } = toEditable(body, (id) => names[id]);
    expect(text).toBe("@Ada Lovelace and @Ada: please check");
    expect(toStored(text, picked)).toBe(body);
  });

  it("never reads a longer name as a shorter one", () => {
    const picked = [
      { id: ADAM, name: "Ada" },
      { id: ADA, name: "Ada Lovelace" },
    ];
    expect(toStored("@Ada Lovelace, cc @Ada", picked)).toBe(`${mentionToken(ADA)}, cc ${mentionToken(ADAM)}`);
  });

  it("does not match a name inside a longer word", () => {
    expect(toStored("@Adams please", [{ id: ADAM, name: "Ada" }])).toBe("@Adams please");
  });

  it("only a pick makes a mention", () => {
    expect(toStored("@Ada Lovelace typed by hand", [])).toBe("@Ada Lovelace typed by hand");
  });
});

describe("typing a mention", () => {
  it("finds the query before the caret", () => {
    expect(activeQuery("hello @Ad", 9)).toEqual({ start: 6, query: "Ad" });
    expect(activeQuery("@", 1)).toEqual({ start: 0, query: "" });
    expect(activeQuery("ask @Ada Lo", 11)).toEqual({ start: 4, query: "Ada Lo" });
  });

  it("ignores an @ inside a word or an email", () => {
    expect(activeQuery("me@example", 10)).toBeNull();
    expect(activeQuery("no mention here", 15)).toBeNull();
  });

  it("matches names starting with the query first", () => {
    const people = [{ name: "Brenda Ada" }, { name: "Ada Lovelace" }, { name: "Charles" }];
    expect(matchPeople(people, "ada").map((p) => p.name)).toEqual(["Ada Lovelace", "Brenda Ada"]);
    expect(matchPeople(people, "")).toHaveLength(3);
  });

  it("replaces the query with the picked name", () => {
    expect(insertMention("hi @Ad there", 3, 6, "Ada Lovelace")).toEqual({ text: "hi @Ada Lovelace  there", caret: 17 });
  });
});
