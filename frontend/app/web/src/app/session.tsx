// Session state for the whole app: who is signed in, which organisations they
// can see, and which one is currently active. Keeps core/scope.ts in step so
// every scoped API call runs under the active organisation.
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
import { getMyTenants, getPlatformTenants, getUmMe, UmMe, UmTenant } from "../core/umApi";
import { pickInitialOrg, readRemembered, rememberScope } from "./scopeSelection";

export type SessionStatus = "loading" | "anonymous" | "ready";

// Which organisation role carries which capability. backend/app/auth/
// auth_config.yaml is the source of truth and the server decides every
// request; these sets only mirror it so the UI can hide what would 403.
//
// Only the admin writes content. A member reads everything and may do exactly
// three more things: pin a task to a wireframe, raise feedback against a
// deployed environment, and invite member/viewer.
/** data:write */
const WRITE_ACCOUNT_ROLES = new Set(["account_admin"]);
/** tasks:create */
const TASK_ACCOUNT_ROLES = new Set(["account_admin", "account_member"]);
/** feedback:create */
const FEEDBACK_ACCOUNT_ROLES = new Set(["account_admin", "account_member"]);
/** members:invite */
const INVITE_ACCOUNT_ROLES = new Set(["account_admin", "account_member"]);
/** members:manage */
const MANAGE_ACCOUNT_ROLES = new Set(["account_admin"]);

export interface Session {
  status: SessionStatus;
  user: UmMe | null;
  orgs: UmTenant[];
  activeOrg: UmTenant | null;
  /** Whether the user may create/edit projects here. UX only; the server decides. */
  canWrite: boolean;
  /** Whether the user may add tasks to a wireframe. */
  canAddTasks: boolean;
  /** Whether the user may raise feedback against a deployed environment. */
  canRaiseFeedback: boolean;
  /** Whether the user may invite people (members and viewers only). */
  canInvite: boolean;
  /** Whether the user may change roles, archive members, and manage anyone's invitations. */
  canManageMembers: boolean;
  /** True once signed in but with no organisation membership (and not a platform admin). */
  isPending: boolean;
  selectOrg: (orgId: string) => Promise<void>;
  /** Re-fetch organisations (after creating one, accepting an invite, ...). */
  refresh: () => Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

async function getAllOrgsAsAdmin(): Promise<UmTenant[]> {
  const all = await getPlatformTenants();
  return all.map((t) => ({
    id: t.tenant_id,
    name: t.name,
    status: t.status,
    role: "super_admin",
    created_at: t.created_at,
  }));
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>("loading");
  const [user, setUser] = useState<UmMe | null>(null);
  const [orgs, setOrgs] = useState<UmTenant[]>([]);
  const [activeOrg, setActiveOrg] = useState<UmTenant | null>(null);

  const load = useCallback(async () => {
    if (!authService.isAuthenticated()) {
      setStatus("anonymous");
      return;
    }
    const me = await getUmMe();
    // Super admins are not members of anything: they see every organisation
    // on the platform. Everyone else sees the organisations they belong to.
    const myOrgs = me.is_platform_admin ? await getAllOrgsAsAdmin() : await getMyTenants();
    setUser(me);
    setOrgs(myOrgs);
    setActiveOrg(pickInitialOrg(myOrgs, readRemembered(me.id)));
    setStatus("ready");
  }, []);

  useEffect(() => {
    load().catch((err) => {
      console.error("Session load failed", err);
      setStatus("anonymous");
    });
  }, [load]);

  // The active organisation is what scoped API calls (the studio) run under.
  useEffect(() => {
    setActiveScope(activeOrg ? { type: "account", id: activeOrg.id } : null);
  }, [activeOrg]);

  const selectOrg = useCallback(
    async (orgId: string) => {
      if (!user) return;
      setActiveOrg(orgs.find((o) => o.id === orgId) ?? null);
      rememberScope(user.id, { orgId });
    },
    [user, orgs],
  );

  /** Does the active organisation role sit in `roles`? Platform admins, who
   *  hold no organisation membership, pass everything. */
  const holds = useCallback(
    (roles: Set<string>) => {
      if (!user) return false;
      if (user.is_platform_admin) return true;
      return !!activeOrg && roles.has(activeOrg.role);
    },
    [user, activeOrg],
  );

  const canWrite = useMemo(() => holds(WRITE_ACCOUNT_ROLES), [holds]);
  const canAddTasks = useMemo(() => holds(TASK_ACCOUNT_ROLES), [holds]);
  const canRaiseFeedback = useMemo(() => holds(FEEDBACK_ACCOUNT_ROLES), [holds]);
  const canInvite = useMemo(() => holds(INVITE_ACCOUNT_ROLES), [holds]);
  const canManageMembers = useMemo(() => holds(MANAGE_ACCOUNT_ROLES), [holds]);

  const value = useMemo<Session>(
    () => ({
      status,
      user,
      orgs,
      activeOrg,
      canWrite,
      canAddTasks,
      canRaiseFeedback,
      canInvite,
      canManageMembers,
      isPending: status === "ready" && !!user && !user.is_platform_admin && orgs.length === 0,
      selectOrg,
      refresh: load,
    }),
    [
      status,
      user,
      orgs,
      activeOrg,
      canWrite,
      canAddTasks,
      canRaiseFeedback,
      canInvite,
      canManageMembers,
      selectOrg,
      load,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}
