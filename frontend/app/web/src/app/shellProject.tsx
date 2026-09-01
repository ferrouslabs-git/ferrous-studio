// The sidebar needs to know which project is open (to title its menu) but the
// project is loaded by a route element *inside* the shell's <Outlet/>. This
// context lets ProjectLayout push the name up to AppShell.
import { createContext, useContext } from "react";

export interface ShellProject {
  id: string;
  orgId: string;
  name: string;
}

export interface ShellProjectValue {
  project: ShellProject | null;
  setProject: (p: ShellProject | null) => void;
}

export const ShellProjectContext = createContext<ShellProjectValue>({ project: null, setProject: () => {} });

export function useShellProject(): ShellProjectValue {
  return useContext(ShellProjectContext);
}
