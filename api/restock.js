// Back-in-stock emails. Called by a Shopify Flow ("Product variant back in stock" -> "Send HTTP request").
//
// POST /api/restock   header  x-restock-secret: <RESTOCK_SECRET>
//   body { "variant_id": "{{ productVariant.id }}", "product_handle": "...", "product_title": "..." }
// Emails everyone who saved that variant (and has not unsubscribed or been told already), then stamps
// `restock_notified_at` on their entry so nobody gets the same restock email twice.
const crypto = require('crypto');
const email = require('./_email');
const settingsStore = require('./_emailSettings');
const { fetchAllEntries, updateEntry, money } = require('./_shopify');

const SECRET = process.env.RESTOCK_SECRET || '';
const MAX_EMAILS = 40;
const digits = (v) => String(v || '').replace(/\D/g, '');
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const httpsUrl = (u) => { u = String(u || '').trim(); return !u ? null : u.startsWith('//') ? 'https:' + u : u.replace(/^http:/i, 'https:'); };

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!SECRET || !same(req.headers['x-restock-secret'] || '', SECRET)) return res.status(401).json({ error: 'Unauthorized' });
  if (!email.isConfigured()) return res.status(200).json({ skipped: 'email is not connected' });

  const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});
  const variant = digits(body.variant_id);
  if (!variant) return res.status(400).json({ error: 'variant_id is required' });

  try {
    email.use(await settingsStore.load());
    const all = await fetchAllEntries();
    const rows = all.filter((r) => digits(r.variant_id) === variant && !r.restock_notified_at);
    const byEmail = new Map();
    for (const r of rows) {
      const addr = String(r.customer_email || '').trim().toLowerCase();
      if (addr) byEmail.set(addr, [...(byEmail.get(addr) || []), r]);
    }
    // anyone who unsubscribed on any of their entries gets nothing
    const unsub = new Set(all.filter((r) => r.unsubscribed === 'true').map((r) => String(r.customer_email || '').trim().toLowerCase()));

    const result = { matched: byEmail.size, sent: 0, failed: 0, skipped: 0 };
    const base = email.storeUrl();
    for (const [addr, list] of byEmail) {
      if (unsub.has(addr)) { result.skipped++; continue; }
      if (result.sent + result.failed >= MAX_EMAILS) break;
      const r = list[0];
      const handle = r.product_handle || body.product_handle || '';
      const productUrl = handle ? `${base}/products/${handle}` : email.wishlistUrl();
      try {
        const mail = email.renderEmail({
          customerName: (list.find((x) => x.customer_name) || {}).customer_name,
          items: [{ title: r.product_title || body.product_title || 'Saved item', url: productUrl, image: httpsUrl(r.product_image), price: money(r.product_price) }],
          unsubscribeUrl: email.unsubscribeUrl(addr),
          override: {
            subject: '{{product_name}} is back in stock',
            heading: 'Hi {{customer_name}}, it\'s back in stock',
            message: '{{product_name}}, an item you saved, is available again. Stock is limited, so grab it before it sells out.',
            listTitle: 'Back in stock',
            buttonText: 'Shop now', buttonUrl: productUrl,
            showTotal: false, showMessage: true, midTitle: '', midText: '',
          },
        });
        await email.sendMail(addr, mail);
        const stamp = new Date().toISOString();
        for (const x of list) await updateEntry(x.id, { restock_notified_at: stamp });
        result.sent++;
      } catch (e) {
        result.failed++;
        console.error('[Restock email]', email.failureReason(e));
      }
    }
    return res.status(200).json(result);
  } catch (err) {
    console.error('[Restock Error]', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
