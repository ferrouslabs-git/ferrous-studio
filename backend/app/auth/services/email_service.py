"""
Email service for invitation delivery via AWS SES.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
from email.mime.image import MIMEImage
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr
import html
import logging
from pathlib import Path

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


# Brand: brand-guidelines.html (repo root). Dark-first near-black surfaces,
# molten orange for the single call to action, mono uppercase eyebrow labels,
# plain outcome-first copy with no exclamation marks. Everything is inline
# styled and table-based because email clients ignore stylesheets, and the
# mark is an inline PNG attachment (see _SYMBOL_PNG).

_BG_DEEP = "#050508"
_BG_RAISED = "#0B0B11"
_BG_ELEMENT = "#131319"
_BORDER = "#262630"
_TEXT = "#FFFFFF"
_TEXT_SECONDARY = "#C0C0CC"
_TEXT_MUTED = "#6E6E7C"
_ORANGE = "#FF5B1A"
_FONT_DISPLAY = "'Space Grotesk', 'Helvetica Neue', Arial, sans-serif"
_FONT_MONO = "'IBM Plex Mono', Menlo, Consolas, monospace"


# The white Fe symbol from brand-guidelines.html, rasterised at 2x (136x149)
# because email clients do not render SVG. Embedded as an inline attachment
# referenced by Content-ID: remote images are blocked by default and Gmail
# strips data: URIs, so CID is the only form that shows everywhere.
_SYMBOL_PNG = Path(__file__).parent / "assets" / "fe-symbol-white@2x.png"
_SYMBOL_CID = "fe-symbol"


def _invitation_copy(tenant_name: str | None, product_name: str) -> tuple[str, str, str]:
    """(title, heading, blurb) for the two kinds of invitation. Plain text;
    the HTML builder escapes and marks up what it needs to. ``tenant_name``
    None means a platform invitation: no organisation, super admin access."""
    if tenant_name:
        return (
            f"Invitation to {tenant_name}",
            f"Join {tenant_name} on {product_name}.",
            f"ou have been invited to join {tenant_name}. Follow the link to set your "
            "password and see the projects shared with you.",
        )
    return (
        f"Invitation to administer {product_name}",
        f"Administer {product_name} as a super admin.",
        f"ou have been invited to administer {product_name} as a super admin. Follow "
        "the link to set your password.",
    )


def _get_invitation_email_html(
    invite_url: str, tenant_name: str | None, product_name: str, legal: str, recipient_name: str | None = None
) -> str:
    """Branded HTML body for an invitation."""
    greeting = f"Hi {html.escape(recipient_name)}, y" if recipient_name else "Y"
    title, heading, blurb = _invitation_copy(tenant_name, product_name)
    title = html.escape(title)
    preheader = html.escape(heading)
    blurb = html.escape(blurb)
    if tenant_name:
        safe_tenant = html.escape(tenant_name)
        heading_html = f"Join {safe_tenant}<br>on {html.escape(product_name)}."
        blurb = blurb.replace(safe_tenant, f'<strong style="color:{_TEXT}; font-weight:600;">{safe_tenant}</strong>', 1)
    else:
        heading_html = f"Administer {html.escape(product_name)}<br>as a super admin."
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
  <title>{title}</title>
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600&family=IBM+Plex+Mono:wght@500&display=swap" rel="stylesheet">
</head>
<body style="margin:0; padding:0; background:{_BG_DEEP}; color:{_TEXT}; font-family:{_FONT_DISPLAY}; -webkit-font-smoothing:antialiased;">
  <div style="display:none; max-height:0; overflow:hidden; opacity:0;">{preheader}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{_BG_DEEP};">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px; width:100%;">

          <!-- Mark + product -->
          <tr>
            <td style="padding:0 0 24px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="width:34px; vertical-align:middle;"><img src="cid:{_SYMBOL_CID}" width="34" height="37" alt="Fe" style="display:block; width:34px; height:37px; border:0;"></td>
                  <td style="padding-left:12px; vertical-align:middle; font-family:{_FONT_DISPLAY}; font-weight:600; font-size:16px; color:{_TEXT}; letter-spacing:-0.01em;">{product_name}</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:{_BG_RAISED}; border:1px solid {_BORDER}; border-radius:6px; padding:36px 36px 32px;">
              <p style="margin:0 0 14px; font-family:{_FONT_MONO}; font-size:11px; letter-spacing:0.16em; text-transform:uppercase; color:{_ORANGE};">Invitation</p>
              <h1 style="margin:0 0 18px; font-family:{_FONT_DISPLAY}; font-weight:600; font-size:28px; line-height:1.1; letter-spacing:-0.03em; color:{_TEXT};">{heading_html}</h1>
              <p style="margin:0 0 28px; font-size:15px; line-height:1.6; color:{_TEXT_SECONDARY};">{greeting}{blurb}</p>

              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:{_ORANGE}; border-radius:4px;">
                    <a href="{invite_url}" style="display:inline-block; padding:14px 22px; font-family:{_FONT_MONO}; font-size:12px; font-weight:500; letter-spacing:0.12em; text-transform:uppercase; color:#FFFFFF; text-decoration:none;">Accept invitation &rarr;</a>
                  </td>
                </tr>
              </table>

              <p style="margin:28px 0 8px; font-family:{_FONT_MONO}; font-size:10px; letter-spacing:0.12em; text-transform:uppercase; color:{_TEXT_MUTED};">Or paste this link into your browser</p>
              <p style="margin:0; padding:12px 14px; background:{_BG_ELEMENT}; border:1px solid {_BORDER}; border-radius:4px; font-family:{_FONT_MONO}; font-size:12px; line-height:1.5; color:{_TEXT_SECONDARY}; word-break:break-all;"><a href="{invite_url}" style="color:{_TEXT_SECONDARY}; text-decoration:none;">{invite_url}</a></p>
            </td>
          </tr>

          <!-- Molten divider -->
          <tr>
            <td style="padding:28px 0 20px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
                <td style="height:1px; background:{_ORANGE}; background-image:linear-gradient(90deg, #2540E8 0%, #7C5CFF 50%, {_ORANGE} 100%); font-size:0; line-height:0;">&nbsp;</td>
              </tr></table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="font-size:12px; line-height:1.6; color:{_TEXT_MUTED};">
              <p style="margin:0 0 6px;">If you were not expecting this invitation, you can ignore this email. The link only works for the address it was sent to.</p>
              <p style="margin:0; font-family:{_FONT_MONO}; font-size:10px; letter-spacing:0.06em;">{legal}</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""


def _get_invitation_email_text(
    invite_url: str, tenant_name: str | None, product_name: str, legal: str, recipient_name: str | None = None
) -> str:
    """Plain-text body for an invitation."""
    greeting = f"Hi {recipient_name}, y" if recipient_name else "Y"
    _title, heading, blurb = _invitation_copy(tenant_name, product_name)
    return f"""{product_name.upper()} — INVITATION

