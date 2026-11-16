// Sends the wishlist reminder emails. Runs on a schedule (see vercel.json "crons").
//
// A customer is emailed when: they left an email address, haven't unsubscribed, their oldest unreminded item is older than
// the "Send after" hours, and they haven't been emailed in the last "Gap" days (both set in the admin's Email tab).
// Each entry gets a `reminded_at` stamp so nobody is emailed twice for the same items.
//
// Auth: Vercel Cron sends "Authorization: Bearer <CRON_SECRET>". You can also call it by hand:
//   /api/cron-reminders?secret=<WISHLIST_API_SECRET>[&dry=1]
const email = require('./_email');
const settingsStore = require('./_emailSettings');
const { fetchAllEntries } = require('./_shopify');
const { due, send } = require('./_reminders');

const API_SECRET = process.env.WISHLIST_API_SECRET || '';
const CRON_SECRET = process.env.CRON_SECRET || '';
const MAX_EMAILS_PER_RUN = 40; // stays well inside the function time limit; the next run picks up the rest

module.exports = async function handler(req, res) {
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const ok = (CRON_SECRET && bearer === CRON_SECRET) || (API_SECRET && req.query.secret === API_SECRET);
  if (!ok) return res.status(401).json({ error: 'Unauthorized' });
  if (!email.isConfigured()) return res.status(200).json({ skipped: 'Gmail is not connected (set GMAIL_USER and GMAIL_APP_PASSWORD)' });

  const cfg = await settingsStore.load();
  email.use(cfg);
  if (!cfg.enabled && !req.query.force) return res.status(200).json({ skipped: 'Email reminders are turned off (admin → Email tab)' });
  const dry = !!req.query.dry;

  try {
    const entries = await fetchAllEntries();

    // group by email address
    const byEmail = new Map();
    for (const e of entries) {
      const addr = String(e.customer_email || '').trim().toLowerCase();
      if (!addr) continue;
      if (!byEmail.has(addr)) byEmail.set(addr, []);
      byEmail.get(addr).push(e);
    }

    const result = { checked: byEmail.size, sent: 0, failed: 0, skipped: 0, errors: [] };

    for (const [addr, rows] of byEmail) {
      if (result.sent + result.failed >= MAX_EMAILS_PER_RUN) break;
      const d = due(rows, cfg);
      if (d.skip) { result.skipped++; continue; }
      if (dry) { result.sent++; continue; }
      try {
        await send(addr, d.fresh);
        result.sent++;
      } catch (e) {
        result.failed++;
        result.errors.push({ to: addr.replace(/^(.).*(@.*)$/, '$1***$2'), reason: email.failureReason(e) });
      }
    }

    return res.status(200).json({ dry, ...result });
  } catch (err) {
    console.error('[Reminders Error]', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
