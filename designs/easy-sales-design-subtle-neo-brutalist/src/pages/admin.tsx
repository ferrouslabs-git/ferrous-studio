// The Platform Admin wireframe.
import { useId } from "react";
import {
  ACTIVE_INACTIVE,
  ADMIN_ROWS,
  CHARGES,
  CHARGE_TYPES,
  COMPANY_NAMES,
  EASY_DATA_POINTS,
  INVOICES,
  INVOICE_STATUSES,
  ORGANISATIONS,
  ORG_PACKAGES,
  PACKAGES,
  PACKAGE_TIERS,
  ROLES,
  STRUCTURES,
  TEAMS as TEAM_NAMES,
  TEAM_ROWS,
  USER_ROWS,
  WEIGHTS,
  organisation,
} from "../data";
import { BACK, HostOutlet } from "../lib/nav";
import {
  CheckboxField,
  DateField,
  RadioGroupField,
  Select,
  SelectField,
  Tabs,
  TextAreaField,
  TextField,
} from "../ui/controls";
import { DataTable } from "../ui/DataTable";
import { Shell } from "../ui/Shell";
import { DrawerForm, Form, SaveAndNext } from "./common";
import * as P from "./ids";

export function AdminShell() {
  return (
    <Shell
      label="Platform admin"
      items={[
        { label: "Organisations", pageId: P.ORGANISATIONS, icon: "building" },
        { label: "Invoicing", pageId: P.INVOICING, icon: "receipt" },
        { label: "Platform admin users", pageId: P.PLATFORM_ADMIN_USERS, icon: "shield" },
      ]}
    />
  );
}

/* ------------------------------------------------------------ organisations */

export function OrganisationsPage() {
  return (
    <div className="page">
      <DataTable
        title="Organisations"
        noun="organisation"
        statusFilter
        create={{ label: "Organisation", pageId: P.EDIT_ORGANISATION }}
        columns={[
          {
            key: "name",
            label: "Name",
            link: P.ORGANISATION_DETAIL,
            onFollow: (row) => organisation.set(String(row.name)),
          },
          { key: "joined", label: "Joined", kind: "date" },
          { key: "status", label: "Status", kind: "status" },
        ]}
        rows={ORGANISATIONS}
        rowActions={[
          { label: "Edit", pageId: P.EDIT_ORGANISATION },
          { label: "Archive", does: "archive" },
        ]}
      />
    </div>
  );
}

export function EditOrganisationDrawer() {
  return (
    <DrawerForm>
      <SelectField label="Name" options={COMPANY_NAMES} />
      <CheckboxField label="Show leaderboard" defaultChecked />
    </DrawerForm>
  );
}

export function InvoicingPage() {
  return (
    <div className="page">
      <DataTable
        title="Invoicing"
        noun="invoice"
        columns={[
          { key: "organisation", label: "Organisation", nowrap: true },
          { key: "package", label: "Package", nowrap: true },
          { key: "overage", label: "Overage", nowrap: true },
          { key: "packageTotal", label: "Package total", kind: "number" },
          { key: "month", label: "Month" },
          { key: "year", label: "Year" },
          { key: "additional", label: "Additional charge", nowrap: true },
          { key: "invoiceTotal", label: "Invoice total", kind: "number" },
          { key: "status", label: "Status", kind: "select", options: INVOICE_STATUSES },
        ]}
        rows={INVOICES}
      />
    </div>
  );
}

export function PackagesPage() {
  return (
    <div className="page">
      <DataTable
        title="Packages"
        noun="package"
        statusFilter
        create={{ label: "Package", pageId: P.EDIT_PACKAGE_NAME }}
        columns={[{ key: "name", label: "Name", link: P.PACKAGE_TIERS }]}
        rows={PACKAGES}
        rowActions={[
          { label: "Edit", pageId: P.EDIT_PACKAGE_NAME },
          { label: "Archive", does: "archive" },
        ]}
      />
    </div>
  );
}

export function EditPackageNameDrawer() {
  return (
    <DrawerForm>
      <TextField label="Name" defaultValue="Essentials" />
    </DrawerForm>
  );
}

