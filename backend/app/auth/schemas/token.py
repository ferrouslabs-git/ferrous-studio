"""
Token schemas for JWT payload validation
"""

from pydantic import BaseModel, ConfigDict, Field
from typing import Optional, Union, List


class TokenPayload(BaseModel):
    """Cognito JWT token payload"""
    model_config = ConfigDict(extra="allow")

    sub: str = Field(..., description="Cognito user ID (subject)")
    email: Optional[str] = Field(None, description="User email address")
    username: Optional[str] = Field(None, description="Cognito username")
    name: Optional[str] = Field(None, description="User's full name")
    given_name: Optional[str] = Field(None, description="User's first name")
    family_name: Optional[str] = Field(None, description="User's last name")
    scope: Optional[str] = Field(None, description="OAuth scopes for access token")
    client_id: Optional[str] = Field(None, description="Cognito app client ID claim")
    aud: Optional[Union[str, List[str]]] = Field(None, description="Audience claim")

    exp: int = Field(..., description="Expiration timestamp")
    iat: int = Field(..., description="Issued at timestamp")
    token_use: Optional[str] = Field(None, description="Token type (access/id)")
