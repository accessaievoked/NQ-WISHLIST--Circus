// Sends the wishlist reminder emails. Runs on a schedule (see vercel.json "crons").
//
// A customer is emailed when: they left an email address, haven't unsubscribed, their oldest saved item is older than
// REMINDER_DELAY_HOURS (default 24), and they haven't been emailed in the last REMINDER_MIN_GAP_DAYS (default 3).
// Each entry gets a `reminded_at` stamp so nobody is emailed twice for the same items.
//
// Auth: Vercel Cron sends "Authorization: Bearer <CRON_SECRET>". You can also call it by hand:
//   /api/cron-reminders?secret=<WISHLIST_API_SECRET>[&dry=1]
const email = require('./_email');
const settingsStore = require('./_emailSettings');
const { fetchAllEntries, updateEntry, money } = require('./_shopify');

const HOUR = 3600000, DAY = 86400000;
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
  const delay = cfg.delayHours * HOUR;
  const gap = cfg.minGapDays * DAY;
  const dry = !!req.query.dry;
  const now = Date.now();

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

      if (rows.some((r) => r.unsubscribed === 'true')) { result.skipped++; continue; }
      const lastSent = Math.max(0, ...rows.map((r) => Date.parse(r.reminded_at) || 0));
      if (lastSent && now - lastSent < gap) { result.skipped++; continue; }

      // only items saved since the last reminder, and only once the delay has passed
      const fresh = rows
        .filter((r) => !r.reminded_at)
        .sort((a, b) => (Date.parse(b.added_at) || 0) - (Date.parse(a.added_at) || 0));
      if (!fresh.length) { result.skipped++; continue; }
      const oldest = Math.min(...fresh.map((r) => Date.parse(r.added_at) || now));
      if (now - oldest < delay) { result.skipped++; continue; }

      const base = email.storeUrl();
      const items = fresh.map((r) => ({
        title: r.product_title || 'Saved item',
        url: r.product_handle ? `${base}/products/${r.product_handle}` : email.wishlistUrl(),
        image: r.product_image || null,
        price: money(r.product_price),
      }));
      const mail = email.renderEmail({
        customerName: (fresh.find((r) => r.customer_name) || {}).customer_name,
        items,
        unsubscribeUrl: email.unsubscribeUrl(addr),
      });

      if (dry) { result.sent++; continue; }
      try {
        await email.sendMail(addr, mail);
        const stamp = new Date().toISOString();
        for (const r of fresh) await updateEntry(r.id, { reminded_at: stamp });
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
