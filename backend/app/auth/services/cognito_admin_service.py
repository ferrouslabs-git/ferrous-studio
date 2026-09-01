"""
Cognito admin operations for custom_ui auth mode.

Uses boto3 AdminCreateUser / AdminSetUserPassword to pre-provision
invited users in FORCE_CHANGE_PASSWORD state, so the frontend can
present a "set password" form instead of the full Hosted UI signup.

This service is ONLY called when AUTH_MODE=custom_ui.
No new DB runtime objects — follows host integration contract.
"""
from __future__ import annotations

import asyncio
import logging
import secrets
import string

import boto3
from botocore.exceptions import ClientError

from ..config import get_settings

logger = logging.getLogger(__name__)

_COGNITO_IDP_CLIENT = None


def _generate_temp_password(length: int = 24) -> str:
    """Generate a cryptographically random temporary password.

    Meets Cognito default password policy (upper, lower, digit, special).
    """
    alphabet = string.ascii_letters + string.digits + "!@#$%^&*()-_=+"
    while True:
        password = "".join(secrets.choice(alphabet) for _ in range(length))
        has_upper = any(c.isupper() for c in password)
        has_lower = any(c.islower() for c in password)
        has_digit = any(c.isdigit() for c in password)
        has_special = any(c in "!@#$%^&*()-_=+" for c in password)
        if has_upper and has_lower and has_digit and has_special:
            return password


def _get_cognito_client():
    """Return a cached Cognito IDP client.

    Creating boto3 clients has a small setup cost; reusing the client is safe and
    improves latency for high-frequency auth flows (login/signup/confirm/etc.).
    """
    global _COGNITO_IDP_CLIENT
    if _COGNITO_IDP_CLIENT is None:
        settings = get_settings()
        _COGNITO_IDP_CLIENT = boto3.client("cognito-idp", region_name=settings.cognito_region)
    return _COGNITO_IDP_CLIENT


def list_users_by_email(email: str, *, limit: int = 1) -> dict:
    """List Cognito users by email (returns raw Users list)."""
    settings = get_settings()
    client = _get_cognito_client()
    try:
        res = client.list_users(
            UserPoolId=settings.cognito_user_pool_id,
            Filter=f'email = "{email}"',
            Limit=limit,
        )
        return {"users": res.get("Users") or []}
    except ClientError as e:
        error_code = e.response["Error"]["Code"]
        error_msg = e.response["Error"]["Message"]
        logger.error("Cognito ListUsers failed", extra={"email": email, "error_code": error_code, "error": error_msg})
        return {"error": f"Failed to list users: {error_msg}"}


def admin_create_native_user_for_email(email: str) -> dict:
    """Create a native Cognito user (SUPPRESS message) for an email.

    Cognito AdminCreateUser requires a temporary password. We generate one but suppress
    Cognito email; user can set a real password later via AdminSetUserPassword.
    """
    settings = get_settings()
    client = _get_cognito_client()
    temp_password = _generate_temp_password()
    try:
        response = client.admin_create_user(
            UserPoolId=settings.cognito_user_pool_id,
            Username=email,
            UserAttributes=[
                {"Name": "email", "Value": email},
                {"Name": "email_verified", "Value": "true"},
            ],
            TemporaryPassword=temp_password,
            MessageAction="SUPPRESS",
            DesiredDeliveryMediums=["EMAIL"],
        )
        attrs = {a["Name"]: a["Value"] for a in response.get("User", {}).get("Attributes", [])}
        return {"ok": True, "username": response.get("User", {}).get("Username") or email, "sub": attrs.get("sub")}
    except ClientError as e:
        error_code = e.response["Error"]["Code"]
        error_msg = e.response["Error"]["Message"]
        if error_code == "UsernameExistsException":
            return {"ok": True, "already_exists": True, "username": email}
        logger.error("Cognito AdminCreateUser failed", extra={"email": email, "error_code": error_code, "error": error_msg})
        return {"error": f"Failed to create native user: {error_msg}"}


