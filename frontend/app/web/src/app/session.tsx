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

/** Organisation roles that carry data:write (see backend auth_config.yaml). */
const WRITE_ACCOUNT_ROLES = new Set(["account_admin", "account_member"]);

export interface Session {
  status: SessionStatus;
  user: UmMe | null;
  orgs: UmTenant[];
  activeOrg: UmTenant | null;
  /** Whether the user may create/edit projects here. UX only; the server decides. */
  canWrite: boolean;
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

  const canWrite = useMemo(() => {
    if (!user) return false;
    if (user.is_platform_admin) return true;
    return !!activeOrg && WRITE_ACCOUNT_ROLES.has(activeOrg.role);
  }, [user, activeOrg]);

  const value = useMemo<Session>(
    () => ({
      status,
      user,
      orgs,
      activeOrg,
      canWrite,
      isPending: status === "ready" && !!user && !user.is_platform_admin && orgs.length === 0,
      selectOrg,
      refresh: load,
    }),
    [status, user, orgs, activeOrg, canWrite, selectOrg, load],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}
