// Session state for the whole app: who is signed in, which organisations and
// workspaces they can see, and which pair is currently active. Keeps
// core/scope.ts in step so every scoped API call uses the active workspace.
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { authService } from "../core/auth";
import { setActiveScope } from "../core/scope";
import {
  getAccountSpaces,
  getMyMemberships,
  getMyTenants,
  getUmMe,
  UmMe,
  UmMembership,
  UmSpace,
  UmTenant,
} from "../core/umApi";
import { pickInitialOrg, pickInitialSpace, readRemembered, rememberScope } from "./scopeSelection";

export type SessionStatus = "loading" | "anonymous" | "ready";

/** Roles that carry data:write in a workspace, directly or by inheritance
 *  from the organisation (see backend auth_config.yaml and dependencies.py). */
const WRITE_ACCOUNT_ROLES = new Set(["account_owner", "account_admin"]);
const WRITE_SPACE_ROLES = new Set(["space_admin", "space_member"]);

export interface Session {
  status: SessionStatus;
  user: UmMe | null;
  orgs: UmTenant[];
  spaces: UmSpace[];
  memberships: UmMembership[];
  activeOrg: UmTenant | null;
  activeSpace: UmSpace | null;
  /** Whether the user may create/edit projects in the active workspace. UX only; the server decides. */
  canWrite: boolean;
  /** True once signed in but with no organisation membership (and not a platform admin). */
  isPending: boolean;
  selectOrg: (orgId: string) => Promise<void>;
  selectSpace: (spaceId: string) => void;
  /** Re-fetch organisations/workspaces (after creating one, accepting an invite, ...). */
  refresh: () => Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>("loading");
  const [user, setUser] = useState<UmMe | null>(null);
  const [orgs, setOrgs] = useState<UmTenant[]>([]);
  const [spaces, setSpaces] = useState<UmSpace[]>([]);
  const [memberships, setMemberships] = useState<UmMembership[]>([]);
  const [activeOrg, setActiveOrg] = useState<UmTenant | null>(null);
  const [activeSpace, setActiveSpaceState] = useState<UmSpace | null>(null);

  const loadSpacesFor = useCallback(async (me: UmMe, org: UmTenant | null): Promise<UmSpace | null> => {
    if (!org) {
      setSpaces([]);
      return null;
    }
    const list = await getAccountSpaces(org.id);
    setSpaces(list);
    return pickInitialSpace(list, readRemembered(me.id));
  }, []);

  const load = useCallback(async () => {
    if (!authService.isAuthenticated()) {
      setStatus("anonymous");
      return;
    }
    const me = await getUmMe();
    const [myOrgs, myMemberships] = await Promise.all([getMyTenants(), getMyMemberships()]);
    setUser(me);
    setOrgs(myOrgs);
    setMemberships(myMemberships);
    const org = pickInitialOrg(myOrgs, readRemembered(me.id));
    setActiveOrg(org);
    const space = await loadSpacesFor(me, org);
    setActiveSpaceState(space);
    setStatus("ready");
  }, [loadSpacesFor]);

  useEffect(() => {
    load().catch((err) => {
      console.error("Session load failed", err);
      setStatus("anonymous");
    });
  }, [load]);

  // The active workspace is what scoped API calls (the studio) run under.
  useEffect(() => {
    setActiveScope(activeSpace ? { type: "space", id: activeSpace.id } : null);
  }, [activeSpace]);

  const selectOrg = useCallback(
    async (orgId: string) => {
      if (!user) return;
      const org = orgs.find((o) => o.id === orgId) ?? null;
      setActiveOrg(org);
      rememberScope(user.id, { orgId, spaceId: undefined });
      const space = await loadSpacesFor(user, org);
      setActiveSpaceState(space);
    },
    [user, orgs, loadSpacesFor],
  );

  const selectSpace = useCallback(
    (spaceId: string) => {
      const space = spaces.find((s) => s.id === spaceId) ?? null;
      setActiveSpaceState(space);
      if (user) rememberScope(user.id, { spaceId });
    },
    [spaces, user],
  );

  const canWrite = useMemo(() => {
    if (!user) return false;
    if (user.is_platform_admin) return true;
    if (activeOrg && WRITE_ACCOUNT_ROLES.has(activeOrg.role)) return true;
    if (!activeSpace) return false;
    return memberships.some(
      (m) =>
        m.scope_type === "space" &&
        m.scope_id === activeSpace.id &&
        m.status === "active" &&
        WRITE_SPACE_ROLES.has(m.role),
    );
  }, [user, activeOrg, activeSpace, memberships]);

  const value = useMemo<Session>(
    () => ({
      status,
      user,
      orgs,
      spaces,
      memberships,
      activeOrg,
      activeSpace,
      canWrite,
      isPending: status === "ready" && !!user && !user.is_platform_admin && orgs.length === 0,
      selectOrg,
      selectSpace,
      refresh: load,
    }),
    [status, user, orgs, spaces, memberships, activeOrg, activeSpace, canWrite, selectOrg, selectSpace, load],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}
