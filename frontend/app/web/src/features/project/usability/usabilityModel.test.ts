import { describe, expect, it } from "vitest";
import type { Insights, StudyTask } from "./usabilityApi";
import {
  clock,
  formatSize,
  linesToList,
  metricsCsv,
  moveItem,
  newTask,
  num,
  observationsCsv,
  parseClock,
  parseStudyFile,
  participantLink,
  progressLabel,
  slug,
  successMark,
  toCsv,
} from "./usabilityModel";

describe("times", () => {
  it("shows seconds as minutes:seconds", () => {
    expect(clock(95)).toBe("1:35");
    expect(clock(5)).toBe("0:05");
    expect(clock(0)).toBe("0:00");
    expect(clock(null)).toBe("–");
  });
  it("reads a time back, as m:ss or as seconds", () => {
    expect(parseClock("1:35")).toBe(95);
    expect(parseClock(" 95 ")).toBe(95);
    expect(parseClock("2:5")).toBe(125);
    expect(parseClock("1:75")).toBeNull();
    expect(parseClock("soon")).toBeNull();
  });
});

describe("a participant's progress", () => {
  const at = (progress: { consented: boolean; tasks_rated: number; tasks_total: number; completed: boolean }) =>
    progressLabel({ progress }).text;
  it("moves from not started to finished", () => {
    expect(at({ consented: false, tasks_rated: 0, tasks_total: 9, completed: false })).toBe("Not started");
    expect(at({ consented: true, tasks_rated: 0, tasks_total: 9, completed: false })).toBe("Consent given");
    expect(at({ consented: true, tasks_rated: 4, tasks_total: 9, completed: false })).toBe("4 of 9 tasks rated");
    expect(at({ consented: true, tasks_rated: 9, tasks_total: 9, completed: true })).toBe("Finished");
  });
});

describe("the participant link", () => {
  it("is the public study page on this site", () => {
    expect(participantLink("abc_123", "https://studio.example")).toBe("https://studio.example/study/abc_123");
  });
});

describe("editing tasks", () => {
  it("gives a new task an id of its own that the server accepts", () => {
    const a = newTask();
    const b = newTask();
    expect(a.id).toMatch(/^[a-z0-9]{8}$/);
    expect(a.id).not.toBe(b.id);
    expect(a.answer_prompt).toBeNull();
  });
  it("moves a task without losing any, and ignores a move off the end", () => {
    const tasks = ["a", "b", "c"];
    expect(moveItem(tasks, 0, 1)).toEqual(["b", "a", "c"]);
    expect(moveItem(tasks, 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveItem(tasks, 0, -1)).toBe(tasks);
    expect(moveItem(tasks, 2, 3)).toBe(tasks);
  });
  it("reads a word list one per line, without blanks or repeats", () => {
    expect(linesToList("Clear\n\n  Slow \r\nClear\nUseful")).toEqual(["Clear", "Slow", "Useful"]);
  });
});

describe("small formatters", () => {
  it("marks an outcome", () => {
    expect(successMark("complete")).toBe("✓");
    expect(successMark("help")).toBe("help");
    expect(successMark("fail")).toBe("✗");
    expect(successMark(null)).toBe("–");
  });
  it("shows a number or a dash", () => {
    expect(num(6.25)).toBe("6.3");
    expect(num(6.25, 2)).toBe("6.25");
    expect(num(null)).toBe("–");
  });
  it("names a file after the study", () => {
    expect(slug("Developer test, pilot round")).toBe("developer-test-pilot-round");
    expect(slug("???")).toBe("study");
  });
  it("shows a file size", () => {
    expect(formatSize(8)).toBe("8 B");
    expect(formatSize(2048)).toBe("2.0 KB");
    expect(formatSize(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});

describe("importing a study file", () => {
  it("reads an exported study", () => {
    const task = { ...newTask(), title: "Create it" } as StudyTask;
    const parsed = parseStudyFile(
      JSON.stringify({ name: " Pilot ", duration: "about 60 minutes", content: { tasks: [task] }, files: [{ name: "a.csv", content_type: "text/csv", data_base64: "YQ==" }] }),
    );
    expect("error" in parsed).toBe(false);
    if ("error" in parsed) return;
    expect(parsed.name).toBe("Pilot");
    expect(parsed.duration).toBe("about 60 minutes");
    expect(parsed.content.tasks[0].title).toBe("Create it");
    expect(parsed.files).toHaveLength(1);
  });
  it("says what is wrong with a file that is not one", () => {
    expect(parseStudyFile("not json")).toEqual({ error: "This is not a study file: it is not valid JSON." });
    expect(parseStudyFile("[1,2]")).toEqual({ error: "This is not a study file." });
    expect(parseStudyFile('{"name":"x"}')).toEqual({ error: "This file has no study content in it." });
  });
  it("names an unnamed study and tolerates a missing file list", () => {
    const parsed = parseStudyFile('{"content":{"tasks":[]}}');
    expect(parsed).toMatchObject({ name: "Imported study", files: [] });
  });
});

describe("exports", () => {
  const stat = { count: 1, mean: null, sd: null, ci95: null };
  const insights: Insights = {
    research_questions: [],
    tasks: [{ id: "t1", title: "Create the function" }],
    participants: [
      { id: "p1", code: "P1", role: "", company: "", completed: true },
      { id: "p2", code: "P2", role: "", company: "", completed: false },
    ],
    observations: [
      { id: "o1", task_id: "t1", text: 'Did not find "Import", gave up', solution: "Label it", notes: "", participant_ids: ["p2"] },
      { id: "o2", task_id: "gone", text: "Liked the layout", solution: "", notes: "", participant_ids: ["p1", "p2"] },
    ],
    metrics: [
      {
        task_id: "t1",
        title: "Create the function",
        rows: [
          { participant_id: "p1", task_id: "t1", rating: 8, answer: "", time_seconds: 60, errors: 0, success: "complete", observations: "" },
          { participant_id: "p2", task_id: "t1", rating: null, answer: "", time_seconds: null, errors: null, success: null, observations: "" },
        ],
        success: { ...stat, mean: 1 },
        time_seconds: { ...stat, mean: 60 },
        errors: { ...stat, mean: 0 },
        rating: { ...stat, mean: 8 },
      },
    ],
    words: [],
  };

  it("quotes only the cells that need it", () => {
    expect(toCsv([["a", "b,c", 'say "hi"', null, 3]])).toBe('a,"b,c","say ""hi""",,3');
  });
  it("writes the measures as the spreadsheet lays them out", () => {
    const lines = metricsCsv(insights).split("\r\n");
    expect(lines[0]).toBe(",Task 1,,,");
    expect(lines[1]).toBe("Participant,Success,Time (s),Errors,Satisfaction");
    expect(lines[2]).toBe("P1,complete,60,0,8");
    expect(lines[3]).toBe("P2,,,,");
    expect(lines[4]).toBe("Mean,1,60,0,8");
    expect(lines[5]).toBe("Count,1,1,1,1");
    expect(lines[6]).toBe("Standard deviation,,,,");
  });
  it("writes observations with one column per participant, and files a removed task's under General", () => {
    const lines = observationsCsv(insights).split("\r\n");
    expect(lines[0]).toBe("Task,Observation,P1,P2,Participants,Possible solution,Notes");
    expect(lines[1]).toBe('Task 1,"Did not find ""Import"", gave up",,x,1,Label it,');
    expect(lines[2]).toBe("General,Liked the layout,x,x,2,,");
  });
});
