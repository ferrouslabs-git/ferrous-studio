"""
Email service for invitation delivery via AWS SES.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
import logging

import boto3
from botocore.exceptions import ClientError

from ..config import get_settings


logger = logging.getLogger(__name__)


@dataclass
class EmailSendResult:
    sent: bool
    provider: str
    detail: str
    message_id: str | None = None


def _get_invitation_email_html(invite_url: str, tenant_name: str) -> str:
    """Generate HTML email body for invitation."""
    return f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 28px;">You're Invited!</h1>
    </div>
    
    <div style="background: #ffffff; padding: 40px 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 8px 8px;">
        <p style="font-size: 16px; margin-bottom: 20px;">You've been invited to join <strong>{tenant_name}</strong>.</p>
        
        <p style="font-size: 16px; margin-bottom: 30px;">Click the button below to accept your invitation and get started:</p>
        
        <div style="text-align: center; margin: 30px 0;">
            <a href="{invite_url}" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 14px 32px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px; display: inline-block; box-shadow: 0 4px 6px rgba(102, 126, 234, 0.3);">Accept Invitation</a>
        </div>
        
        <p style="font-size: 14px; color: #666; margin-top: 30px;">Or copy and paste this URL into your browser:</p>
        <p style="font-size: 13px; color: #667eea; word-break: break-all; background: #f5f5f5; padding: 12px; border-radius: 4px; border-left: 3px solid #667eea;">{invite_url}</p>
        
        <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 30px 0;">
        
        <p style="font-size: 12px; color: #999; margin: 0;">If you didn't expect this invitation, you can safely ignore this email.</p>
    </div>
</body>
</html>"""


def _get_invitation_email_text(invite_url: str, tenant_name: str) -> str:
    """Generate plain text email body for invitation."""
    return f"""You're Invited!

You've been invited to join {tenant_name}.

Click the link below to accept your invitation and get started:
{invite_url}

If you didn't expect this invitation, you can safely ignore this email.
"""


async def send_invitation_email(to_email: str, invite_url: str, tenant_name: str) -> EmailSendResult:
    """Send invitation email via AWS SES.

    Offloads the blocking boto3 SES call to a thread so the async
    event loop stays free.
    """
    settings = get_settings()

    if not settings.ses_region or not settings.ses_sender_email:
        logger.warning(
            "SES config missing; invitation email not sent",
            extra={
                "to_email": to_email,
                "tenant_name": tenant_name,
            },
        )
        return EmailSendResult(
            sent=False,
            provider="ses",
            detail="SES not configured (missing SES_REGION or SES_SENDER_EMAIL)",
        )

    return await asyncio.to_thread(
        _send_email_sync, to_email, invite_url, tenant_name, settings,
    )


def _send_email_sync(to_email: str, invite_url: str, tenant_name: str, settings) -> EmailSendResult:
    """Synchronous SES send — called via asyncio.to_thread."""
    ses_client = boto3.client(
        "ses",
        region_name=settings.ses_region,
    )

    subject = f"Invitation to join {tenant_name}"
    html_body = _get_invitation_email_html(invite_url, tenant_name)
    text_body = _get_invitation_email_text(invite_url, tenant_name)

    try:
        response = ses_client.send_email(
            Source=settings.ses_sender_email,
            Destination={"ToAddresses": [to_email]},
            Message={
                "Subject": {"Data": subject, "Charset": "UTF-8"},
                "Body": {
                    "Text": {"Data": text_body, "Charset": "UTF-8"},
                    "Html": {"Data": html_body, "Charset": "UTF-8"},
                },
            },
        )

        message_id = response.get("MessageId")
        logger.info(
            "Invitation email sent successfully",
            extra={
                "provider": "ses",
                "message_id": message_id,
                "to_email": to_email,
                "tenant_name": tenant_name,
            },
        )
        return EmailSendResult(
            sent=True,
            provider="ses",
            detail=f"Email sent successfully (MessageId: {message_id})",
            message_id=message_id,
        )

    except ClientError as e:
        error_code = e.response["Error"]["Code"]
        error_message = e.response["Error"]["Message"]
        logger.error(
            "SES email send failed",
            extra={
                "error_code": error_code,
                "error_message": error_message,
                "to_email": to_email,
                "tenant_name": tenant_name,
            },
        )
        return EmailSendResult(
            sent=False,
            provider="ses",
            detail=f"SES error: {error_code} - {error_message}",
        )

    except Exception as e:
        logger.error(
            "Unexpected error sending email",
            extra={
                "error": str(e),
                "to_email": to_email,
                "tenant_name": tenant_name,
            },
            exc_info=True,
        )
        return EmailSendResult(
            sent=False,
            provider="ses",
            detail=f"Unexpected error: {str(e)}",
        )
