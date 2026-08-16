import { env } from "../config/env.js";

/** Emails are optional: without an API key we skip sending (never block issuance). */
export function isEmailConfigured(): boolean {
  return Boolean(env.RESEND_API_KEY);
}

/**
 * Resend sandbox detection — while the sender is `onboarding@resend.dev` (or any
 * @resend.dev address) the account has no verified domain, so Resend only
 * delivers to the test inbox or manually authorized recipients. Once a real
 * domain is verified and EMAIL_FROM points at it, this flips to false
 * automatically and recipients receive the email for real.
 */
export function isResendSandbox(): boolean {
  // Extract the address from "Display Name <address>", anchored at the end so a
  // display name containing brackets (e.g. "Support <Team> <a@b.com>") parses right.
  const match = env.EMAIL_FROM.match(/<([^>]+)>\s*$/);
  const sender = (match ? match[1] : env.EMAIL_FROM).trim().toLowerCase();
  return sender.endsWith("@resend.dev");
}

export interface CertificateEmail {
  recipientName: string;
  recipientEmail: string;
  certificateTitle: string;
  course: string;
  certificateId: string;
  verificationUrl: string;
  pdfUrl: string;
}

/** HTML-escape user-influenced values before embedding them in the email body. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildEmail(data: CertificateEmail): { subject: string; text: string; html: string } {
  const subject = `Your certificate "${data.certificateTitle}" has been issued`;
  const esc = {
    recipientName: escapeHtml(data.recipientName),
    certificateTitle: escapeHtml(data.certificateTitle),
    course: escapeHtml(data.course),
    certificateId: escapeHtml(data.certificateId),
    verificationUrl: escapeHtml(data.verificationUrl),
    pdfUrl: escapeHtml(data.pdfUrl),
  };

  const text = [
    `Dear ${data.recipientName},`,
    ``,
    `Congratulations! Your certificate "${data.certificateTitle}" (${data.course}) has been issued.`,
    ``,
    `Certificate ID: ${data.certificateId}`,
    ``,
    `Verify your certificate: ${data.verificationUrl}`,
    `Download certificate (PDF): ${data.pdfUrl}`,
    ``,
    `KITCHAIN — blockchain-backed certificate verification`,
  ].join("\n");

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f6f5f1;font-family:Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f5f1;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e6e2d8;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="background:#1b2338;padding:24px 32px;">
                <span style="color:#be9444;font-size:15px;font-weight:bold;letter-spacing:0.5px;">&#9889; KITCHAIN</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 8px;font-size:20px;color:#1b2338;">Your certificate has been issued</h1>
                <p style="margin:0 0 24px;font-size:14px;color:#5b6472;line-height:1.6;">
                  Dear ${esc.recipientName}, congratulations! Your certificate
                  <strong>&quot;${esc.certificateTitle}&quot;</strong> (${esc.course}) has been
                  issued and registered with a tamper-resistant blockchain record.
                </p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f5f1;border-radius:10px;padding:16px;">
                  <tr>
                    <td style="padding:4px 0;font-size:12px;color:#8a8f9c;">Certificate ID</td>
                  </tr>
                  <tr>
                    <td style="padding:0 0 12px;font-size:15px;color:#1b2338;font-weight:bold;font-family:monospace;">${esc.certificateId}</td>
                  </tr>
                </table>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;">
                  <tr>
                    <td width="50%" style="padding-right:8px;">
                      <a href="${esc.verificationUrl}" style="display:block;text-align:center;background:#1b2338;color:#ffffff;text-decoration:none;font-size:14px;font-weight:bold;padding:14px 12px;border-radius:10px;">Verify certificate</a>
                    </td>
                    <td width="50%" style="padding-left:8px;">
                      <a href="${esc.pdfUrl}" style="display:block;text-align:center;background:#ffffff;color:#1b2338;text-decoration:none;font-size:14px;font-weight:bold;padding:13px 12px;border:1px solid #1b2338;border-radius:10px;">Download PDF</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:24px 0 0;font-size:12px;color:#8a8f9c;line-height:1.6;">
                  Anyone can verify this certificate at any time by entering the Certificate ID or
                  scanning the QR code on the PDF.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
}

/** Password-reset verification code email (branded to match the certificate email). */
function buildOtpEmail(
  email: string,
  otp: string,
): { subject: string; text: string; html: string } {
  const subject = "Your KITCHAIN verification code";
  const text = [
    `Hello,`,
    ``,
    `We received a request to reset the password for the KITCHAIN account at ${email}.`,
    `Your verification code is: ${otp}`,
    ``,
    `This code expires in 10 minutes. If you didn't request this, you can safely ignore this email.`,
    ``,
    `KITCHAIN — blockchain-backed certificate verification`,
  ].join("\n");

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f6f5f1;font-family:Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f5f1;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e6e2d8;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="background:#1b2338;padding:24px 32px;">
                <span style="color:#be9444;font-size:15px;font-weight:bold;letter-spacing:0.5px;">&#9889; KITCHAIN</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 8px;font-size:20px;color:#1b2338;">Verify it's you</h1>
                <p style="margin:0 0 24px;font-size:14px;color:#5b6472;line-height:1.6;">
                  We received a request to reset the password for the KITCHAIN account at
                  <strong style="color:#1b2338;">${escapeHtml(email)}</strong>. Use the code below to
                  continue. It expires in 10 minutes.
                </p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f5f1;border:1px dashed #d8d2c2;border-radius:12px;padding:20px;">
                  <tr>
                    <td align="center" style="font-size:32px;letter-spacing:12px;color:#1b2338;font-weight:bold;font-family:monospace;">${escapeHtml(otp)}</td>
                  </tr>
                </table>
                <p style="margin:24px 0 0;font-size:12px;color:#8a8f9c;line-height:1.6;">
                  If you didn't request this code, you can safely ignore this email — your password
                  will not change.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
}