export function PackageTiersPage() {
  return (
    <div className="page">
      <DataTable
        title="Essentials"
        noun="price band"
        columns={[
          { key: "from", label: "From", kind: "date" },
          { key: "to", label: "To", kind: "date" },
          { key: "minimum", label: "Minimum", kind: "number" },
          { key: "perMinute", label: "Per minute", kind: "number" },
          { key: "status", label: "Status", kind: "status" },
        ]}
        rows={PACKAGE_TIERS}
      />
    </div>
  );
}

/* ------------------------------------------------------------ users and teams */

export function UsersHostPage() {
  return (
    <div className="host">
      <div className="host-tabs">
        <Tabs
          label="Users"
          items={[
            { label: "Teams", pageId: P.TEAMS },
            { label: "Users", pageId: P.USERS },
          ]}
        />
      </div>
      <HostOutlet fallbackPageId={P.TEAMS} />
    </div>
  );
}

function teamsTable(edit: string) {
  return (
    <DataTable
      title="Teams"
      noun="team"
      statusFilter
      create={{ label: "Team", pageId: edit }}
      columns={[
        { key: "name", label: "Name" },
        { key: "status", label: "Status", kind: "status" },
      ]}
      rows={TEAM_ROWS}
      rowActions={[
        { label: "Edit", pageId: edit },
        { label: "Archive", does: "archive" },
      ]}
    />
  );
}

export function TeamsPage() {
  return <div className="page">{teamsTable(P.EDIT_TEAM)}</div>;
}

export function EditTeamDrawer() {
  return (
    <DrawerForm>
      <TextField label="Name" defaultValue="Team 1" />
    </DrawerForm>
  );
}

export function UsersPage() {
  return (
    <div className="page">
      <DataTable
        title="Users"
        noun="user"
        statusFilter
        create={{ label: "User", pageId: P.EDIT_USER }}
        columns={[
          { key: "name", label: "Name", kind: "person" },
          { key: "email", label: "Email", kind: "email" },
          { key: "team", label: "Team" },
          { key: "status", label: "Status", kind: "status" },
          { key: "joined", label: "Joined", kind: "date" },
        ]}
        rows={USER_ROWS}
        rowActions={[
          { label: "Edit", pageId: P.EDIT_USER },
          { label: "Archive", does: "archive" },
        ]}
      />
    </div>
  );
}

export function PlatformAdminUsersPage() {
  return (
    <div className="page">
      <DataTable
        title="Platform admin users"
        noun="user"
        statusFilter
        create={{ label: "User", pageId: P.EDIT_PLATFORM_ADMIN_USER }}
        columns={[
          { key: "name", label: "Name", kind: "person" },
          { key: "email", label: "Email", kind: "email" },
          { key: "status", label: "Status", kind: "status" },
          { key: "joined", label: "Joined", kind: "date" },
        ]}
        rows={ADMIN_ROWS}
        rowActions={[
          { label: "Edit", pageId: P.EDIT_PLATFORM_ADMIN_USER },
          { label: "Archive", does: "archive" },
        ]}
      />
    </div>
  );
}

export function EditUserDrawer() {
  return (
    <DrawerForm>
      <TextField label="Name" defaultValue="Ada Lovelace" />
      <TextField label="Email" type="email" defaultValue="ada@acme.io" />
      <SelectField label="Team" options={TEAM_NAMES} />
      <SelectField label="Role" options={ROLES} />
      <SelectField label="Status" options={ACTIVE_INACTIVE} />
      <DateField label="Joined" defaultValue="2026-10-16" />
    </DrawerForm>
  );
}

export function EditPlatformAdminUserDrawer() {
  return (
    <DrawerForm>
      <TextField label="Name" defaultValue="Ada Lovelace" />
      <TextField label="Email" type="email" defaultValue="ada@acme.io" />
      <SelectField label="Status" options={ACTIVE_INACTIVE} />
    </DrawerForm>
  );
}

/* ------------------------------------------------------------ one organisation */

