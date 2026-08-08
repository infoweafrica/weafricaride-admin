// Sends transactional staff emails (invitations, password resets) through
// the staff@weafrica.net mailbox's own SMTP server. Server-only — never
// import from a client component. Requires SMTP_PASSWORD to be set.

import nodemailer from "nodemailer";

const SMTP_HOST = "mail.weafrica.net";
const SMTP_PORT = 465;
const SMTP_USER = "staff@weafrica.net";
const FROM_ADDRESS = `"WeAfrica Ride Staff" <${SMTP_USER}>`;

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: true,
      auth: {
        user: SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      },
    });
  }
  return transporter;
}

export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ success: boolean; error?: string }> {
  if (!process.env.SMTP_PASSWORD) {
    return { success: false, error: "SMTP_PASSWORD is not configured" };
  }

  try {
    await getTransporter().sendMail({
      from: FROM_ADDRESS,
      to: params.to,
      subject: params.subject,
      html: params.html,
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to send email" };
  }
}