def admin_link_provider_for_user(*, destination_username: str, provider_name: str, provider_user_id: str) -> dict:
    """Link an external provider identity to a Cognito user (AdminLinkProviderForUser)."""
    settings = get_settings()
    client = _get_cognito_client()
    try:
        client.admin_link_provider_for_user(
            UserPoolId=settings.cognito_user_pool_id,
            DestinationUser={
                "ProviderName": "Cognito",
                "ProviderAttributeName": "Cognito_Subject",
                "ProviderAttributeValue": destination_username,
            },
            SourceUser={
                "ProviderName": provider_name,
                "ProviderAttributeName": "Cognito_Subject",
                "ProviderAttributeValue": provider_user_id,
            },
        )
        return {"ok": True}
    except ClientError as e:
        error_code = e.response["Error"]["Code"]
        error_msg = e.response["Error"]["Message"]
        if error_code in ("ResourceNotFoundException", "InvalidParameterException"):
            return {"error": f"Link failed: {error_msg}"}
        logger.error(
            "Cognito AdminLinkProviderForUser failed",
            extra={"destination_username": destination_username, "provider_name": provider_name, "error_code": error_code, "error": error_msg},
        )
        return {"error": f"Link failed: {error_msg}"}


def admin_set_user_password(username: str, password: str, *, permanent: bool = True) -> dict:
    """Set a Cognito user's password (AdminSetUserPassword)."""
    settings = get_settings()
    client = _get_cognito_client()

    try:
        client.admin_set_user_password(
            UserPoolId=settings.cognito_user_pool_id,
            Username=username,
            Password=password,
            Permanent=permanent,
        )
        return {"ok": True}
    except ClientError as e:
        error_code = e.response["Error"]["Code"]
        error_msg = e.response["Error"]["Message"]
        if error_code == "UserNotFoundException":
            return {"error": "User not found in Cognito"}
        if error_code == "InvalidPasswordException":
            return {"error": f"Password does not meet requirements: {error_msg}"}
        logger.error(
            "Cognito AdminSetUserPassword failed",
            extra={"username": username, "error_code": error_code, "error": error_msg},
        )
        return {"error": f"Failed to set password: {error_msg}"}


def admin_disable_provider_for_user(
    *, provider_name: str, provider_subject: str,
) -> dict:
    """Unlink a federated (SSO) identity provider from a user (AdminDisableProviderForUser)."""
    settings = get_settings()
    client = _get_cognito_client()

    try:
        client.admin_disable_provider_for_user(
            UserPoolId=settings.cognito_user_pool_id,
            User={
                "ProviderName": provider_name,
                "ProviderAttributeName": "Cognito_Subject",
                "ProviderAttributeValue": provider_subject,
            },
        )
        return {"ok": True}
    except ClientError as e:
        error_code = e.response["Error"]["Code"]
        error_msg = e.response["Error"]["Message"]
        if error_code == "UserNotFoundException":
            return {"error": "User not found in Cognito"}
        logger.error(
            "Cognito AdminDisableProviderForUser failed",
            extra={
                "provider_name": provider_name,
                "provider_subject": provider_subject,
                "error_code": error_code,
                "error": error_msg,
            },
        )
        return {"error": f"Failed to disconnect provider: {error_msg}"}


