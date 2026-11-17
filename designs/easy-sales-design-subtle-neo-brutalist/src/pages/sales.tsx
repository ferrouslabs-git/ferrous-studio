// The Sales Reps and Sales Managers wireframes, and the pages they share
// (Recordings, Settings, Reporting).
import { useState } from "react";
import {
  FULL_NAMES,
  EASY_DATA_POINT_ROWS,
  LAST_WEEK,
  LEADERBOARD,
  PERFORMANCE,
  PERIODS,
  PRIORITIES,
  RANGES,
  RAW_DATA,
  RECORDINGS,
  TEAMS,
  WEEKDAYS,
} from "../data";
import { BACK, HostOutlet, useGo } from "../lib/nav";
import { ColumnChart, DataPointChart, LineChart } from "../ui/Charts";
import {
  Avatar,
  Button,
  DateField,
  FileField,
  MultiSelectField,
  PageHeader,
  RadioGroupField,
  Select,
  SelectField,
  Tabs,
  TextAreaField,
  TextField,
  useToast,
} from "../ui/controls";
import { DataTable, Row } from "../ui/DataTable";
import { Icon } from "../ui/icons";
import { Shell } from "../ui/Shell";
import { DrawerForm, Form } from "./common";
import * as P from "./ids";

/* ------------------------------------------------------------ shells */

export function RepsShell() {
  return (
    <Shell
      label="Sales rep"
      items={[
        { label: "Performance", pageId: P.REP_PERFORMANCE, icon: "chart" },
        { label: "Leaderboard", pageId: P.REP_LEADERBOARD, icon: "trophy" },
        { label: "Recordings", pageId: P.RECORDINGS, icon: "play" },
        { label: "Settings", pageId: P.SETTINGS, icon: "settings" },
      ]}
    />
  );
}

export function ManagersShell() {
  return (
    <Shell
      label="Sales manager"
      items={[
        { label: "Performance", pageId: P.MANAGER_PERFORMANCE, icon: "chart" },
        { label: "Leaderboard", pageId: P.LEADERBOARD, icon: "trophy" },
        { label: "Reporting", pageId: P.REPORTING, icon: "report" },
        { label: "Recordings", pageId: P.RECORDINGS, icon: "play" },
        { label: "Users", pageId: P.USERS_HOST, icon: "users" },
        { label: "Settings", pageId: P.SETTINGS, icon: "settings" },
      ]}
    />
  );
}

/* ------------------------------------------------------------ performance */

