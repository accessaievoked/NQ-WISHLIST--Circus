// Email tools (protected by WISHLIST_API_SECRET).
//   GET  /api/email?secret=...            -> is Gmail configured, and does Gmail accept the login?
//   GET  /api/email?secret=...&to=a@b.com -> sends a sample reminder ("[Test] ...") to that address
//   GET  /api/email?secret=...&preview=1  -> shows the email in the browser
const email = require('./_email');
const settingsStore = require('./_emailSettings');

const API_SECRET = process.env.WISHLIST_API_SECRET || '';
const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

module.exports = async function handler(req, res) {
  const secret = req.query.secret || req.headers['x-wishlist-secret'];
  if (!API_SECRET || secret !== API_SECRET) return res.status(401).json({ error: 'Unauthorized' });
  res.setHeader('Cache-Control', 'no-store');

  email.use(await settingsStore.load());
  const mail = email.renderEmail({
    customerName: 'Asha',
    items: email.SAMPLE_ITEMS,
    unsubscribeUrl: email.publicApiUrl() ? `${email.publicApiUrl()}/api/unsubscribe?t=preview` : '',
  });

  if (req.query.preview) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(mail.html);
  }

  if (!email.isConfigured()) {
    return res.status(200).json({ connected: false, error: 'Set GMAIL_USER and GMAIL_APP_PASSWORD in the Vercel environment variables' });
  }

  try {
    await email.verifyLogin();
  } catch (e) {
    return res.status(200).json({ connected: false, error: email.failureReason(e) });
  }

  const to = String(req.query.to || '').trim();
  if (!to) return res.status(200).json({ connected: true, from: email.env('GMAIL_USER') });
  if (!isEmail(to)) return res.status(400).json({ error: 'Enter a valid email address in ?to=' });

  try {
    await email.sendMail(to, { ...mail, subject: `[Test] ${mail.subject}` });
    return res.status(200).json({ connected: true, status: 'sent', to });
  } catch (e) {
    return res.status(200).json({ connected: true, status: 'failed', reason: email.failureReason(e) });
  }
};
