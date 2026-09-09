"""The organisation audit log.

``audit_events`` has no RLS -- platform-level rows carry a NULL ``tenant_id``
and the platform listing runs without scope variables, so a policy would
break it. The scope filter in ``org_audit_query`` is therefore the only thing
standing between an organisation admin and another organisation's log, which
is why it is pinned directly rather than trusted to read correctly inside the
route. The rest of this file pins who may read the log, and that connecting
and disconnecting GitHub actually write to it.

Source inspection for the write sites, like ``test_role_permissions.py`` --
the suite has no database.
"""
import inspect
from uuid import uuid4

from app.auth.services.audit_service import org_audit_query
from app.auth.services.auth_config_loader import get_auth_config
from app.studio.github import disconnect, install_callback

ADMIN = "account_admin"
MEMBER = "account_member"
VIEWER = "account_viewer"

SCOPE = uuid4()


def _permissions(role: str) -> set[str]:
    return get_auth_config().permissions_for_role(role)


def test_org_audit_query_is_pinned_to_the_scope():
    sql = str(org_audit_query(SCOPE, before=None, action=None, limit=50).compile())
    assert "audit_events.tenant_id = " in sql


def test_github_connect_and_disconnect_are_audited():
    assert '"github_connected"' in inspect.getsource(install_callback)
    assert '"github_disconnected"' in inspect.getsource(disconnect)


def test_only_the_admin_reads_the_audit_log():
    assert "audit:read" in _permissions(ADMIN)
    assert "audit:read" not in _permissions(MEMBER)
    assert "audit:read" not in _permissions(VIEWER)
