// Shared email helpers (SMTP, Zoho Mail by default + HTML template + unsubscribe links).
// Ported from the nq-wishlist app. The leading underscore keeps Vercel from exposing this file as a route.
//
// Env vars:
//   SMTP_USER           Zoho Mail address that sends the emails (e.g. care@yourstore.com)
//   SMTP_PASSWORD       that mailbox's password, or a Zoho Application-Specific Password if 2FA is on
//   SMTP_HOST           (optional) default smtp.zoho.com. Use smtp.zoho.eu / smtp.zoho.in / smtp.zoho.com.au / smtp.zoho.jp
//                       if your Zoho account lives in another data centre
//   SMTP_PORT           (optional) default 465 (SSL). 587 uses STARTTLS
//   (GMAIL_USER / GMAIL_APP_PASSWORD are still read as fallbacks for older setups)
//   EMAIL_FROM_NAME     (optional) sender name, defaults to the store name
//   EMAIL_REPLY_TO      (optional) reply-to address
//   STORE_NAME          (optional) shown in the email, defaults to the myshopify subdomain
//   STORE_URL           (optional) public storefront URL, defaults to https://SHOPIFY_STORE_URL
//   WISHLIST_PAGE_PATH  (optional) wishlist page path, defaults to /pages/wishlist
//   PUBLIC_API_URL      public https address of this deployment (for unsubscribe links)
//   REMINDER_DELAY_HOURS (optional) hours after saving before the reminder goes out, default 24
//   REMINDER_MIN_GAP_DAYS (optional) days between two reminders to one person, default 3
//   EMAIL_LOGO_URL      (optional) https logo shown in the email header

const crypto = require('crypto');
const nodemailer = require('nodemailer');

const env = (k, d = '') => process.env[k] || d;

// Settings saved from the admin's Email tab (see _emailSettings.js). Call use(settings) once per request;
// anything not set there falls back to the Vercel env vars below.
let S = {};
function use(settings) { S = settings || {}; }
const setting = (key, envName, d = '') => (S[key] !== undefined && S[key] !== '' ? S[key] : env(envName, d));

// ─── Config ───────────────────────────────────────────────────────────────────
function storeName() {
  return env('STORE_NAME') || env('SHOPIFY_STORE_URL').replace(/\.myshopify\.com$/, '') || 'our store';
}
function storeUrl() {
  const u = env('STORE_URL') || `https://${env('SHOPIFY_STORE_URL')}`;
  return u.replace(/\/+$/, '');
}
function wishlistUrl() {
  const p = env('WISHLIST_PAGE_PATH', '/pages/wishlist');
  return `${storeUrl()}${p.startsWith('/') ? p : '/' + p}`;
}
function publicApiUrl() {
  const u = (env('PUBLIC_API_URL') || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '')).replace(/\/+$/, '');
  return u.startsWith('https://') ? u : '';
}
const mailUser = () => (env('SMTP_USER') || env('GMAIL_USER')).trim();
const mailPass = () => env('SMTP_PASSWORD') || env('GMAIL_APP_PASSWORD');
const smtpHost = () => env('SMTP_HOST', 'smtp.zoho.com').trim();
function isConfigured() {
  return !!(mailUser() && mailPass());
}

// ─── SMTP (Zoho Mail) ─────────────────────────────────────────────────────────
function transport() {
  const port = Number(env('SMTP_PORT')) || 465;
  return nodemailer.createTransport({
    host: smtpHost(), port, secure: port === 465,
    auth: { user: mailUser(), pass: mailPass() },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
  });
}

