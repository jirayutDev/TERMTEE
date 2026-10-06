import "server-only";
import nodemailer, { type Transporter } from "nodemailer";

/**
 * SMTP transport configured by env:
 *   SMTP_URL    e.g. smtps://user:pass@smtp.example.com:465 (or smtp://...:587 for STARTTLS)
 *   EMAIL_FROM  e.g. "TERMTEE <no-reply@example.com>"
 * Without SMTP_URL, email is disabled (dev): callers log + record EmailLog SKIPPED.
 */

const CONNECTION_TIMEOUT_MS = 10_000;
const GREETING_TIMEOUT_MS = 10_000;
const SOCKET_TIMEOUT_MS = 20_000;

let cached: { url: string; transporter: Transporter } | null = null;

export function emailEnabled(): boolean {
  return !!process.env.SMTP_URL?.trim();
}

function getTransporter(): Transporter | null {
  const url = process.env.SMTP_URL?.trim();
  if (!url) return null;
  if (cached?.url === url) return cached.transporter;
  const parsed = new URL(url);
  const secure = parsed.protocol === "smtps:";
  const transporter = nodemailer.createTransport({
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : secure ? 465 : 587,
    secure,
    auth: parsed.username
      ? { user: decodeURIComponent(parsed.username), pass: decodeURIComponent(parsed.password) }
      : undefined,
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    greetingTimeout: GREETING_TIMEOUT_MS,
    socketTimeout: SOCKET_TIMEOUT_MS,
  });
  cached = { url, transporter };
  return transporter;
}

export interface OutgoingMail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** Sends one message. Returns false when SMTP is not configured. Throws on SMTP errors. */
export async function sendMail(mail: OutgoingMail): Promise<boolean> {
  const transporter = getTransporter();
  if (!transporter) return false;
  const from = process.env.EMAIL_FROM?.trim() || "TERMTEE <no-reply@localhost>";
  await transporter.sendMail({ from, to: mail.to, subject: mail.subject, html: mail.html, text: mail.text });
  return true;
}
