from pydantic import BaseModel, Field


class AccountSetPasswordRequest(BaseModel):
    password: str = Field(..., min_length=8, max_length=128)


class AccountDisconnectSsoRequest(BaseModel):
    password: str = Field(..., min_length=8, max_length=128)


class AccountActionResponse(BaseModel):
    ok: bool = True
    message: str | None = None


class AccountChangeEmailRequest(BaseModel):
    new_email: str = Field(..., min_length=3, max_length=320)


class AccountConfirmEmailChangeRequest(BaseModel):
    confirmation_code: str = Field(..., min_length=3, max_length=32)


class AccountDeleteRequest(BaseModel):
    confirmation: str = Field(..., min_length=1, max_length=32)