def create_invited_cognito_user(email: str) -> dict:
    """Pre-create a Cognito user for an invited email address.

    The user is created with MessageAction=SUPPRESS (Cognito does NOT
    send its own welcome email — our invitation email handles that)
    and a temporary password.  The user lands in FORCE_CHANGE_PASSWORD
    state so the invitation link can present a "set your password" form.

    Returns dict with 'cognito_sub', 'status' and 'existing' on success,
    or an 'error' key on failure.

    Idempotent: if the address already has a Cognito user the account is
    left untouched (never reset a confirmed user's password — they may be
    an existing member being invited to a second organisation) and its
    current status is reported so callers can decide how to proceed.
    """
    settings = get_settings()
    client = _get_cognito_client()
    temp_password = _generate_temp_password()

    try:
        response = client.admin_create_user(
            UserPoolId=settings.cognito_user_pool_id,
            Username=email,
            UserAttributes=[
                {"Name": "email", "Value": email},
                {"Name": "email_verified", "Value": "true"},
            ],
            TemporaryPassword=temp_password,
            MessageAction="SUPPRESS",  # We send our own email
            DesiredDeliveryMediums=["EMAIL"],
        )
        cognito_sub = None
        for attr in response.get("User", {}).get("Attributes", []):
            if attr["Name"] == "sub":
                cognito_sub = attr["Value"]

        logger.info(
            "Created Cognito user for invitation",
            extra={"email": email, "cognito_sub": cognito_sub},
        )
        return {
            "cognito_sub": cognito_sub,
            "status": "FORCE_CHANGE_PASSWORD",
            "existing": False,
        }

    except ClientError as e:
        error_code = e.response["Error"]["Code"]

        if error_code == "UsernameExistsException":
            existing = admin_get_user(email)
            if "error" in existing:
                return existing
            logger.info(
                "Cognito user already exists for invitation; left untouched",
                extra={"email": email, "status": existing.get("status")},
            )
            return {
                "cognito_sub": existing.get("attributes", {}).get("sub"),
                "status": existing.get("status"),
                "existing": True,
            }

        logger.error(
            "Cognito AdminCreateUser failed",
            extra={"email": email, "error_code": error_code, "error": str(e)},
        )
        return {"error": f"Cognito error: {e.response['Error']['Message']}"}


def admin_initiate_auth(email: str, password: str) -> dict:
    """Authenticate server-side via ADMIN_USER_PASSWORD_AUTH.

    Used by the invitation flow right after the invitee's password has been
    set, so they are signed in without a second round trip. Requires
    ALLOW_ADMIN_USER_PASSWORD_AUTH on the app client (infra/terraform/cognito.tf)
    and cognito-idp:AdminInitiateAuth on the task role.
    """
    settings = get_settings()
    client = _get_cognito_client()

    try:
        response = client.admin_initiate_auth(
            UserPoolId=settings.cognito_user_pool_id,
            ClientId=settings.cognito_client_id,
            AuthFlow="ADMIN_USER_PASSWORD_AUTH",
            AuthParameters={"USERNAME": email, "PASSWORD": password},
        )
        if "AuthenticationResult" in response:
            result = response["AuthenticationResult"]
            return {
                "authenticated": True,
                "access_token": result["AccessToken"],
                "id_token": result["IdToken"],
                "refresh_token": result.get("RefreshToken"),
                "expires_in": result.get("ExpiresIn", 3600),
            }
        if "ChallengeName" in response:
            return {
                "authenticated": False,
                "challenge": response["ChallengeName"],
                "session": response.get("Session"),
            }
        return {"error": "Unexpected Cognito response"}

    except ClientError as e:
        error_code = e.response["Error"]["Code"]
        error_msg = e.response["Error"]["Message"]
        if error_code in ("NotAuthorizedException", "UserNotFoundException"):
            return {"error": "Invalid email or password"}
        if error_code == "UserNotConfirmedException":
            return {"error": "Account not confirmed. Please check your email."}
        if error_code == "PasswordResetRequiredException":
            return {"error": "Password reset required"}
        logger.error(
            "Cognito AdminInitiateAuth failed",
            extra={"email": email, "error_code": error_code, "error": error_msg},
        )
        if error_code == "InvalidParameterException" and "flow" in error_msg.lower():
            return {"error": "Server-side sign-in is not enabled on the Cognito app client"}
        return {"error": f"Sign-in failed: {error_msg}"}