function Performance({ manager }: { manager?: boolean }) {
  const p = PERFORMANCE;
  const trends = manager
    ? [P.MANAGER_EASY_SCORE, P.MANAGER_SCORE_PER_STEP, P.MANAGER_SCORE_PER_DATA_POINT]
    : [P.REP_EASY_SCORE, P.REP_SCORE_PER_STEP, P.REP_SCORE_PER_DATA_POINT];
  return (
    <div className="page">
      <PageHeader
        title="Daily performance"
        actions={
          manager && (
            <>
              <Select compact ariaLabel="Scope" options={["Org", "Team", "Individual"]} defaultValue="Org" />
              <Select compact ariaLabel="Team" options={TEAMS} defaultValue="Team 1" />
            </>
          )
        }
      />

      <div className="perf-top">
        <section className="panel panel-subtle score-panel" aria-labelledby="easy-score">
          <div className="score-card-head">
            <h2 id="easy-score" className="panel-title">
              Easy score
            </h2>
            <span className="score-call-count">{p.callsAnalysed} calls analysed</span>
          </div>
          <div className="score-row">
            <span className="score-big">{p.easyScore}%</span>
            <span className="delta">
              <span className="delta-value">
                <Icon name="arrowUp" size={14} />
                {p.change}
              </span>
              <span className="delta-note">Compared to your 7-day average</span>
            </span>
          </div>
        </section>

        <section className="panel steps-panel">
          <div>
            <h2 className="panel-title">Score per step</h2>
            <ul className="step-bars">
              {p.steps.map((s) => (
                <li key={s.step}>
                  <span className="step-name">{s.step}</span>
                  <span className="step-track" aria-hidden="true">
                    <span className="step-fill" style={{ width: `${s.score}%` }} />
                  </span>
                  <span className="step-score">{s.score}%</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="panel-title">Top 3 calls</h2>
            <ol className="top-calls">
              {p.topCalls.map((call, i) => (
                <li key={call.time}>
                  <span className="call-position" aria-hidden="true">
                    {i + 1}
                  </span>
                  <strong className="call-time">{call.time}</strong>
                  <span className="call-score">
                    <span className="visually-hidden">Score </span>
                    {call.score}
                  </span>
                </li>
              ))}
            </ol>
          </div>
          <div className="rank">
            <h2 className="panel-title">Rank</h2>
            <Medal place={1} size={64} />
            <p className="rank-text">{p.rank}</p>
          </div>
        </section>
      </div>

      <div className="perf-charts">
        <section className="panel">
          <div className="panel-head data-point-panel-head">
            <div>
              <h2 className="panel-title">Score per data point</h2>
              <p className="muted">Percentage score for each data point in Easy Structure</p>
            </div>
          </div>
          <DataPointChart label="Percentage score per data point" data={p.dataPoints} />
        </section>
      </div>

      <div className="section-head section-head-tabs performance-section-head">
        <h2>Long-term performance</h2>
        <Tabs
          label="Long-term performance"
          items={[
            { label: "Easy score", pageId: trends[0]! },
            { label: "Score per step", pageId: trends[1]! },
            { label: "Score per data point", pageId: trends[2]! },
          ]}
        />
      </div>
      <HostOutlet fallbackPageId={trends[0]!} />
    </div>
  );
}

export function RepPerformancePage() {
  return <Performance />;
}

export function ManagerPerformancePage() {
  return <Performance manager />;
}

const RANGE_DATA: Record<string, { categories: string[]; values: number[] }> = {
  "Last 7 days": { categories: WEEKDAYS, values: LAST_WEEK },
  "Last 30 days": { categories: ["Week 1", "Week 2", "Week 3", "Week 4"], values: [55, 61, 58, 66] },
  "Last quarter": { categories: ["September", "October", "November"], values: [52, 60, 64] },
};

const STEP_RANGE_DATA: typeof RANGE_DATA = {
  "Last 7 days": { categories: ["Earn", "Ask", "Sell", "Yes/No"], values: [70, 60, 60, 60] },
  "Last 30 days": { categories: ["Earn", "Ask", "Sell", "Yes/No"], values: [73, 64, 67, 62] },
  "Last quarter": { categories: ["Earn", "Ask", "Sell", "Yes/No"], values: [68, 66, 63, 65] },
};

const dataPointCategories = EASY_DATA_POINT_ROWS.map(
  ({ step, label }) => `${step === "Yes/No" ? "Y/N" : step[0]} · ${label}`,
);
const DATA_POINT_RANGE_DATA: typeof RANGE_DATA = {
  "Last 7 days": {
    categories: dataPointCategories,
    values: PERFORMANCE.dataPoints.map(({ score }) => score),
  },
  "Last 30 days": {
    categories: dataPointCategories,
    values: PERFORMANCE.dataPoints.map(({ score }, i) => Math.max(0, Math.min(100, score + (i % 3) * 3 - 2))),
  },
  "Last quarter": {
    categories: dataPointCategories,
    values: PERFORMANCE.dataPoints.map(({ score }, i) => Math.max(0, Math.min(100, score + (i % 4) * 2 - 4))),
  },
};

function Trend({
  name,
  rangeData = RANGE_DATA,
  denseXAxis,
}: {
  name: string;
  rangeData?: typeof RANGE_DATA;
  denseXAxis?: boolean;
}) {
  const [range, setRange] = useState(RANGES[0]!);
  const data = rangeData[range]!;
  return (
    <section className="panel performance-trend-panel">
      <div className="panel-head performance-trend-head">
        <div>
          <h3 className="panel-title">{name}</h3>
          <p className="muted">{range} performance</p>
        </div>
        <Select compact ariaLabel="Time range" options={RANGES} value={range} onChange={setRange} />
      </div>
      <LineChart
        label={`${name}, ${range}`}
        categories={data.categories}
        values={data.values}
        max={100}
        denseXAxis={denseXAxis}
      />
    </section>
  );
}

export function EasyScoreTrendPage() {
  return <Trend name="Easy score" />;
}
export function StepTrendPage() {
  return <Trend name="Score per step" rangeData={STEP_RANGE_DATA} />;
}
export function DataPointTrendPage() {
  return <Trend name="Score per data point" rangeData={DATA_POINT_RANGE_DATA} denseXAxis />;
}

/* ------------------------------------------------------------ leaderboard */

function Medal({ place, size = 40 }: { place: number; size?: number }) {
  return (
    <span
      className={`medal medal-${place}`}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
      aria-label={`Rank ${place}`}
    >
      {place}
    </span>
  );
}

function Leaderboard({ priority }: { priority?: string }) {
  const order = [1, 0, 2];
  return (
    <div className="page">
      <PageHeader
        title="Leaderboard"
        actions={
          <Select compact ariaLabel="Period" options={PERIODS} defaultValue={priority ? "Last Week" : "Today"} />
        }
      />
      {priority && (
        <p className="notice">
          <Icon name="bookmark" />
          <span>
            <strong>Priority:</strong> {priority}
          </span>
        </p>
      )}
      <ol className="podium" aria-label="Top three">
        {order.map((i) => {
          const person = LEADERBOARD[i]!;
          return (
            <li key={person.id} className={`podium-place place-${i + 1}`}>
              <Avatar name={person.name} size={i === 0 ? 64 : 52} src={person.image} />
              <span className="podium-name">{person.name}</span>
              <span className="podium-score">{person.score}</span>
              <span className="podium-step">
                <Medal place={i + 1} size={i === 0 ? 40 : 32} />
              </span>
            </li>
          );
        })}
      </ol>
      <DataTable
        search={false}
        noun="person"
        columns={[
          { key: "name", label: "Name", kind: "person" },
          { key: "score", label: "Easy score", kind: "number" },
        ]}
        rows={LEADERBOARD}
      />
    </div>
  );
}

export function RepLeaderboardPage() {
  return <Leaderboard />;
}

export function LeaderboardHostPage() {
  return (
    <div className="host">
      <div className="host-tabs">
        <Tabs
          label="Leaderboard"
          items={[
            { label: "Board", pageId: P.BOARD },
            { label: "Priorities", pageId: P.PRIORITIES },
          ]}
        />
      </div>
      <HostOutlet fallbackPageId={P.BOARD} />
    </div>
  );
}

export function ManagerBoardPage() {
  return <Leaderboard priority="This month we want everyone to focus on Easy because you've been terrible at it" />;
}

export function PrioritiesPage() {
  return (
    <div className="page">
      <DataTable
        title="Priorities"
        noun="priority"
        statusFilter
        intro={
          <div className="intro">
            <p>
              Setting priorities for the team means the leaderboard ranks team members on that focus item only for the
              time period you set.
            </p>
            <p>A message on the leaderboard tells team members what the priority is.</p>
          </div>
        }
        create={{ label: "Priority", pageId: P.EDIT_PRIORITY, placement: "inline" }}
        filters={
          <>
            <label className="inline-date">
              <span>From</span>
              <input className="input input-sm" type="date" defaultValue="2026-11-13" />
            </label>
            <label className="inline-date">
              <span>To</span>
              <input className="input input-sm" type="date" />
            </label>
          </>
        }
        columns={[
          { key: "focus", label: "Focus", nowrap: true },
          { key: "message", label: "Message" },
          { key: "start", label: "Start date", kind: "date", nowrap: true },
          { key: "end", label: "End date", nowrap: true },
          { key: "team", label: "Team" },
        ]}
        rows={PRIORITIES}
        rowActions={[
          { label: "Edit", pageId: P.EDIT_PRIORITY },
          { label: "Archive", does: "archive" },
        ]}
      />
    </div>
  );
}

export function EditPriorityDrawer() {
  return (
    <DrawerForm>
      <RadioGroupField label="Focus" options={["Step", "Data point"]} span="half" />
      <SelectField label="Choice" options={["Earn", "Ask", "Yes/No"]} span="half" />
      <TextAreaField label="Message" />
      <DateField label="Start date" span="half" />
      <DateField label="End date" span="half" />
      <MultiSelectField label="Teams" options={TEAMS} />
    </DrawerForm>
  );
}

/* ------------------------------------------------------------ recordings */

export function RecordingsPage() {
  return (
    <div className="page">
      <DataTable
        title="Recordings"
        noun="recording"
        statusFilter
        pageSize={10}
        create={{ label: "Recording", pageId: P.EDIT_RECORDING }}
        columns={[
          { key: "fileName", label: "File name" },
          { key: "callDate", label: "Call date", nowrap: true },
          { key: "uploaded", label: "Date uploaded", kind: "date", nowrap: true },
        ]}
        rows={RECORDINGS}
        rowActions={[{ label: "Delete", does: "delete" }]}
      />
    </div>
  );
}

export function UploadRecordingsDrawer() {
  const go = useGo();
  const toast = useToast();
  const [files, setFiles] = useState<Row[]>([
    { id: "f-0", fileName: "adag.mp4", callDate: "" },
    { id: "f-1", fileName: "regwgwg.mp4", callDate: "" },
    { id: "f-2", fileName: "adag.mp4", callDate: "" },
  ]);
  const add = (names: string[]) =>
    setFiles((current) => [
      ...current,
      ...names.map((fileName, i) => ({ id: `f-${Date.now()}-${i}`, fileName, callDate: "" })),
    ]);
  return (
    <form
      className="form form-drawer"
      onSubmit={(event) => {
        event.preventDefault();
        toast(files.length === 1 ? "1 recording uploaded" : `${files.length} recordings uploaded`);
        go(BACK);
      }}
    >
      <div className="form-grid cols-1">
        <SelectField label="Name" options={FULL_NAMES} defaultValue="Grace Hopper" />
        <FileField label="Recordings" multiple accept="audio/*,video/*" onFiles={add} />
        <DateField label="Call date" withTime defaultValue="2026-11-16T09:00" />
        <p className="read-only">
          Select a date/time for all uploaded recordings. Or leave it blank to set individually
        </p>
        <div className="field">
          <h3 className="subhead">Selected</h3>
          {files.length ? (
            <ul className="file-list">
              {files.map((file) => (
                <li key={file.id}>
                  <Icon name="file" />
                  <span className="file-name">{String(file.fileName)}</span>
                  <input
                    className="input input-sm"
                    type="datetime-local"
                    aria-label={`Call date for ${file.fileName}`}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Remove ${file.fileName}`}
                    onClick={() => setFiles((current) => current.filter((f) => f.id !== file.id))}
                  >
                    Delete
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No files selected yet.</p>
          )}
        </div>
      </div>
      <div className="form-actions">
        <Button onClick={() => go(BACK)}>Cancel</Button>
        <Button type="submit" variant="primary" icon="upload" disabled={!files.length}>
          Upload
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------ settings */

export function SettingsPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [tried, setTried] = useState(false);
  const mismatch = password !== confirm ? "The passwords don't match. Type them again." : undefined;
  return (
    <div className="page page-narrow">
      <PageHeader title="Account settings" />
      <Form
        validate={() => {
          setTried(true);
          return mismatch ? "Your changes couldn't be saved. Check the highlighted field." : null;
        }}
      >
        <TextField label="Name" defaultValue="Grace Hopper" />
        <TextField label="Email" type="email" defaultValue="grace@acme.io" />
        <TextField label="New password" type="password" value={password} onChange={setPassword} />
        <TextField
          label="Confirm new password"
          type="password"
          value={confirm}
          onChange={setConfirm}
          error={tried ? mismatch : undefined}
        />
        <FileField label="Profile picture" accept="image/*" />
      </Form>
    </div>
  );
}

/* ------------------------------------------------------------ reporting */

export function ReportingPage() {
  const toast = useToast();
  return (
    <div className="page">
      <PageHeader title="Reporting" />
      <section className="panel filters" aria-label="Report filters">
        <div className="form-grid cols-3">
          <MultiSelectField label="Team" options={TEAMS} defaultValue={["Team 2"]} span="third" />
          <MultiSelectField label="Name" options={FULL_NAMES} defaultValue={["Grace Hopper"]} span="third" />
          <SelectField label="Focus" options={["Easy Score", "Step", "Data point"]} span="third" />
          <SelectField label="Choice" options={["Earn", "Ask", "Sell", "Yes/No"]} span="third" />
          <SelectField label="Graph type" options={["Vertical bar", "Horizontal bar"]} span="third" />
          <div className="reporting-date-range">
            <DateField label="From" span="third" />
            <DateField label="To" span="third" />
          </div>
          <div className="field field-third field-action reporting-search-action">
            <Button variant="primary" icon="search" onClick={() => toast("Report updated")}>
              Search
            </Button>
          </div>
        </div>
      </section>
      <div className="section-head section-head-tabs">
        <Tabs
          label="Report view"
          items={[
            { label: "Graph", pageId: P.REPORT_GRAPH },
            { label: "Raw data", pageId: P.RAW_DATA },
          ]}
        />
      </div>
      <HostOutlet fallbackPageId={P.REPORT_GRAPH} />
    </div>
  );
}

export function ReportGraphPage() {
  const [grouping, setGrouping] = useState("By month");
  const monthly = grouping === "By month";
  return (
    <section className="panel">
      <div className="panel-head">
        <h3 className="panel-title">Easy score, this year</h3>
        <Select
          compact
          ariaLabel="Grouping"
          options={["By month", "By quarter"]}
          value={grouping}
          onChange={setGrouping}
        />
      </div>
      <ColumnChart
        label="Easy score this year"
        categories={monthly ? ["Jan", "Feb", "Mar", "Apr"] : ["Q1", "Q2"]}
        values={monthly ? [42, 58, 35, 71] : [45, 71]}
        unit="%"
      />
    </section>
  );
}

export function RawDataPage() {
  const dataPointColumns = EASY_DATA_POINT_ROWS.map((dataPoint, i) => ({
    key: `dp${i + 1}`,
    label: `${dataPoint.step} · ${dataPoint.label}`,
    nowrap: true,
  }));
  return (
    <DataTable
      noun="call"
      toolbarEnd={
        <Button icon="download" variant="primary">
          Export
        </Button>
      }
      columns={[
        { key: "name", label: "Name", nowrap: true },
        { key: "callDate", label: "Call date", kind: "date", nowrap: true },
        { key: "easy", label: "Easy score", kind: "number" },
        { key: "earn", label: "Earn", kind: "number" },
        { key: "ask", label: "Ask", kind: "number" },
        { key: "sell", label: "Sell", kind: "number" },
        { key: "yesNo", label: "Yes/No", kind: "number", nowrap: true },
        ...dataPointColumns,
      ]}
      rows={RAW_DATA as Row[]}
    />
  );
}