export function OrganisationDetailPage() {
  return (
    <div className="host">
      <div className="host-head">
        <p className="eyebrow">Organisation</p>
        <h1>{organisation.get()}</h1>
        <Tabs
          label="Organisation"
          items={[
            { label: "Package", pageId: P.ORG_PACKAGE },
            { label: "Other charges", pageId: P.OTHER_CHARGES },
            { label: "Teams", pageId: P.ORG_TEAMS },
            { label: "Users", pageId: P.ORG_USERS },
            { label: "Reporting", pageId: P.REPORTING },
            { label: "Recordings", pageId: P.RECORDINGS },
            { label: "Easy structure", pageId: P.EASY_STRUCTURE },
          ]}
        />
      </div>
      <HostOutlet fallbackPageId={P.ORG_PACKAGE} />
    </div>
  );
}

export function OrgPackagePage() {
  return (
    <div className="page">
      <DataTable
        title="Package"
        titleLevel="section"
        noun="package"
        statusFilter
        create={{ label: "Package", pageId: P.EDIT_ORG_PACKAGE, placement: "inline" }}
        columns={[
          { key: "minimum", label: "Minimum minutes" },
          { key: "perMinute", label: "Price per minute" },
          { key: "start", label: "Start date", kind: "date" },
          { key: "end", label: "End date", kind: "date" },
          { key: "status", label: "Status", kind: "status" },
        ]}
        rows={ORG_PACKAGES}
        rowActions={[{ label: "Edit", pageId: P.EDIT_ORG_PACKAGE }]}
      />
    </div>
  );
}

export function EditOrgPackageDrawer() {
  return (
    <DrawerForm>
      <TextField label="Minimum minutes" type="number" defaultValue="3000" />
      <TextField label="Price per minute" defaultValue="£0.40" />
      <DateField label="Start date" defaultValue="2027-01-06" />
    </DrawerForm>
  );
}

export function OrgUsersPage() {
  return (
    <div className="page">
      <DataTable
        title="Users"
        titleLevel="section"
        noun="user"
        statusFilter
        create={{ label: "User", pageId: P.EDIT_USER }}
        columns={[
          { key: "name", label: "Name", kind: "person" },
          { key: "email", label: "Email", kind: "email" },
          { key: "team", label: "Team" },
          { key: "role", label: "Role", nowrap: true },
          { key: "status", label: "Status", kind: "status" },
          { key: "joined", label: "Joined", kind: "date" },
        ]}
        rows={USER_ROWS}
        rowActions={[
          { label: "Edit", pageId: P.EDIT_USER },
          { label: "Archive", does: "archive" },
          { label: "Impersonate" },
        ]}
      />
    </div>
  );
}

export function OtherChargesPage() {
  return (
    <div className="page">
      <DataTable
        title="Additional charges"
        titleLevel="section"
        noun="charge"
        statusFilter
        create={{ label: "Charge", pageId: P.EDIT_CHARGE }}
        columns={[
          { key: "name", label: "Name", nowrap: true },
          { key: "amount", label: "Amount", kind: "number" },
          { key: "type", label: "Type" },
          { key: "start", label: "Start date", kind: "date" },
          { key: "end", label: "End date", kind: "date" },
        ]}
        rows={CHARGES}
        rowActions={[
          { label: "Edit", pageId: P.EDIT_CHARGE },
          { label: "Archive", does: "archive" },
        ]}
      />
    </div>
  );
}

export function EditChargeDrawer() {
  return (
    <DrawerForm>
      <TextField label="Name" defaultValue="Integration setup" />
      <TextField label="Amount" type="number" defaultValue="300" />
      <RadioGroupField label="Type" options={CHARGE_TYPES} />
      <DateField label="Start date" span="half" />
      <DateField label="End date" span="half" />
    </DrawerForm>
  );
}

export function OrgTeamsPage() {
  return (
    <div className="page">
      <OrgTeams />
    </div>
  );
}