function failureReason(e) {
  const m = String((e && e.message) || e), code = e && e.code, resp = Number(e && e.responseCode) || 0;
  if (code === 'EAUTH' || resp === 535 || /Invalid login|Username and Password not accepted|BadCredentials/i.test(m))
    return 'Zoho did not accept the login. Check SMTP_USER and SMTP_PASSWORD (use an Application-Specific Password if 2FA is on) and that SMTP_HOST matches your Zoho region, e.g. smtp.zoho.eu';
  if (resp === 553 || /sender|not allowed to send|relay/i.test(m)) return 'Zoho rejected the sender address. The From address must be the SMTP_USER mailbox or one of its aliases';
  if (resp === 550 || /5\.1\.1|does not exist|no such user/i.test(m)) return 'Zoho could not deliver to this address';
  if (resp === 554 || /daily|limit|exceeded|too many/i.test(m)) return "Zoho's sending limit was reached. Try again later";
  if (code === 'ETIMEDOUT' || /timed? ?out/i.test(m)) return 'Zoho did not answer in time';
  if (code === 'ECONNECTION' || code === 'EDNS' || /ENOTFOUND|ECONN|EAI_AGAIN/i.test(m)) return "Couldn't reach " + smtpHost();
  return m.replace(/\s+/g, ' ').slice(0, 160);
}

async function sendMail(to, mail) {
  const user = mailUser();
  const replyTo = setting('replyTo', 'EMAIL_REPLY_TO');
  const mailto = `<mailto:${replyTo || user}?subject=unsubscribe>`;
  return transport().sendMail({
    from: { name: setting('fromName', 'EMAIL_FROM_NAME') || storeName(), address: user },
    to,
    ...(replyTo ? { replyTo } : {}),
    subject: mail.subject, html: mail.html, text: mail.text,
    // with a public link, mail apps (the mail app's "Unsubscribe" button) can unsubscribe in one click
    headers: mail.unsubscribeUrl
      ? { 'List-Unsubscribe': `<${mail.unsubscribeUrl}>, ${mailto}`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
      : { 'List-Unsubscribe': mailto },
  });
}

async function verifyLogin() {
  await transport().verify();
}

// ─── Unsubscribe links (signed, so only this server can make them) ────────────
const secret = () => crypto.createHash('sha256')
  .update(`unsub:${env('UNSUBSCRIBE_SECRET') || env('WISHLIST_API_SECRET') || env('SHOPIFY_ACCESS_TOKEN') || 'nq-wishlist-dev'}`).digest();
const sign = (body) => crypto.createHmac('sha256', secret()).update(body).digest('base64url').slice(0, 32);

function unsubscribeToken(email) {
  const body = Buffer.from(JSON.stringify({ e: String(email).trim().toLowerCase() })).toString('base64url');
  return `${body}.${sign(body)}`;
}
function readToken(token) {
  try {
    const [body, sig] = String(token || '').split('.');
    const a = Buffer.from(sig || ''), b = Buffer.from(sign(body || ''));
    if (!body || a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const { e } = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return e ? String(e) : null;
  } catch { return null; }
}
function unsubscribeUrl(email) {
  const base = publicApiUrl();
  return base ? `${base}/api/unsubscribe?t=${unsubscribeToken(email)}` : '';
}

// ─── Template ─────────────────────────────────────────────────────────────────
const DEFAULTS = {
  subject: '{{customer_name}}, your wishlist at {{store_name}} is waiting',
  heading: 'Hi {{customer_name}}, you saved some favourites',
  message: 'You saved {{product_list}} at {{store_name}}. Still thinking it over?\n\nThey are waiting for you. Come back and pick up where you left off.',
  listTitle: 'Your saved items',
  buttonText: 'View my wishlist',
  footerTitle: 'Questions?',
  footerMessage: 'Just reply to this email or reach us at {email}. We are happy to help.',
  footerNote: 'You are getting this because you saved items at {{store_name}}. You can stop these emails at any time with the link below.',
  maxItems: 5, showList: true, showPrice: true,
  design: {
    corner: 8, headerBg: '#1f2937', footerBg: '#f3f4f6', buttonBg: '#1f2937', buttonText: '#ffffff',
    headingColor: '#111111', textColor: '#444444', headingSize: 24, textSize: 15,
    font: "Arial, Helvetica, sans-serif",
  },
};

// Optional overrides: EMAIL_TEMPLATE_JSON='{"subject":"...","heading":"...","design":{"headerBg":"#000000"}}'
function template() {
  let o = {};
  try { o = JSON.parse(env('EMAIL_TEMPLATE_JSON', '{}')) || {}; } catch { o = {}; }
  const { design: sd, ...rest } = S;
  const font = require('./_emailSettings').FONTS[sd && sd.font];
  return {
    ...DEFAULTS, ...o, ...rest,
    design: { ...DEFAULTS.design, ...(o.design || {}), ...(sd || {}), ...(font ? { font } : {}) },
  };
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const renderTemplate = (t, vars) => String(t).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k])));
const paragraphs = (t) => String(t).split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
const onColour = (h) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#111111' : '#ffffff';
};