/** Welcome email sent when a new organization account signs up. */
function buildWelcomeEmail(input: {
  name: string;
  organizationName: string;
  dashboardUrl: string;
}): { subject: string; text: string; html: string } {
  const subject = `Welcome to KITCHAIN, ${input.name}!`;
  const esc = {
    name: escapeHtml(input.name),
    organizationName: escapeHtml(input.organizationName),
    dashboardUrl: escapeHtml(input.dashboardUrl),
  };

  const text = [
    `Welcome to KITCHAIN, ${input.name}!`,
    ``,
    `Your organization "${input.organizationName}" now has a KITCHAIN portal where you can:`,
    `  - Issue tamper-resistant digital certificates`,
    `  - Generate branded PDFs with QR codes`,
    `  - Register every certificate on the blockchain`,
    `  - Verify and revoke certificates in one click`,
    ``,
    `Open your dashboard: ${input.dashboardUrl}`,
    ``,
    `KITCHAIN — blockchain-backed certificate verification`,
  ].join("\n");

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f6f5f1;font-family:Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f5f1;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e6e2d8;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="background:#1b2338;padding:24px 32px;">
                <span style="color:#be9444;font-size:15px;font-weight:bold;letter-spacing:0.5px;">&#9889; KITCHAIN</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 8px;font-size:20px;color:#1b2338;">Welcome to KITCHAIN, ${esc.name}!</h1>
                <p style="margin:0 0 24px;font-size:14px;color:#5b6472;line-height:1.6;">
                  Your organization <strong style="color:#1b2338;">${esc.organizationName}</strong> now
                  has a KITCHAIN portal. Here's what you can do right away:
                </p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                  <tr>
                    <td style="padding:6px 0;font-size:14px;color:#1b2338;">&#10003;&nbsp; Issue tamper-resistant digital certificates</td>
                  </tr>
                  <tr>
                    <td style="padding:6px 0;font-size:14px;color:#1b2338;">&#10003;&nbsp; Generate branded PDFs with QR codes</td>
                  </tr>
                  <tr>
                    <td style="padding:6px 0;font-size:14px;color:#1b2338;">&#10003;&nbsp; Register every certificate on the blockchain</td>
                  </tr>
                  <tr>
                    <td style="padding:6px 0;font-size:14px;color:#1b2338;">&#10003;&nbsp; Verify and revoke certificates in one click</td>
                  </tr>
                </table>
                <a href="${esc.dashboardUrl}" style="display:block;text-align:center;background:#1b2338;color:#ffffff;text-decoration:none;font-size:14px;font-weight:bold;padding:14px 12px;border-radius:10px;">Open your dashboard</a>
                <p style="margin:24px 0 0;font-size:12px;color:#8a8f9c;line-height:1.6;">
                  If you didn't create this account, you can safely ignore this email.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
}

/**
 * Shared send path: skips when email isn't configured, routes through the
 * Resend test inbox while the sender domain is unverified, and throws on
 * API failure. Callers decide whether a failure should block the request.
 */
async function sendEmail(input: {
  to: string;
  subject: string;
  text: string;
  html: string;
  label: string;
}): Promise<void> {
  if (!isEmailConfigured()) {
    console.warn(`[email] RESEND_API_KEY not set — skipping ${input.label}.`);
    return;
  }

  // Sandbox fallback: route to the test inbox instead of 422-ing on recipients
  // Resend won't deliver to. Real recipients get their mail once a domain is
  // verified (see isResendSandbox).
  const to = isResendSandbox() ? env.EMAIL_TEST_INBOX : input.to;
  if (to !== input.to) {
    console.warn(
      `[email] Resend sandbox: routing ${input.label} to test inbox "${to}". ` +
        "Set EMAIL_TEST_INBOX to your authorized address, or verify a domain in " +
        "Resend and update EMAIL_FROM to deliver to real recipients.",
    );
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [to],
      subject: input.subject,
      text: input.text,
      html: input.html,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Email send failed (${response.status}): ${detail.slice(0, 300)}`);
  }
}

/** Send a password-reset verification code via Resend. Throws on failure. */
export async function sendOtpEmail(email: string, otp: string): Promise<void> {
  const { subject, text, html } = buildOtpEmail(email, otp);
  await sendEmail({ to: email, subject, text, html, label: `OTP email for "${email}"` });
}

/** FR-09 — send the issuance notification via Resend's REST API. Throws on failure. */
export async function sendCertificateEmail(data: CertificateEmail): Promise<void> {
  const { subject, text, html } = buildEmail(data);
  await sendEmail({
    to: data.recipientEmail,
    subject,
    text,
    html,
    label: `certificate email for "${data.recipientEmail}"`,
  });
}

/** Welcome email for new organization accounts. Throws on failure (caller decides). */
export async function sendWelcomeEmail(input: {
  email: string;
  name: string;
  organizationName: string;
}): Promise<void> {
  const dashboardUrl = `${env.CLIENT_ORIGIN.replace(/\/$/, "")}/dashboard`;
  const { subject, text, html } = buildWelcomeEmail({
    name: input.name,
    organizationName: input.organizationName,
    dashboardUrl,
  });
  await sendEmail({
    to: input.email,
    subject,
    text,
    html,
    label: `welcome email for "${input.email}"`,
  });
}