def initiate_auth(email: str, password: str) -> dict:
    """Authenticate a user via USER_PASSWORD_AUTH flow.

    Returns Cognito tokens on success, or challenge details if
    NEW_PASSWORD_REQUIRED (invited user first login).
    """
    settings = get_settings()
    client = _get_cognito_client()

    def _try_initiate(username: str) -> dict:
        response = client.initiate_auth(
            ClientId=settings.cognito_client_id,
            AuthFlow="USER_PASSWORD_AUTH",
            AuthParameters={
                "USERNAME": username,
                "PASSWORD": password,
            },
        )

        # Successful auth — return tokens
        if "AuthenticationResult" in response:
            result = response["AuthenticationResult"]
            return {
                "authenticated": True,
                "access_token": result["AccessToken"],
                "id_token": result["IdToken"],
                "refresh_token": result.get("RefreshToken"),
                "expires_in": result.get("ExpiresIn", 3600),
            }

        # Challenge response (e.g. NEW_PASSWORD_REQUIRED for invited users)
        if "ChallengeName" in response:
            return {
                "authenticated": False,
                "challenge": response["ChallengeName"],
                "session": response["Session"],
                "challenge_parameters": response.get("ChallengeParameters", {}),
            }

        return {"error": "Unexpected Cognito response"}

    def _resolve_username_by_email(user_email: str) -> str | None:
        """Resolve Cognito Username via ListUsers(email=...)."""
        try:
            res = client.list_users(
                UserPoolId=settings.cognito_user_pool_id,
                Filter=f'email = "{user_email}"',
                Limit=1,
            )
            users = res.get("Users") or []
            if not users:
                return None
            username = users[0].get("Username")
            return username.strip() if isinstance(username, str) and username.strip() else None
        except ClientError as exc:
            logger.error(
                "Cognito ListUsers failed during login fallback",
                extra={
                    "email": user_email,
                    "error_code": exc.response.get("Error", {}).get("Code"),
                    "error": exc.response.get("Error", {}).get("Message"),
                },
            )
            return None

    try:
        # Primary attempt: treat email as USERNAME (works for native users where username=email).
        return _try_initiate(email)

    except ClientError as e:
        error_code = e.response["Error"]["Code"]
        error_msg = e.response["Error"]["Message"]

        if error_code in ("NotAuthorizedException", "UserNotFoundException"):
            # Fallback: for federated users, pool Username is often google_*/microsoft_*.
            # Resolve by email and retry once so users can still log in with email + password.
            resolved = _resolve_username_by_email(email)
            if resolved and resolved != email:
                try:
                    return _try_initiate(resolved)
                except ClientError:
                    return {"error": "Invalid email or password"}
            return {"error": "Invalid email or password"}
        if error_code == "UserNotConfirmedException":
            return {"error": "Account not confirmed. Please check your email."}
        if error_code == "PasswordResetRequiredException":
            return {"error": "Password reset required"}

        logger.error("Cognito InitiateAuth failed", extra={"error_code": error_code, "error": error_msg})
        return {"error": f"Authentication failed: {error_msg}"}


def respond_to_new_password_challenge(email: str, new_password: str, session: str) -> dict:
    """Complete the NEW_PASSWORD_REQUIRED challenge for invited users.

    Called after initiate_auth returns challenge='NEW_PASSWORD_REQUIRED'.
    The user provides their chosen password and the Cognito session token.
    """
    settings = get_settings()
    client = _get_cognito_client()

    try:
        response = client.respond_to_auth_challenge(
            ClientId=settings.cognito_client_id,
            ChallengeName="NEW_PASSWORD_REQUIRED",
            Session=session,
            ChallengeResponses={
                "USERNAME": email,
                "NEW_PASSWORD": new_password,
            },
        )

        if "AuthenticationResult" in response:
            result = response["AuthenticationResult"]
            return {
                "authenticated": True,
                "access_token": result["AccessToken"],
                "id_token": result["IdToken"],
                "refresh_token": result.get("RefreshToken"),
                "expires_in": result.get("ExpiresIn", 3600),
            }

        return {"error": "Unexpected response from Cognito"}

    except ClientError as e:
        error_code = e.response["Error"]["Code"]
        error_msg = e.response["Error"]["Message"]

        if error_code == "InvalidPasswordException":
            return {"error": f"Password does not meet requirements: {error_msg}"}
        if error_code == "CodeMismatchException":
            return {"error": "Session expired. Please restart the sign-in process."}

        logger.error(
            "Cognito RespondToAuthChallenge failed",
            extra={"error_code": error_code, "error": error_msg},
        )
        return {"error": f"Password setup failed: {error_msg}"}


