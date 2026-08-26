"""
Settings for the auth module.

This file should define module-specific settings only.
Host apps own shared runtime settings (for example DATABASE_URL).
"""
import os
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Auth module settings loaded from environment variables."""

    # Cognito
    cognito_region: str = os.getenv("COGNITO_REGION", "eu-west-1")
    cognito_user_pool_id: str = os.getenv("COGNITO_USER_POOL_ID", "")
    cognito_client_id: str = os.getenv("COGNITO_CLIENT_ID", "")
    cognito_domain: str = os.getenv("COGNITO_DOMAIN", "")

    # SES (optional)
    ses_region: str = os.getenv("SES_REGION", "")
    ses_sender_email: str = os.getenv("SES_SENDER_EMAIL", "")

    # Frontend
    frontend_url: str = os.getenv("FRONTEND_URL", "http://localhost:5173")
    # Cookie security:
    # - In production (HTTPS), this MUST be true.
    # - In local dev (http://localhost) a Secure cookie will be dropped by the browser,
    #   which breaks refresh-token persistence and causes "logout on refresh".
    _cookie_secure_raw: str = os.getenv("COOKIE_SECURE", "").strip().lower()

    @property
    def cookie_secure(self) -> bool:
        if self._cookie_secure_raw in ("true", "1", "yes", "on"):
            return True
        if self._cookie_secure_raw in ("false", "0", "no", "off"):
            return False
        # Not explicitly set → infer from frontend_url scheme
        return self.frontend_url.strip().lower().startswith("https://")

    # Auth config (v3.0)
    auth_config_path: str = os.getenv(
        "AUTH_CONFIG_PATH",
        os.path.join(os.path.dirname(__file__), "auth_config.yaml"),
    )

    # Auth mode: "hosted_ui" (default) or "custom_ui"
    # hosted_ui = Cognito Hosted UI redirects (existing behaviour)
    # custom_ui = App-owned login/signup forms calling Cognito API directly
    auth_mode: str = os.getenv("AUTH_MODE", "hosted_ui")

    # Portability
    auth_namespace: str = os.getenv("AUTH_NAMESPACE", "auth")
    # Default is "/auth". Set AUTH_API_PREFIX="/v1/auth" for versioned APIs.
    auth_api_prefix: str = os.getenv("AUTH_API_PREFIX", "/auth")
    auth_cookie_name: str = os.getenv("AUTH_COOKIE_NAME", "")
    auth_cookie_path: str = os.getenv("AUTH_COOKIE_PATH", "")
    auth_csrf_cookie_name: str = os.getenv("AUTH_CSRF_COOKIE_NAME", "")

    @property
    def resolved_auth_cookie_name(self) -> str:
        if self.auth_cookie_name:
            return self.auth_cookie_name
        return f"{self.auth_namespace}_refresh_token"

    @property
    def resolved_auth_cookie_path(self) -> str:
        if self.auth_cookie_path:
            return self.auth_cookie_path
        return f"{self.auth_api_prefix.rstrip('/')}/token"

    @property
    def resolved_auth_csrf_cookie_name(self) -> str:
        if self.auth_csrf_cookie_name:
            return self.auth_csrf_cookie_name
        return f"{self.auth_namespace}_csrf_token"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


@lru_cache()
def get_settings() -> Settings:
    """Return cached settings instance."""
    return Settings()
