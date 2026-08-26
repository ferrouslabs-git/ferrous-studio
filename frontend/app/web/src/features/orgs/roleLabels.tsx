// Role display names come from backend/app/auth/auth_config.yaml via
// /api/um/config/roles, so the YAML stays the single source of truth. Loaded
// once per session and shared.
import { createContext, ReactNode, useContext, useEffect, useState } from "react";
import { getRoleDefinitions, RoleDefinition } from "../../core/umApi";

interface RoleCatalogue {
  byName: Record<string, RoleDefinition>;
  byLayer: Record<string, RoleDefinition[]>;
}

const EMPTY: RoleCatalogue = { byName: {}, byLayer: {} };
const RoleContext = createContext<RoleCatalogue>(EMPTY);

export function RoleCatalogueProvider({ children }: { children: ReactNode }) {
  const [catalogue, setCatalogue] = useState<RoleCatalogue>(EMPTY);

  useEffect(() => {
    getRoleDefinitions()
      .then((defs) => {
        const byName: Record<string, RoleDefinition> = {};
        for (const list of Object.values(defs.roles)) {
          for (const r of list) byName[r.name] = r;
        }
        setCatalogue({ byName, byLayer: defs.roles });
      })
      .catch((err) => console.error("Role definitions unavailable", err));
  }, []);

  return <RoleContext.Provider value={catalogue}>{children}</RoleContext.Provider>;
}

export function useRoles(): RoleCatalogue {
  return useContext(RoleContext);
}

/** Display name for a role, falling back to a readable form of its key. */
export function RoleName({ name }: { name: string }) {
  const { byName } = useRoles();
  return <>{byName[name]?.display_name ?? name.replace(/_/g, " ")}</>;
}