// "Kurta, Dress and 1 more"
function productList(titles, max = 5) {
  const shown = titles.slice(0, max);
  const more = titles.length - shown.length;
  if (!shown.length) return '';
  if (shown.length === 1 && !more) return shown[0];
  return more > 0 ? `${shown.join(', ')} and ${more} more` : `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
}

// items: [{ title, url, price (formatted), image }]
function renderEmail({ customerName, items, unsubscribeUrl: unsub = '' }) {
  const c = template(), d = c.design;
  const name = setting('fromName', 'EMAIL_FROM_NAME') || storeName();
  const logoUrl = setting('logoUrl', 'EMAIL_LOGO_URL');
  const logo = /^https:\/\/[^\s"'<>]+$/.test(logoUrl) ? logoUrl : '';
  const contact = setting('replyTo', 'EMAIL_REPLY_TO') || mailUser();
  const shown = items.slice(0, c.maxItems);
  const url = wishlistUrl();
  const vars = {
    customer_name: String(customerName || '').trim().split(/\s+/)[0] || 'there',
    store_name: name,
    product_name: (items[0] && items[0].title) || '',
    product_list: productList(items.map((i) => i.title), c.maxItems),
    product_count: items.length,
    wishlist_url: url,
    product_url: (items[0] && items[0].url) || '',
  };
  const fill = (t) => renderTemplate(t, vars);
  const inEmail = (t) => esc(fill(t).replace(/\{email\}/g, contact));
  const hdrText = onColour(d.headerBg), ftrText = onColour(d.footerBg);

  const header = `<tr><td align="center" style="background:${d.headerBg};padding:28px 24px;color:${hdrText};font-size:22px;font-weight:bold">${
    logo ? `<img src="${esc(logo)}" alt="${esc(name)}" height="44" style="display:inline-block;height:44px;width:auto;border:0">` : esc(name)}</td></tr>`;

  const list = c.showList && shown.length ? `
    <tr><td style="padding:8px 32px 0">
      <div style="font-size:12px;font-weight:bold;letter-spacing:.06em;text-transform:uppercase;color:${d.buttonBg};padding-bottom:8px">${esc(fill(c.listTitle))}</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:${Math.min(d.corner, 12)}px;border-collapse:separate;border-spacing:0">
        ${shown.map((i, n) => `<tr><td style="padding:12px;${n ? 'border-top:1px solid #e5e7eb;' : ''}">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td width="64" valign="middle">${i.image
    ? `<img src="${esc(i.image)}" alt="" width="56" height="64" style="display:block;width:56px;height:64px;object-fit:cover;border-radius:${Math.min(d.corner, 8)}px;border:0">`
    : `<div style="width:56px;height:64px;background:#ececec;border-radius:${Math.min(d.corner, 8)}px"></div>`}</td>
            <td valign="middle" style="padding-left:12px;font-size:${d.textSize}px;color:${d.headingColor}"><a href="${esc(i.url)}" style="color:${d.headingColor};text-decoration:none;font-weight:bold">${esc(i.title)}</a></td>
            ${c.showPrice && i.price ? `<td valign="middle" align="right" style="font-size:${d.textSize}px;color:${d.headingColor};font-weight:bold;white-space:nowrap">${esc(i.price)}</td>` : ''}
          </tr></table></td></tr>`).join('')}
      </table></td></tr>` : '';

  const button = c.buttonText
    ? `<tr><td style="padding:24px 32px 8px"><a href="${esc(url)}" style="display:inline-block;background:${d.buttonBg};color:${d.buttonText};text-decoration:none;font-weight:bold;font-size:${d.textSize}px;padding:13px 28px;border-radius:${d.corner}px">${esc(fill(c.buttonText))}</a></td></tr>`
    : '';

  // the unsubscribe link is always there when we have one: people must be able to stop these emails
  const footer = `<tr><td style="background:${d.footerBg};padding:24px 32px;color:${ftrText};font-size:13px;line-height:1.55">
        ${c.footerTitle ? `<div style="font-weight:bold;font-size:14px;margin-bottom:4px">${esc(fill(c.footerTitle))}</div>` : ''}
        ${c.footerMessage ? `<div>${inEmail(c.footerMessage)}</div>` : ''}
        ${c.footerNote ? `<div style="margin-top:12px;font-size:12px;opacity:.75">${inEmail(c.footerNote)}</div>` : ''}
        ${unsub ? `<div style="margin-top:8px;font-size:12px"><a href="${esc(unsub)}" style="color:${ftrText};text-decoration:underline">Unsubscribe</a></div>` : ''}
      </td></tr>`;

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:${d.font}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:${d.corner}px;overflow:hidden;border-collapse:separate">
${header}
<tr><td style="padding:32px 32px 8px;font-size:${d.headingSize}px;line-height:1.25;font-weight:bold;color:${d.headingColor}">${esc(fill(c.heading))}</td></tr>
<tr><td style="padding:0 32px 20px;font-size:${d.textSize}px;line-height:1.6;color:${d.textColor}">${paragraphs(fill(c.message)).map((p) => `<p style="margin:0 0 14px">${esc(p).replace(/\n/g, '<br>')}</p>`).join('')}</td></tr>
${list}
${button}
<tr><td style="height:24px;line-height:24px;font-size:0">&nbsp;</td></tr>
${footer}
</table></td></tr></table></body></html>`;

  const text = [
    fill(c.heading), '', paragraphs(fill(c.message)).join('\n\n'),
    ...(c.showList ? ['', ...shown.map((i) => `- ${i.title}${c.showPrice && i.price ? ` (${i.price})` : ''}: ${i.url}`)] : []),
    ...(c.buttonText ? ['', `${fill(c.buttonText)}: ${url}`] : []),
    '', [c.footerTitle, c.footerMessage, c.footerNote].filter(Boolean).map((t) => fill(t).replace(/\{email\}/g, contact)).join('\n'),
    ...(unsub ? ['', `Unsubscribe: ${unsub}`] : []),
  ].join('\n');

  return { subject: fill(c.subject).replace(/[\r\n]+/g, ' ').trim(), html, text, unsubscribeUrl: unsub };
}

const SAMPLE_ITEMS = [
  { title: 'Floral Kurta', url: 'https://yourstore.com/products/floral-kurta', price: '₹1,499', image: null },
  { title: 'Linen Palazzo', url: 'https://yourstore.com/products/linen-palazzo', price: '₹999', image: null },
  { title: 'Cotton Dupatta', url: 'https://yourstore.com/products/cotton-dupatta', price: '₹599', image: null },
];

module.exports = {
  env, use, setting, isConfigured, mailUser, storeUrl, wishlistUrl, publicApiUrl,
  sendMail, verifyLogin, failureReason,
  unsubscribeUrl, unsubscribeToken, readToken,
  renderEmail, SAMPLE_ITEMS,
};
