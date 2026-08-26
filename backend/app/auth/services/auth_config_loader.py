"""
YAML-driven auth configuration loader (v3.0).

Reads auth_config.yaml, validates structure, and builds in-memory
permission / role maps used by guards and dependency resolution.

DB upsert (role_definitions + permission_grants) is handled separately
via Alembic migration (Task 2.4) at deploy time rather than at startup,
so this loader is safe to call without a DB session.
"""
import os
import re
from pathlib import Path
from typing import Any

import yaml


# ── Structural permissions: fixed vocabulary ──────────────────────
STRUCTURAL_PERMISSIONS = frozenset({
    "platform:configure",
    "accounts:manage",
    "account:delete",
    "account:read",
    "spaces:create",
    "space:delete",
    "space:configure",
    "space:read",
    "members:manage",
    "members:invite",
    "users:suspend",
})

VALID_LAYERS = {"platform", "account", "space"}
_PERM_RE = re.compile(r"^[a-z_]+:[a-z_]+$")
_VALID_INHERITANCE = {"none", "space_viewer", "space_member"}


class AuthConfigError(Exception):
    """Raised when auth_config.yaml is invalid."""


# ── Public data container ─────────────────────────────────────────

class AuthConfig:
    """Read-only configuration built from auth_config.yaml."""

    __slots__ = (
        "version",
        "permission_map",
        "inheritance_config",
        "layer_config",
        "role_display_names",
        "roles_by_layer",
    )

    def __init__(
        self,
        version: str,
        permission_map: dict[str, set[str]],
        inheritance_config: dict[str, Any],
        layer_config: dict[str, dict[str, Any]],
        role_display_names: dict[str, str],
        roles_by_layer: dict[str, list[dict[str, Any]]],
    ):
        self.version = version
        self.permission_map = permission_map
        self.inheritance_config = inheritance_config
        self.layer_config = layer_config
        self.role_display_names = role_display_names
        self.roles_by_layer = roles_by_layer

    def permissions_for_role(self, role_name: str) -> set[str]:
        return self.permission_map.get(role_name, set())

    def is_layer_enabled(self, layer: str) -> bool:
        cfg = self.layer_config.get(layer)
        return cfg is not None and cfg.get("enabled", False)


# ── Validation helpers ────────────────────────────────────────────

def _validate_layers(raw: dict) -> dict[str, dict[str, Any]]:
    layers = raw.get("layers")
    if not isinstance(layers, dict):
        raise AuthConfigError("'layers' section is required and must be a mapping.")
    result: dict[str, dict[str, Any]] = {}
    for key, cfg in layers.items():
        if key not in {"account", "space"}:
            raise AuthConfigError(f"Unknown layer '{key}'. Allowed: account, space.")
        if not isinstance(cfg, dict):
            raise AuthConfigError(f"Layer '{key}' must be a mapping.")
        result[key] = {
            "enabled": bool(cfg.get("enabled", False)),
            "display_name": str(cfg.get("display_name", key.title())),
        }
    # platform layer is always implicitly enabled
    result["platform"] = {"enabled": True, "display_name": "Platform"}
    return result


def _validate_inheritance(raw: dict, layer_config: dict, space_role_names: set[str]) -> dict:
    inheritance = raw.get("inheritance", {})
    if not isinstance(inheritance, dict):
        raise AuthConfigError("'inheritance' must be a mapping.")
    access = str(inheritance.get("account_member_space_access", "none"))
    valid = _VALID_INHERITANCE | space_role_names
    if access not in valid:
        raise AuthConfigError(
            f"inheritance.account_member_space_access='{access}' invalid. "
            f"Allowed: {sorted(valid)}"
        )
    return {"account_member_space_access": access}


