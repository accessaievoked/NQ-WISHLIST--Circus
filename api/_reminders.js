// Reminder logic shared by the daily cron and the "send straight away" path (delay = 0 hours).
const email = require('./_email');
const settingsStore = require('./_emailSettings');
const { gql, fetchAllEntries, updateEntry, money, compareAtByVariant } = require('./_shopify');

const HOUR = 3600000, DAY = 86400000;

// Shopify image links are often protocol-relative (//cdn.shopify.com/...), which mail apps cannot load.
function httpsUrl(u) {
  u = String(u || '').trim();
  if (!u) return null;
  if (u.startsWith('//')) return 'https:' + u;
  if (/^https?:\/\//i.test(u)) return u.replace(/^http:/i, 'https:');
  return 'https://' + u.replace(/^\/+/, '');
}

// Decides whether this person is due a reminder, from their entries. Returns { fresh } (entries to email) or { skip: reason }.
function due(rows, cfg, now = Date.now()) {
  if (rows.some((r) => r.unsubscribed === 'true')) return { skip: 'unsubscribed' };
  const lastSent = Math.max(0, ...rows.map((r) => Date.parse(r.reminded_at) || 0));
  if (lastSent && now - lastSent < cfg.minGapDays * DAY) return { skip: 'emailed recently' };
  // only items saved since the last reminder, once the delay has passed
  const fresh = rows
    .filter((r) => !r.reminded_at)
    .sort((a, b) => (Date.parse(b.added_at) || 0) - (Date.parse(a.added_at) || 0));
  if (!fresh.length) return { skip: 'nothing new to send' };
  const oldest = Math.min(...fresh.map((r) => Date.parse(r.added_at) || now));
  if (now - oldest < cfg.delayHours * HOUR) return { skip: 'not due yet' };
  return { fresh };
}

// Builds and sends one reminder, then stamps the entries so it is never sent twice.
async function send(addr, fresh) {
  const base = email.storeUrl();
  const mrp = await compareAtByVariant(fresh.map((r) => r.variant_id));
  const items = fresh.map((r) => ({
    title: r.product_title || 'Saved item',
    url: r.product_handle ? `${base}/products/${r.product_handle}` : email.wishlistUrl(),
    image: httpsUrl(r.product_image),
    price: money(r.product_price),
    mrp: mrp[String(r.variant_id || '').replace(/\D/g, '')] || '',
  }));
  const mail = email.renderEmail({
    customerName: (fresh.find((r) => r.customer_name) || {}).customer_name,
    items,
    unsubscribeUrl: email.unsubscribeUrl(addr),
  });
  await email.sendMail(addr, mail);
  const stamp = new Date().toISOString();
  for (const r of fresh) await updateEntry(r.id, { reminded_at: stamp });
}

// Called right after a shopper saves an item. Sends at once only when the store set "Send after" to 0 hours;
// otherwise the daily cron picks it up. Never throws: a failed email must not break saving to the wishlist.
async function sendNowIfInstant(addr) {
  try {
    if (!email.isConfigured()) return { sent: false, why: 'email not connected' };
    const cfg = await settingsStore.load();
    if (!cfg.enabled || cfg.delayHours !== 0) return { sent: false, why: 'not instant' };
    email.use(cfg);
    const rows = (await fetchAllEntries()).filter((r) => String(r.customer_email || '').trim().toLowerCase() === addr);
    const d = due(rows, cfg);
    if (d.skip) return { sent: false, why: d.skip };
    await send(addr, d.fresh);
    return { sent: true };
  } catch (e) {
    console.error('[Instant reminder]', e.message);
    return { sent: false, why: 'error' };
  }
}

// Real products from this store for the preview and test email (so it looks like a real reminder):
// the latest products shoppers saved, else the store's own products. Cached for a few minutes because
// the live preview re-renders as you type. Returns [] when nothing can be read (caller falls back to samples).
let previewCache = { at: 0, items: [] };
async function previewItems(count = 3) {
  if (Date.now() - previewCache.at < 5 * 60000 && previewCache.items.length) return previewCache.items;
  const base = email.storeUrl();
  let items = [];
  try {
    const seen = new Set();
    const rows = (await fetchAllEntries()).sort((a, b) => (Date.parse(b.added_at) || 0) - (Date.parse(a.added_at) || 0));
    const picked = [];
    for (const r of rows) {
      const key = r.product_handle || r.product_title;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      picked.push(r);
      if (picked.length >= count) break;
    }
    const mrp = await compareAtByVariant(picked.map((r) => r.variant_id));
    items = picked.map((r) => ({
      title: r.product_title || 'Saved item',
      url: r.product_handle ? `${base}/products/${r.product_handle}` : email.wishlistUrl(),
      image: httpsUrl(r.product_image),
      price: money(r.product_price),
      mrp: mrp[String(r.variant_id || '').replace(/\D/g, '')] || '',
    }));
  } catch (e) { console.error('[Preview items: wishlist]', e.message); }
  if (!items.length) {
    try {
      const data = await gql(`query { products(first: ${count}, sortKey: UPDATED_AT, reverse: true) { nodes { title handle featuredImage { url } priceRangeV2 { minVariantPrice { amount } } } } }`);
      items = data.products.nodes.map((p) => ({
        title: p.title,
        url: `${base}/products/${p.handle}`,
        image: httpsUrl(p.featuredImage && p.featuredImage.url),
        price: money(p.priceRangeV2.minVariantPrice.amount),
      }));
    } catch (e) { console.error('[Preview items: catalog]', e.message); }
  }
  if (items.length) previewCache = { at: Date.now(), items };
  return items;
}

module.exports = { due, send, sendNowIfInstant, previewItems };
