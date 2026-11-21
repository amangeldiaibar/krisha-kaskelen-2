import nodemailer from 'nodemailer';

/**
 * Sends email through SMTP_URL, for example smtps://you%40gmail.com:app-password@smtp.gmail.com:465.
 * Without it, letters are printed to the server console, which is enough for local work.
 */
export function createMailer({ smtpUrl, from, log = console }) {
  if (!smtpUrl) {
    return {
      configured: false,
      async send({ to, subject, text }) {
        log.log(`[mail] SMTP_URL is not set, so this letter was not sent.\nTo: ${to}\nSubject: ${subject}\n\n${text}\n`);
      },
    };
  }
  const transport = nodemailer.createTransport(smtpUrl);
  return {
    configured: true,
    send: ({ to, subject, text, html }) => transport.sendMail({ from, to, subject, text, html }),
  };
}
