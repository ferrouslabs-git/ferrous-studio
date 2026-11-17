// Pieces several pages share: the form footer, an empty page.
import { FormEvent, ReactNode } from "react";
import { BACK, useGo } from "../lib/nav";
import { Button, EmptyState, useToast } from "../ui/controls";

/** A wireframe `form`. `cancel`/`save` are the buttons' links: "@back" when
 *  the wireframe gives one, undefined when it gives none (the button then
 *  confirms in place and stays). */
export function Form({
  children,
  columns = 1,
  cancel,
  save,
  saveLabel = "Save",
  extra,
  validate,
  inDrawer,
}: {
  children: ReactNode;
  columns?: 1 | 2 | 3;
  cancel?: string;
  save?: string;
  saveLabel?: string;
  extra?: ReactNode;
  validate?: () => string | null;
  inDrawer?: boolean;
}) {
  const go = useGo();
  const toast = useToast();
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const problem = validate?.();
    if (problem) {
      toast(problem, "error");
      return;
    }
    toast("Changes saved");
    if (save) go(save);
  };
  return (
    <form className={`form${inDrawer ? " form-drawer" : ""}`} onSubmit={onSubmit} noValidate>
      <div className={`form-grid cols-${columns}`}>{children}</div>
      <div className="form-actions">
        <Button onClick={() => cancel && go(cancel)}>Cancel</Button>
        <Button type="submit" variant={extra ? "secondary" : "primary"}>
          {saveLabel}
        </Button>
        {extra}
      </div>
    </form>
  );
}

export function DrawerForm(props: Omit<Parameters<typeof Form>[0], "inDrawer" | "cancel" | "save">) {
  return <Form {...props} cancel={BACK} save={BACK} inDrawer />;
}

export function EmptyPage() {
  return (
    <div className="page">
      <EmptyState title="Nothing here yet">This page has no content in the wireframe yet.</EmptyState>
    </div>
  );
}

export function SaveAndNext() {
  const toast = useToast();
  return (
    <Button variant="primary" onClick={() => toast("Changes saved")}>
      Save &amp; next
    </Button>
  );
}