def sign_up_user(email: str, password: str) -> dict:
    """Self-service user signup via Cognito SignUp API.

    Used in custom_ui mode instead of the Hosted UI signup page.
    Returns confirmation status — user may need to verify email.
    """
    settings = get_settings()
    client = _get_cognito_client()

    try:
        response = client.sign_up(
            ClientId=settings.cognito_client_id,
            Username=email,
            Password=password,
            UserAttributes=[
                {"Name": "email", "Value": email},
            ],
        )

        return {
            "user_sub": response["UserSub"],
            "confirmed": response["UserConfirmed"],
            "delivery": response.get("CodeDeliveryDetails", {}),
        }

    except ClientError as e:
        error_code = e.response["Error"]["Code"]
        error_msg = e.response["Error"]["Message"]

        if error_code == "UsernameExistsException":
            return {"error": "An account with this email already exists"}
        if error_code == "InvalidPasswordException":
            return {"error": f"Password does not meet requirements: {error_msg}"}
        if error_code == "InvalidParameterException":
            return {"error": f"Invalid input: {error_msg}"}

        logger.error("Cognito SignUp failed", extra={"error_code": error_code, "error": error_msg})
        return {"error": f"Signup failed: {error_msg}"}


def confirm_sign_up(email: str, confirmation_code: str) -> dict:
    """Confirm a user's email after self-service signup."""
    settings = get_settings()
    client = _get_cognito_client()

    try:
        client.confirm_sign_up(
            ClientId=settings.cognito_client_id,
            Username=email,
            ConfirmationCode=confirmation_code,
        )
        return {"confirmed": True}

    except ClientError as e:
        error_code = e.response["Error"]["Code"]
        error_msg = e.response["Error"]["Message"]

        if error_code == "CodeMismatchException":
            return {"error": "Invalid confirmation code"}
        if error_code == "ExpiredCodeException":
            return {"error": "Confirmation code has expired. Please request a new one."}
        if error_code == "AliasExistsException":
            return {"error": "This email is already confirmed with another account"}

        logger.error("Cognito ConfirmSignUp failed", extra={"error_code": error_code, "error": error_msg})
        return {"error": f"Confirmation failed: {error_msg}"}


def resend_confirmation_code(email: str) -> dict:
    """Resend the email confirmation code for an unconfirmed user."""
    settings = get_settings()
    client = _get_cognito_client()

    try:
        response = client.resend_confirmation_code(
            ClientId=settings.cognito_client_id,
            Username=email,
        )
        return {"sent": True, "delivery": response.get("CodeDeliveryDetails", {})}

    except ClientError as e:
        error_code = e.response["Error"]["Code"]
        error_msg = e.response["Error"]["Message"]
        logger.error("Cognito ResendCode failed", extra={"error_code": error_code, "error": error_msg})
        return {"error": f"Failed to resend code: {error_msg}"}


def forgot_password(email: str) -> dict:
    """Initiate the forgot-password flow — Cognito sends a reset code to the user's email."""
    settings = get_settings()
    client = _get_cognito_client()

    try:
        response = client.forgot_password(
            ClientId=settings.cognito_client_id,
            Username=email,
        )
        return {"sent": True, "delivery": response.get("CodeDeliveryDetails", {})}

    except ClientError as e:
        error_code = e.response["Error"]["Code"]
        error_msg = e.response["Error"]["Message"]

        if error_code == "UserNotFoundException":
            # Don't reveal whether the email exists
            return {"sent": True, "delivery": {}}
        if error_code == "LimitExceededException":
            return {"error": "Too many attempts. Please try again later."}
        if error_code == "InvalidParameterException":
            return {"error": "Cannot reset password for this account. Please contact support."}

        logger.error("Cognito ForgotPassword failed", extra={"error_code": error_code, "error": error_msg})
        return {"error": f"Password reset failed: {error_msg}"}


