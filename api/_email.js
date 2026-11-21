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
    corner: 8, headerBg: '#1f2937', logoFull: false, orderStyle: false, footerBg: '#f3f4f6', buttonBg: '#1f2937', buttonText: '#ffffff',
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

  const header = d.logoFull && logo
    ? `<tr><td align="center" style="padding:0;line-height:0;font-size:0"><img src="${esc(logo)}" alt="${esc(name)}" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0"></td></tr>`
    : `<tr><td align="center" style="background:${d.headerBg};padding:28px 24px;color:${hdrText};font-size:22px;font-weight:bold">${
    logo ? `<img src="${esc(logo)}" alt="${esc(name)}" height="44" style="display:inline-block;height:44px;width:auto;border:0">` : esc(name)}</td></tr>`;

  const ord = !!d.orderStyle;
  const imgTag = (u, w) => `<img src="${esc(u)}" alt="" width="${w}" style="display:block;width:100%;max-width:${w}px;height:auto;border:0">`;
  const linked = (u, w, link) => (link ? `<a href="${esc(link)}" style="text-decoration:none">${imgTag(u, w)}</a>` : imgTag(u, w));

  // total of the shown items, only when every price can be read (prices are plain text like "₹1,499")
  const amounts = shown.map((i) => { const m = String(i.price || '').match(/\d[\d,]*(?:\.\d+)?/); return m ? parseFloat(m[0].replace(/,/g, '')) : NaN; });
  const prefix = ((shown[0] && String(shown[0].price || '').match(/^\D*/)) || [''])[0].trim();
  const total = c.showPrice && shown.length && amounts.every((n) => Number.isFinite(n))
    ? `${prefix}${amounts.reduce((a, b) => a + b, 0).toLocaleString(/₹|rs/i.test(prefix) ? 'en-IN' : 'en-US', { minimumFractionDigits: amounts.some((n) => n % 1) ? 2 : 0, maximumFractionDigits: 2 })}` : '';

  const lbl = `font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:${d.headingColor}`;
  const row = (label, value, top, big) => `<tr><td align="right" style="padding:${top}px 14px 0 0;${lbl}">${label}</td><td align="right" style="padding:${top}px 0 0;font-size:${big ? d.textSize + 1 : d.textSize}px;color:${d.headingColor};white-space:nowrap">${value}</td></tr>`;
  const rule = '<tr><td colspan="2" style="padding-top:14px;border-bottom:1px solid #e5e7eb;font-size:0;line-height:0">&nbsp;</td></tr>';
  const totalRows = total && c.showTotal !== false ? [
    rule,
    row('Sub-total', esc(total), 14),
    c.shippingText ? row('Shipping fee', esc(c.shippingText), 8) : '',
    rule,
    row(`${esc(c.totalLabel || 'Total')}${c.totalNote ? ` <span style="font-size:9px;opacity:.6">(${esc(c.totalNote)})</span>` : ''}`, esc(total), 14, true),
  ].join('') : '';

  const orderList = c.showList && shown.length ? `
    <tr><td style="padding:8px 32px 0">
      <div style="background:#f6f6f6;padding:10px 30px;font-size:15px;font-weight:600;text-transform:uppercase;color:#5f5f5f">${esc(fill(c.listTitle))}</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px">
        <tr><td style="padding:0 0 10px;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:${d.headingColor};border-bottom:1px solid #e5e7eb">Item</td>${c.showPrice ? `<td align="right" style="padding:0 0 10px;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:${d.headingColor};border-bottom:1px solid #e5e7eb">Price</td>` : ''}</tr>
        ${shown.map((i) => `<tr><td style="padding:12px 0;border-bottom:1px solid #eeeeee">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td width="56" valign="middle">${i.image ? `<img src="${esc(i.image)}" alt="" width="44" height="52" style="display:block;width:44px;height:52px;object-fit:cover;border:0">` : `<div style="width:44px;height:52px;background:#ececec"></div>`}</td>
            <td valign="middle" style="font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:${d.headingColor}"><a href="${esc(i.url)}" style="color:${d.headingColor};text-decoration:none;font-weight:bold">${esc(i.title)}</a></td>
          </tr></table></td>${c.showPrice ? `<td align="right" valign="middle" style="padding:12px 0;border-bottom:1px solid #eeeeee;font-size:${d.textSize}px;color:${d.headingColor};font-weight:bold;white-space:nowrap">${esc(i.price || '')}</td>` : ''}</tr>`).join('')}
        ${totalRows}
      </table></td></tr>` : '';

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
    ? `<tr><td align="${ord ? 'center' : 'left'}" style="padding:24px 32px 8px"><a href="${esc(url)}" style="display:inline-block;background:${d.buttonBg};color:${d.buttonText};text-decoration:none;font-weight:bold;font-size:${ord ? 16 : d.textSize}px;${ord ? 'text-transform:uppercase;' : ''}padding:${ord ? '17px 36px' : '13px 28px'};border-radius:${d.corner}px">${esc(fill(c.buttonText))}</a></td></tr>`
    : '';

  // the unsubscribe link is always there when we have one: people must be able to stop these emails
  const footer = `<tr><td style="background:${d.footerBg};padding:24px 32px;${ord ? 'text-align:center;' : ''}color:${ftrText};font-size:13px;line-height:1.55">
        ${c.footerTitle ? `<div style="font-weight:bold;font-size:14px;margin-bottom:4px">${esc(fill(c.footerTitle))}</div>` : ''}
        ${c.footerMessage ? `<div>${inEmail(c.footerMessage)}</div>` : ''}
        ${c.footerNote ? `<div style="margin-top:12px;font-size:12px;opacity:.75">${inEmail(c.footerNote)}</div>` : ''}
        ${unsub && !ord ? `<div style="margin-top:8px;font-size:12px"><a href="${esc(unsub)}" style="color:${ftrText};text-decoration:underline">Unsubscribe</a></div>` : ''}
      </td></tr>`;

  const lines = (t) => paragraphs(t).map((q) => esc(q).replace(/\n/g, '<br>')).join('<br><br>');
  // text on top of an image: CSS background (Gmail, Apple Mail, Outlook.com); Outlook desktop shows the dark fallback colour
  const onImage = (u, h, inner, align) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" background="${esc(u)}" style="background:#222222 url('${esc(u)}') center center / cover no-repeat"><tr><td height="${h}" valign="middle" align="${align}" style="height:${h}px;padding:20px 28px">${inner}</td></tr></table>`;

  const promoInner = [
    c.promoTitle ? `<div style="font-size:22px;font-weight:bold;line-height:1.2;margin-bottom:8px;color:#111111">${esc(fill(c.promoTitle))}</div>` : '',
    c.promoText ? `<div style="font-size:${d.textSize}px;line-height:1.5;color:#111111;max-width:300px">${lines(fill(c.promoText))}</div>` : '',
    c.promoButton ? `<div style="margin-top:14px"><a href="${esc(c.promoLink || url)}" style="display:inline-block;background:${d.buttonBg};color:${d.buttonText};text-decoration:none;font-weight:bold;font-size:12px;padding:9px 16px">${esc(fill(c.promoButton))}</a></div>` : '',
  ].join('');
  const promo = c.promoImageUrl
    ? `<tr><td style="padding:0 32px 24px">${promoInner ? onImage(c.promoImageUrl, 200, promoInner, 'left') : linked(c.promoImageUrl, 536, c.promoLink)}</td></tr>` : '';

  const phoneDial = String(c.supportPhone || '').replace(/[^\d+]/g, '');
  // &Circus icon images (the same files the order-confirmation email uses)
  const CDN = 'https://cdn.shopify.com/s/files/1/0750/2191/0293/files/';
  const ICONS = { whatsapp: [CDN + 'em-whatsapp.png?v=1706831088', 32], phone: [CDN + 'em-phone.png?v=1706831088', 30], email: [CDN + 'em-email.png?v=1706831088', 36] };
  const icon = (u, key, alt) => `<a href="${esc(u)}" target="_blank" style="display:inline-block;margin:0 8px;text-decoration:none"><img src="${ICONS[key][0]}" alt="${alt}" width="${ICONS[key][1]}" style="display:block;width:${ICONS[key][1]}px;height:auto;border:0"></a>`;
  // WhatsApp falls back to the &Circus support chat so the icon always shows
  const waLink = c.whatsappLink || 'https://api.whatsapp.com/send/?phone=9843137146&text=I+want+help+%26circus+&type=phone_number&app_absent=0';
  // **bold** in the help text, and the word WhatsApp becomes a link when a WhatsApp link is set
  const richSupport = (t) => lines(fill(t)).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/WhatsApp/, waLink ? `<a href="${esc(waLink)}" target="_blank" style="color:${d.headingColor};text-decoration:underline">WhatsApp</a>` : 'WhatsApp');
  const hasSupport = [c.supportText, c.supportLabel, c.supportEmail, c.supportPhone, c.supportHours, c.whatsappLink].some(Boolean);
  const support = hasSupport ? `<tr><td align="center" style="padding:8px 32px 20px;font-size:12px;line-height:1.6;color:${d.headingColor}">
      ${c.supportText ? `<div style="margin-bottom:14px">${richSupport(c.supportText)}</div>` : ''}
      ${c.supportLabel ? `<div style="margin-bottom:6px">${esc(fill(c.supportLabel))}</div>` : ''}
      ${c.supportEmail || c.supportPhone ? `<div style="font-size:14px;padding:6px 0;border-bottom:1px solid #b9c0e8;display:inline-block">${c.supportEmail ? `<a href="mailto:${esc(c.supportEmail)}" style="color:${d.headingColor};text-decoration:none">${esc(c.supportEmail)}</a>` : ''}${c.supportEmail && c.supportPhone ? ' &nbsp;&bull;&nbsp; ' : ''}${c.supportPhone ? `<a href="tel:${esc(phoneDial)}" style="color:${d.headingColor};text-decoration:none">${esc(c.supportPhone)}</a>` : ''}</div>` : ''}
      ${c.supportHours ? `<div style="margin-top:6px">${esc(c.supportHours)}</div>` : ''}
      ${c.showSupportIcons !== false && (waLink || phoneDial || c.supportEmail) ? `<div style="margin-top:14px">${waLink ? icon(waLink, 'whatsapp', 'WhatsApp') : ''}${phoneDial ? icon('tel:' + phoneDial, 'phone', 'Call') : ''}${c.supportEmail ? icon('mailto:' + c.supportEmail, 'email', 'Email') : ''}</div>` : ''}
    </td></tr>` : '';

  // white PNG icons (email apps do not show SVG); the name is the fallback if images are blocked
  const social = (u, t, file) => (u ? `<a href="${esc(u)}" style="display:inline-block;margin:0 8px;text-decoration:none"><img src="${CDN}${file}" alt="${t}" width="24" height="24" style="display:block;width:24px;height:24px;object-fit:contain;border:0;color:#ffffff;font-size:12px"></a>` : '');
  const bannerInner = [
    c.bannerTitle ? `<div style="font-size:22px;line-height:1.3;color:#ffffff">${esc(fill(c.bannerTitle))}</div>` : '',
    c.instagramLink || c.facebookLink || c.xLink ? `<div style="margin-top:12px">${social(c.instagramLink, 'Instagram', 'instagram-white.png?v=1706832607')}${social(c.facebookLink, 'Facebook', 'facebook-white.png?v=1706832606')}${social(c.xLink, 'X', 'x-twitter.png?v=1706832606')}</div>` : '',
    c.bannerText ? `<div style="margin-top:28px;font-size:11px;font-weight:bold;color:#ffffff">${esc(fill(c.bannerText))}</div>` : '',
  ].join('');
  const bottom = c.footerImageUrl
    ? (bannerInner ? `<tr><td style="padding:0">${onImage(c.footerImageUrl, 205, bannerInner, 'center')}</td></tr>`
      : `<tr><td style="padding:0;line-height:0;font-size:0">${linked(c.footerImageUrl, 600, c.footerImageLink)}</td></tr>`) : '';

  const msgRow = !paragraphs(fill(c.message)).length || (ord && c.showMessage !== true) ? '' : `<tr><td align="${ord ? 'center' : 'left'}" style="padding:${ord ? '12px' : '0'} 32px 20px;font-size:${d.textSize}px;line-height:1.6;color:${d.textColor}">${paragraphs(fill(c.message)).map((p) => `<p style="margin:0 0 14px">${esc(p).replace(/\n/g, '<br>')}</p>`).join('')}</td></tr>`;

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Raleway:wght@400;700&display=swap" rel="stylesheet"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:${d.font}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:${d.corner}px;overflow:hidden;border-collapse:separate">
${header}
${ord && c.heroImageUrl ? `<tr><td style="padding:0;line-height:0;font-size:0">${imgTag(c.heroImageUrl, 600)}</td></tr>` : fill(c.heading).trim() ? `<tr><td align="${ord ? 'center' : 'left'}" style="padding:32px 32px 8px;font-size:${d.headingSize}px;line-height:1.25;font-weight:bold;color:${d.headingColor}">${esc(fill(c.heading))}</td></tr>` : ''}
${ord && c.tagline ? `<tr><td align="center" style="padding:8px 32px 8px;font-size:${d.textSize}px;letter-spacing:.2em;text-transform:uppercase;color:${d.headingColor}">${esc(fill(c.tagline))}</td></tr>` : ''}
${ord ? orderList : ''}
${ord ? '' : msgRow}
${ord ? msgRow : ''}
${ord ? '' : list}
${button}
<tr><td style="height:24px;line-height:24px;font-size:0">&nbsp;</td></tr>
${ord ? promo : ''}
${ord ? support : ''}
${footer}
${bottom}
${ord && unsub ? `<tr><td align="center" style="padding:22px 32px;font-size:12px"><a href="${esc(unsub)}" style="color:#000000;text-decoration:underline">Unsubscribe</a></td></tr>` : ''}
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
