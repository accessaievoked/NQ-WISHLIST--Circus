// Public unsubscribe page, linked from every reminder email (and used by the mail app's one-click "Unsubscribe" button).
// Marks every wishlist entry for that email as unsubscribed, so no reminder is ever sent to it again.
const { readToken } = require('./_email');
const { fetchAllEntries, updateEntry } = require('./_shopify');

const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif"><div style="max-width:440px;margin:15vh auto;background:#fff;border-radius:12px;padding:32px;text-align:center">
<h1 style="font-size:20px;margin:0 0 12px;color:#111">${title}</h1><p style="margin:0;color:#555;line-height:1.5">${body}</p></div></body></html>`;

module.exports = async function handler(req, res) {
  const token = req.query.t;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  // test emails link here with t=preview: show the page, unsubscribe nobody
  if (token === 'preview') return res.status(200).send(page('Preview', 'This is a test email, so nobody was unsubscribed.'));

  const addr = readToken(token);
  if (!addr) return res.status(400).send(page('Link not valid', 'This unsubscribe link is not valid or has been changed.'));

  // Mail apps' one-click button POSTs; a person opening the link in a browser sends GET. Both unsubscribe.
  try {
    const rows = (await fetchAllEntries()).filter((r) => String(r.customer_email || '').trim().toLowerCase() === addr && r.unsubscribed !== 'true');
    for (const r of rows) await updateEntry(r.id, { unsubscribed: 'true' });
    return res.status(200).send(page("You're unsubscribed", 'You will not get wishlist reminder emails from us any more.'));
  } catch (err) {
    console.error('[Unsubscribe Error]', err.message);
    return res.status(500).send(page('Something went wrong', 'We could not unsubscribe you just now. Please try the link again in a few minutes.'));
  }
};