def confirm_forgot_password(email: str, code: str, new_password: str) -> dict:
    """Complete the forgot-password flow with the reset code and a new password."""
    settings = get_settings()
    client = _get_cognito_client()

    try:
        client.confirm_forgot_password(
            ClientId=settings.cognito_client_id,
            Username=email,
            ConfirmationCode=code,
            Password=new_password,
        )
        return {"confirmed": True}

    except ClientError as e:
        error_code = e.response["Error"]["Code"]
        error_msg = e.response["Error"]["Message"]

        if error_code == "CodeMismatchException":
            return {"error": "Invalid reset code"}
        if error_code == "ExpiredCodeException":
            return {"error": "Reset code has expired. Please request a new one."}
        if error_code == "InvalidPasswordException":
            return {"error": f"Password does not meet requirements: {error_msg}"}

        logger.error("Cognito ConfirmForgotPassword failed", extra={"error_code": error_code, "error": error_msg})
        return {"error": f"Password reset failed: {error_msg}"}


# ── Admin operations (platform-admin only) ──────────────────────


def admin_delete_user(email: str) -> dict:
    """Permanently delete a user from the Cognito user pool.

    This is irreversible. The caller must handle local DB cleanup separately.
    """
    settings = get_settings()
    client = _get_cognito_client()

    try:
        client.admin_delete_user(
            UserPoolId=settings.cognito_user_pool_id,
            Username=email,
        )
        logger.info("Deleted Cognito user", extra={"email": email})
        return {"deleted": True}

    except ClientError as e:
        error_code = e.response["Error"]["Code"]
        error_msg = e.response["Error"]["Message"]

        if error_code == "UserNotFoundException":
            # Already gone — treat as success
            logger.info("Cognito user already absent", extra={"email": email})
            return {"deleted": True, "already_absent": True}

        logger.error("Cognito AdminDeleteUser failed", extra={"email": email, "error_code": error_code, "error": error_msg})
        return {"error": f"Failed to delete Cognito user: {error_msg}"}


def admin_delete_user_by_username(username: str) -> dict:
    """Permanently delete a user from the Cognito user pool by pool Username."""
    settings = get_settings()
    client = _get_cognito_client()
    try:
        client.admin_delete_user(
            UserPoolId=settings.cognito_user_pool_id,
            Username=username,
        )
        logger.info("Deleted Cognito user", extra={"username": username})
        return {"deleted": True}
    except ClientError as e:
        error_code = e.response["Error"]["Code"]
        error_msg = e.response["Error"]["Message"]
        if error_code == "UserNotFoundException":
            logger.info("Cognito user already absent", extra={"username": username})
            return {"deleted": True, "already_absent": True}
        logger.error(
            "Cognito AdminDeleteUser failed",
            extra={"username": username, "error_code": error_code, "error": error_msg},
        )
        return {"error": f"Failed to delete Cognito user: {error_msg}"}


def admin_disable_user(email: str) -> dict:
    """Disable a user in Cognito (prevents all sign-in but preserves the account)."""
    settings = get_settings()
    client = _get_cognito_client()

    try:
        client.admin_disable_user(
            UserPoolId=settings.cognito_user_pool_id,
            Username=email,
        )
        logger.info("Disabled Cognito user", extra={"email": email})
        return {"disabled": True}

    except ClientError as e:
        error_code = e.response["Error"]["Code"]
        error_msg = e.response["Error"]["Message"]

        if error_code == "UserNotFoundException":
            return {"error": "User not found in Cognito"}

        logger.error("Cognito AdminDisableUser failed", extra={"email": email, "error_code": error_code, "error": error_msg})
        return {"error": f"Failed to disable Cognito user: {error_msg}"}


def admin_enable_user(email: str) -> dict:
    """Re-enable a previously disabled Cognito user."""
    settings = get_settings()
    client = _get_cognito_client()

    try:
        client.admin_enable_user(
            UserPoolId=settings.cognito_user_pool_id,
            Username=email,
        )
        logger.info("Enabled Cognito user", extra={"email": email})
        return {"enabled": True}

    except ClientError as e:
        error_code = e.response["Error"]["Code"]
        error_msg = e.response["Error"]["Message"]

        if error_code == "UserNotFoundException":
            return {"error": "User not found in Cognito"}

        logger.error("Cognito AdminEnableUser failed", extra={"email": email, "error_code": error_code, "error": error_msg})
        return {"error": f"Failed to enable Cognito user: {error_msg}"}