def _validate_roles(raw: dict, layer_config: dict) -> tuple[
    dict[str, set[str]],           # permission_map
    dict[str, str],                # role_display_names
    dict[str, list[dict[str, Any]]],  # roles_by_layer
]:
    roles_section = raw.get("roles")
    if not isinstance(roles_section, dict):
        raise AuthConfigError("'roles' section is required and must be a mapping.")

    permission_map: dict[str, set[str]] = {}
    role_display_names: dict[str, str] = {}
    roles_by_layer: dict[str, list[dict[str, Any]]] = {}
    all_role_names: set[str] = set()

    for layer_name in VALID_LAYERS:
        layer_roles = roles_section.get(layer_name, [])
        if not isinstance(layer_roles, list):
            raise AuthConfigError(f"roles.{layer_name} must be a list.")

        # Disabled layers must have no roles
        if layer_name != "platform" and not layer_config.get(layer_name, {}).get("enabled", False):
            if layer_roles:
                raise AuthConfigError(
                    f"Layer '{layer_name}' is disabled but has roles defined."
                )
            roles_by_layer[layer_name] = []
            continue

        parsed_roles: list[dict[str, Any]] = []
        for role_def in layer_roles:
            name = role_def.get("name")
            display = role_def.get("display_name", name)
            perms = role_def.get("permissions", [])

            if not name or not isinstance(name, str):
                raise AuthConfigError(f"Role in '{layer_name}' missing a valid 'name'.")
            if name in all_role_names:
                raise AuthConfigError(f"Duplicate role name '{name}' across layers.")
            all_role_names.add(name)

            if not isinstance(perms, list):
                raise AuthConfigError(f"Role '{name}': permissions must be a list.")

            validated_perms: set[str] = set()
            for p in perms:
                if not _PERM_RE.match(p):
                    raise AuthConfigError(
                        f"Role '{name}': permission '{p}' doesn't match pattern [a-z_]+:[a-z_]+."
                    )
                validated_perms.add(p)

            permission_map[name] = validated_perms
            role_display_names[name] = display
            parsed_roles.append({
                "name": name,
                "layer": layer_name,
                "display_name": display,
                "permissions": validated_perms,
            })
        roles_by_layer[layer_name] = parsed_roles

    return permission_map, role_display_names, roles_by_layer


# ── Public API ────────────────────────────────────────────────────

def load_and_validate_config(config_path: str | None = None) -> AuthConfig:
    """Load, validate, and return an AuthConfig from a YAML file.

    Parameters
    ----------
    config_path : str | None
        Explicit path to config file.  Falls back to AUTH_CONFIG_PATH env var,
        then ``./auth_config.yaml``.
    """
    if config_path is None:
        _module_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        config_path = os.getenv(
            "AUTH_CONFIG_PATH",
            os.path.join(_module_dir, "auth_config.yaml"),
        )

    path = Path(config_path)
    if not path.is_file():
        raise AuthConfigError(f"Config file not found: {path.resolve()}")

    with open(path, "r", encoding="utf-8") as f:
        raw = yaml.safe_load(f)

    if not isinstance(raw, dict):
        raise AuthConfigError("Config file must be a YAML mapping.")

    # Version gate
    version = str(raw.get("version", ""))
    if version != "3.0":
        raise AuthConfigError(f"Unsupported config version '{version}'. Expected '3.0'.")

    layer_config = _validate_layers(raw)
    permission_map, role_display_names, roles_by_layer = _validate_roles(raw, layer_config)

    # Collect space-layer role names for inheritance validation
    space_role_names = {r["name"] for r in roles_by_layer.get("space", [])}
    inheritance_config = _validate_inheritance(raw, layer_config, space_role_names)

    return AuthConfig(
        version=version,
        permission_map=permission_map,
        inheritance_config=inheritance_config,
        layer_config=layer_config,
        role_display_names=role_display_names,
        roles_by_layer=roles_by_layer,
    )


# ── Module-level singleton (lazy) ────────────────────────────────

_auth_config: AuthConfig | None = None


def get_auth_config() -> AuthConfig:
    """Return the singleton AuthConfig, loading on first access."""
    global _auth_config
    if _auth_config is None:
        _auth_config = load_and_validate_config()
    return _auth_config


def reset_auth_config() -> None:
    """Reset the singleton — intended for tests only."""
    global _auth_config
    _auth_config = None