function OrgTeams() {
  return (
    <DataTable
      title="Teams"
      titleLevel="section"
      noun="team"
      statusFilter
      create={{ label: "Team", pageId: P.EDIT_ORG_TEAM }}
      columns={[
        { key: "name", label: "Name" },
        { key: "status", label: "Status", kind: "status" },
      ]}
      rows={TEAM_ROWS}
      rowActions={[
        { label: "Edit", pageId: P.EDIT_ORG_TEAM },
        { label: "Archive", does: "archive" },
      ]}
    />
  );
}

export function EditOrgTeamDrawer() {
  return (
    <DrawerForm>
      <TextField label="Name" defaultValue="Team 1" />
      <SelectField label="Status" options={ACTIVE_INACTIVE} />
    </DrawerForm>
  );
}

/* ------------------------------------------------------------ easy structure */

export function EasyStructurePage() {
  return (
    <div className="page easy-structure-page">
      <DataTable
        title="Easy structure"
        titleLevel="section"
        noun="structure"
        statusFilter
        create={{ label: "Structure", pageId: P.EDIT_EASY_STRUCTURE }}
        columns={[
          { key: "serviceLine", label: "Service line" },
          { key: "earn", label: "Earn", kind: "button", link: P.STEP_EARN },
          { key: "ask", label: "Ask", kind: "button", link: P.STEP_ASK },
          { key: "sell", label: "Sell", kind: "button", link: P.STEP_SELL },
          { key: "yesNo", label: "Yes/No", kind: "button", link: P.STEP_YES_NO },
          { key: "added", label: "Date added", kind: "date" },
          { key: "status", label: "Status", kind: "status" },
        ]}
        rows={STRUCTURES}
        rowActions={[
          { label: "Edit", pageId: P.EDIT_EASY_STRUCTURE },
          { label: "Archive", does: "archive" },
        ]}
      />
    </div>
  );
}

export function EditEasyStructureDrawer() {
  return (
    <DrawerForm>
      <TextField label="Service line" defaultValue="Residential" />
    </DrawerForm>
  );
}

/** One criterion of a step: what to listen for, and how much it counts. */
function Criterion({ label, weight = "Standard" }: { label: string; weight?: string }) {
  const id = useId();
  return (
    <div className="criterion">
      <TextAreaField label={label} />
      <div className="field criterion-weight">
        <label htmlFor={id}>Weight</label>
        <Select id={id} options={WEIGHTS} defaultValue={weight} />
      </div>
    </div>
  );
}

function StepPage({
  step,
  criteria,
  linked,
}: {
  step: string;
  criteria: [string, string?][];
  /** Earn's Cancel and Save go back; the other steps' buttons have no link. */
  linked?: boolean;
}) {
  return (
    <div className="page page-narrow">
      <div className="section-head">
        <div>
          <p className="eyebrow">Easy structure</p>
          <h2 className="step-title">{step}</h2>
        </div>
      </div>
      <Form cancel={linked ? BACK : undefined} save={linked ? BACK : undefined} extra={<SaveAndNext />}>
        <div className="criteria">
          {criteria.map(([label, weight]) => (
            <Criterion key={label} label={label} weight={weight} />
          ))}
        </div>
      </Form>
    </div>
  );
}

export function EarnStepPage() {
  return (
    <StepPage step="Earn" linked criteria={EASY_DATA_POINTS.earn.map((label): [string] => [label])} />
  );
}

export function AskStepPage() {
  const vi = "Very Important";
  return (
    <StepPage
      step="Ask"
      criteria={EASY_DATA_POINTS.ask.map((label): [string, string] => [label, vi])}
    />
  );
}

export function SellStepPage() {
  return (
    <StepPage
      step="Sell"
      criteria={EASY_DATA_POINTS.sell.map((label, i): [string, string?] => [
        label,
        i === 0 ? "Very Important" : undefined,
      ])}
    />
  );
}

export function YesNoStepPage() {
  return (
    <StepPage
      step="Yes/No"
      criteria={EASY_DATA_POINTS.yesNo.map((label, i): [string, string?] => [
        label,
        i === 0 ? "Very Important" : undefined,
      ])}
    />
  );
}