def admin_get_user(username: str) -> dict:
    """Look up a user's status and attributes in Cognito.

    Note: Cognito expects the pool's Username (often sub UUID, or google_*/microsoft_*),
    which is not always the email attribute.
    """
    settings = get_settings()
    client = _get_cognito_client()

    try:
        response = client.admin_get_user(
            UserPoolId=settings.cognito_user_pool_id,
            Username=username,
        )
        attributes = {
            attr["Name"]: attr["Value"]
            for attr in response.get("UserAttributes", [])
        }
        return {
            "username": response["Username"],
            "status": response.get("UserStatus"),
            "enabled": response.get("Enabled", True),
            "created_at": response.get("UserCreateDate"),
            "modified_at": response.get("UserLastModifiedDate"),
            "attributes": attributes,
        }

    except ClientError as e:
        error_code = e.response["Error"]["Code"]
        error_msg = e.response["Error"]["Message"]

        if error_code == "UserNotFoundException":
            return {"error": "User not found in Cognito"}

        logger.error("Cognito AdminGetUser failed", extra={"username": username, "error_code": error_code, "error": error_msg})
        return {"error": f"Failed to get Cognito user: {error_msg}"}


def update_user_attributes(*, access_token: str, attributes: list[dict]) -> dict:
    """Update user attributes using the user's access token (UpdateUserAttributes).

    This triggers Cognito's built-in verification email when updating the email attribute.
    """
    client = _get_cognito_client()
    try:
        client.update_user_attributes(
            AccessToken=access_token,
            UserAttributes=attributes,
        )
        return {"ok": True}
    except ClientError as e:
        error_code = e.response["Error"]["Code"]
        error_msg = e.response["Error"]["Message"]
        if error_code == "AliasExistsException":
            return {"error": "An account with this email already exists", "error_kind": "duplicate_email"}
        if error_code == "InvalidParameterException":
            return {"error": error_msg, "error_kind": "invalid_parameter"}
        if error_code == "NotAuthorizedException":
            return {"error": "Not authorized", "error_kind": "not_authorized"}
        logger.error(
            "Cognito UpdateUserAttributes failed",
            extra={"error_code": error_code, "error": error_msg},
        )
        return {"error": f"Failed to update attributes: {error_msg}", "error_kind": "cognito_call_failed"}


def verify_user_attribute(*, access_token: str, attribute_name: str, code: str) -> dict:
    """Verify a user attribute using the user's access token (VerifyUserAttribute)."""
    client = _get_cognito_client()
    try:
        client.verify_user_attribute(
            AccessToken=access_token,
            AttributeName=attribute_name,
            Code=code,
        )
        return {"ok": True}
    except ClientError as e:
        error_code = e.response["Error"]["Code"]
        error_msg = e.response["Error"]["Message"]
        if error_code == "CodeMismatchException":
            return {"error": "Invalid confirmation code", "error_kind": "code_mismatch"}
        if error_code == "ExpiredCodeException":
            return {"error": "Confirmation code has expired. Please request a new one.", "error_kind": "code_expired"}
        if error_code == "NotAuthorizedException":
            return {"error": "Not authorized", "error_kind": "not_authorized"}
        logger.error(
            "Cognito VerifyUserAttribute failed",
            extra={"error_code": error_code, "error": error_msg},
        )
        return {"error": f"Failed to verify attribute: {error_msg}", "error_kind": "cognito_call_failed"}