{heading}

{greeting}{blurb}

{invite_url}

If you were not expecting this invitation, you can ignore this email. The link
only works for the address it was sent to.

{legal}
"""


async def send_invitation_email(
    to_email: str, invite_url: str, tenant_name: str | None, recipient_name: str | None = None
) -> EmailSendResult:
    """Send invitation email via AWS SES. ``tenant_name`` is None for a
    platform (super admin) invitation, which has no organisation to name.

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
        _send_email_sync, to_email, invite_url, tenant_name, settings, recipient_name,
    )


def _build_message(sender: str, to_email: str, subject: str, text_body: str, html_body: str) -> MIMEMultipart:
    """multipart/related( multipart/alternative(text, html), inline symbol PNG )."""
    related = MIMEMultipart("related")
    related["Subject"] = subject
    related["From"] = sender
    related["To"] = to_email

    alternative = MIMEMultipart("alternative")
    alternative.attach(MIMEText(text_body, "plain", "utf-8"))
    alternative.attach(MIMEText(html_body, "html", "utf-8"))
    related.attach(alternative)

    if _SYMBOL_PNG.exists():
        image = MIMEImage(_SYMBOL_PNG.read_bytes(), "png")
        image.add_header("Content-ID", f"<{_SYMBOL_CID}>")
        image.add_header("Content-Disposition", "inline", filename="ferrous-symbol.png")
        related.attach(image)
    else:  # pragma: no cover - asset ships with the module
        logger.warning("Brand symbol missing; sending invitation without the mark", extra={"path": str(_SYMBOL_PNG)})

    return related


def invitation_email_subject(tenant_name: str | None, product_name: str) -> str:
    if tenant_name:
        return f"You are invited to join {tenant_name} on {product_name}"
    return f"You are invited to administer {product_name}"


def _send_email_sync(
    to_email: str, invite_url: str, tenant_name: str | None, settings, recipient_name: str | None = None
) -> EmailSendResult:
    """Synchronous SES send — called via asyncio.to_thread."""
    ses_client = boto3.client(
        "ses",
        region_name=settings.ses_region,
    )

    product_name = settings.product_display_name
    subject = invitation_email_subject(tenant_name, product_name)
    html_body = _get_invitation_email_html(invite_url, tenant_name, product_name, settings.email_legal, recipient_name)
    text_body = _get_invitation_email_text(invite_url, tenant_name, product_name, settings.email_legal, recipient_name)

    msg = _build_message(
        sender=formataddr((product_name, settings.ses_sender_email)),
        to_email=to_email,
        subject=subject,
        text_body=text_body,
        html_body=html_body,
    )

    try:
        response = ses_client.send_raw_email(
            Source=settings.ses_sender_email,
            Destinations=[to_email],
            RawMessage={"Data": msg.as_bytes()},
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
