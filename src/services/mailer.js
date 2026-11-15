import nodemailer from 'nodemailer';

const RESERVED_DOMAIN = /@(?:[\w-]+\.)*(?:example\.(?:com|org|net)|test|invalid|localhost)$/i;

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function renderEmail({ subject, text, appUrl }) {
  const paragraphs = text
    .split('\n')
    .map((line) => (line ? `<p style="margin:0 0 12px">${escapeHtml(line)}</p>` : '<br>'))
    .join('');
  const html = `<!doctype html><html lang="en"><body style="margin:0;background:#f6f3ee;font-family:Arial,sans-serif;color:#1f2a2e">
<div style="max-width:560px;margin:0 auto;padding:24px">
<div style="background:#ffffff;border-radius:16px;padding:28px;border:1px solid #e6dfd3">
<p style="margin:0 0 4px;color:#0f6b5c;font-weight:700;letter-spacing:.04em">SAATHI</p>
<h1 style="font-size:22px;line-height:1.3;margin:0 0 16px">${escapeHtml(subject)}</h1>
<div style="font-size:18px;line-height:1.55">${paragraphs}</div>
${appUrl ? `<p style="margin:20px 0 0"><a href="${escapeHtml(appUrl)}" style="display:inline-block;background:#0f6b5c;color:#ffffff;padding:14px 22px;border-radius:10px;text-decoration:none;font-size:18px;font-weight:700">Open Saathi</a></p>` : ''}
</div>
<p style="font-size:13px;color:#5b6468;margin:16px 4px 0">You get this because you are part of a Saathi care circle. Saathi never gives medical advice.</p>
</div></body></html>`;
  return { html, text: appUrl ? `${text}\n\nOpen Saathi: ${appUrl}` : text };
}

export function createMailer({ user, pass, appUrl, logger, transport } = {}) {
  const transporter = transport ?? (user && pass ? nodemailer.createTransport({ service: 'gmail', auth: { user, pass } }) : null);

  return {
    enabled: Boolean(transporter),
    async send({ to, subject, text }) {
      const recipients = [...new Set(to)].filter((address) => !RESERVED_DOMAIN.test(address));
      if (!transporter || recipients.length === 0) return { delivered: false, recipients };
      const body = renderEmail({ subject, text, appUrl });
      try {
        await transporter.sendMail({ from: `Saathi Care <${user ?? 'saathi@localhost'}>`, to: recipients, subject, ...body });
        return { delivered: true, recipients };
      } catch (error) {
        logger?.error('email delivery failed', { error: error.message });
        return { delivered: false, recipients, error: 'delivery failed' };
      }
    },
  };
}