def admin_reset_user_password(email: str) -> dict:
    """Force a password reset — Cognito sends a reset code to the user's email.

    The user must complete the reset flow on their next login.
    """
    settings = get_settings()
    client = _get_cognito_client()

    try:
        client.admin_reset_user_password(
            UserPoolId=settings.cognito_user_pool_id,
            Username=email,
        )
        logger.info("Reset Cognito user password", extra={"email": email})
        return {"reset_initiated": True}

    except ClientError as e:
        error_code = e.response["Error"]["Code"]
        error_msg = e.response["Error"]["Message"]

        if error_code == "UserNotFoundException":
            return {"error": "User not found in Cognito"}
        if error_code == "InvalidParameterException":
            return {"error": "Cannot reset password for this user. They may need to confirm their account first."}

        logger.error("Cognito AdminResetUserPassword failed", extra={"email": email, "error_code": error_code, "error": error_msg})
        return {"error": f"Failed to reset password: {error_msg}"}


# ── Async wrappers (offload blocking boto3 to thread) ───────────


async def create_invited_cognito_user_async(email: str) -> dict:
    return await asyncio.to_thread(create_invited_cognito_user, email)


async def initiate_auth_async(email: str, password: str) -> dict:
    return await asyncio.to_thread(initiate_auth, email, password)


async def admin_initiate_auth_async(email: str, password: str) -> dict:
    return await asyncio.to_thread(admin_initiate_auth, email, password)


async def respond_to_new_password_challenge_async(
    email: str, new_password: str, session: str,
) -> dict:
    return await asyncio.to_thread(
        respond_to_new_password_challenge, email, new_password, session,
    )


async def sign_up_user_async(email: str, password: str) -> dict:
    return await asyncio.to_thread(sign_up_user, email, password)


async def confirm_sign_up_async(email: str, confirmation_code: str) -> dict:
    return await asyncio.to_thread(confirm_sign_up, email, confirmation_code)


async def resend_confirmation_code_async(email: str) -> dict:
    return await asyncio.to_thread(resend_confirmation_code, email)


async def forgot_password_async(email: str) -> dict:
    return await asyncio.to_thread(forgot_password, email)


async def confirm_forgot_password_async(
    email: str, code: str, new_password: str,
) -> dict:
    return await asyncio.to_thread(confirm_forgot_password, email, code, new_password)


async def admin_delete_user_async(email: str) -> dict:
    return await asyncio.to_thread(admin_delete_user, email)


async def admin_delete_user_by_username_async(username: str) -> dict:
    return await asyncio.to_thread(admin_delete_user_by_username, username)


async def admin_disable_user_async(email: str) -> dict:
    return await asyncio.to_thread(admin_disable_user, email)


async def admin_enable_user_async(email: str) -> dict:
    return await asyncio.to_thread(admin_enable_user, email)


async def admin_get_user_async(username: str) -> dict:
    return await asyncio.to_thread(admin_get_user, username)


async def admin_reset_user_password_async(email: str) -> dict:
    return await asyncio.to_thread(admin_reset_user_password, email)


async def admin_set_user_password_async(username: str, password: str, *, permanent: bool = True) -> dict:
    return await asyncio.to_thread(admin_set_user_password, username, password, permanent=permanent)


async def admin_disable_provider_for_user_async(*, provider_name: str, provider_subject: str) -> dict:
    return await asyncio.to_thread(
        admin_disable_provider_for_user,
        provider_name=provider_name,
        provider_subject=provider_subject,
    )


async def list_users_by_email_async(email: str, *, limit: int = 1) -> dict:
    return await asyncio.to_thread(list_users_by_email, email, limit=limit)


async def admin_create_native_user_for_email_async(email: str) -> dict:
    return await asyncio.to_thread(admin_create_native_user_for_email, email)


async def admin_link_provider_for_user_async(*, destination_username: str, provider_name: str, provider_user_id: str) -> dict:
    return await asyncio.to_thread(
        admin_link_provider_for_user,
        destination_username=destination_username,
        provider_name=provider_name,
        provider_user_id=provider_user_id,
    )


async def update_user_attributes_async(*, access_token: str, attributes: list[dict]) -> dict:
    return await asyncio.to_thread(update_user_attributes, access_token=access_token, attributes=attributes)


async def verify_user_attribute_async(*, access_token: str, attribute_name: str, code: str) -> dict:
    return await asyncio.to_thread(
        verify_user_attribute,
        access_token=access_token,
        attribute_name=attribute_name,
        code=code,
    )
