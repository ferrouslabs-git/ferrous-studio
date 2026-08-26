from typing import Literal, Optional

from pydantic import BaseModel


AuthType = Literal["sso", "email"]
AuthProvider = Literal["Google", "microsoft"]


class AuthTypeResponse(BaseModel):
    auth_type: AuthType
    provider: Optional[AuthProvider] = None
    has_password: bool

