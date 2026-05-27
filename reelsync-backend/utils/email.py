import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from config import settings

logger = logging.getLogger(__name__)


def send_otp_email(to_email: str, otp_code: str) -> None:
    """
    Sends the 6-digit OTP to `to_email` via Gmail SMTP (port 587, STARTTLS).
    If SMTP credentials are not configured, logs the OTP for development use.
    Called from a FastAPI BackgroundTask — exceptions are caught and logged
    so a delivery failure never surfaces as a 500 to the client.
    """
    if not settings.smtp_user or not settings.smtp_password:
        logger.warning(
            "[email] SMTP not configured — development mode. "
            f"OTP for {to_email}: {otp_code}"
        )
        return

    subject = "Your ReelSync AI verification code"

    plain = (
        f"Your ReelSync AI verification code is: {otp_code}\n\n"
        "This code expires in 5 minutes.\n\n"
        "If you did not request this, you can safely ignore this email."
    )

    html = f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="480" cellpadding="0" cellspacing="0"
               style="background:#ffffff;border-radius:16px;overflow:hidden;
                      box-shadow:0 4px 24px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#4f46e5,#7c3aed);
                       padding:32px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;
                         letter-spacing:-0.5px;">ReelSync AI</h1>
              <p style="margin:6px 0 0;color:#c7d2fe;font-size:13px;">
                Email Verification
              </p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px;">
              <p style="margin:0 0 8px;color:#374151;font-size:16px;font-weight:600;">
                Your verification code
              </p>
              <p style="margin:0 0 28px;color:#6b7280;font-size:14px;">
                Enter this code on the ReelSync AI signup page to complete your registration.
              </p>

              <!-- OTP box -->
              <div style="background:#eef2ff;border:2px solid #4f46e5;border-radius:12px;
                          padding:20px;text-align:center;margin:0 0 28px;">
                <span style="font-size:42px;font-weight:700;letter-spacing:12px;
                             color:#4f46e5;font-family:'Courier New',Courier,monospace;">
                  {otp_code}
                </span>
              </div>

              <p style="margin:0 0 8px;color:#6b7280;font-size:13px;">
                &#x23F0; This code expires in <strong>5 minutes</strong>.
              </p>
              <p style="margin:0;color:#9ca3af;font-size:12px;">
                If you didn&rsquo;t create a ReelSync AI account, you can safely ignore this email.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background:#f9fafb;border-top:1px solid #e5e7eb;
                       padding:20px 40px;text-align:center;">
              <p style="margin:0;color:#9ca3af;font-size:11px;">
                &copy; 2025 ReelSync AI &mdash; AI-powered multilingual video dubbing
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"ReelSync AI <{settings.smtp_user}>"
    msg["To"] = to_email
    msg.attach(MIMEText(plain, "plain", "utf-8"))
    msg.attach(MIMEText(html, "html", "utf-8"))

    try:
        with smtplib.SMTP("smtp.gmail.com", 587, timeout=15) as server:
            server.ehlo()
            server.starttls()
            server.ehlo()
            server.login(settings.smtp_user, settings.smtp_password)
            server.sendmail(settings.smtp_user, to_email, msg.as_string())
        logger.info(f"[email] OTP delivered to {to_email}")
    except smtplib.SMTPAuthenticationError:
        logger.error(
            "[email] SMTP authentication failed — check SMTP_USER and SMTP_PASSWORD "
            "(Gmail requires an App Password, not your account password)."
        )
    except smtplib.SMTPRecipientsRefused:
        logger.error(f"[email] Recipient refused: {to_email}")
    except Exception as exc:
        logger.error(f"[email] Unexpected error sending to {to_email}: {exc}")


def _smtp_send(to_email: str, msg: MIMEMultipart) -> None:
    """Shared SMTP transport used by all outbound email functions."""
    try:
        with smtplib.SMTP("smtp.gmail.com", 587, timeout=15) as server:
            server.ehlo()
            server.starttls()
            server.ehlo()
            server.login(settings.smtp_user, settings.smtp_password)
            server.sendmail(settings.smtp_user, to_email, msg.as_string())
        logger.info(f"[email] message delivered to {to_email}")
    except smtplib.SMTPAuthenticationError:
        logger.error(
            "[email] SMTP authentication failed — check SMTP_USER and SMTP_PASSWORD "
            "(Gmail requires an App Password, not your account password)."
        )
    except smtplib.SMTPRecipientsRefused:
        logger.error(f"[email] Recipient refused: {to_email}")
    except Exception as exc:
        logger.error(f"[email] Unexpected error sending to {to_email}: {exc}")


def send_password_reset_email(to_email: str, otp_code: str) -> None:
    """
    Sends a 6-digit password-reset OTP to `to_email`.
    Falls back to console logging when SMTP is not configured (development mode).
    """
    if not settings.smtp_user or not settings.smtp_password:
        logger.warning(
            "[email] SMTP not configured — development mode. "
            f"Password reset OTP for {to_email}: {otp_code}"
        )
        return

    subject = "ReelSync - Password Reset Verification Code"

    plain = (
        f"Your ReelSync AI password reset code is: {otp_code}\n\n"
        "This code expires in 5 minutes.\n\n"
        "If you did not request a password reset, you can safely ignore this email. "
        "Your account password has not been changed."
    )

    html = f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="480" cellpadding="0" cellspacing="0"
               style="background:#ffffff;border-radius:16px;overflow:hidden;
                      box-shadow:0 4px 24px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#4f46e5,#7c3aed);
                       padding:32px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;
                         letter-spacing:-0.5px;">ReelSync AI</h1>
              <p style="margin:6px 0 0;color:#c7d2fe;font-size:13px;">
                Password Reset
              </p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px;">
              <p style="margin:0 0 8px;color:#374151;font-size:16px;font-weight:600;">
                Reset your password
              </p>
              <p style="margin:0 0 28px;color:#6b7280;font-size:14px;">
                Enter this code on the ReelSync AI password reset page.
                It is valid for <strong>5 minutes</strong>.
              </p>

              <!-- OTP box -->
              <div style="background:#eef2ff;border:2px solid #4f46e5;border-radius:12px;
                          padding:20px;text-align:center;margin:0 0 28px;">
                <span style="font-size:42px;font-weight:700;letter-spacing:12px;
                             color:#4f46e5;font-family:'Courier New',Courier,monospace;">
                  {otp_code}
                </span>
              </div>

              <p style="margin:0 0 8px;color:#6b7280;font-size:13px;">
                &#x23F0; This code expires in <strong>5 minutes</strong>.
              </p>
              <p style="margin:0;color:#9ca3af;font-size:12px;">
                If you didn&rsquo;t request a password reset, your account is safe —
                you can safely ignore this email.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background:#f9fafb;border-top:1px solid #e5e7eb;
                       padding:20px 40px;text-align:center;">
              <p style="margin:0;color:#9ca3af;font-size:11px;">
                &copy; 2025 ReelSync AI &mdash; AI-powered multilingual video dubbing
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"ReelSync AI <{settings.smtp_user}>"
    msg["To"] = to_email
    msg.attach(MIMEText(plain, "plain", "utf-8"))
    msg.attach(MIMEText(html, "html", "utf-8"))
    _smtp_send(to_email, msg)
