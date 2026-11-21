// Email template + reminder settings, edited from the "Email" tab of the admin and stored in your Shopify store
// (Content → Metaobjects → "Wishlist Email Settings"). The Zoho login is NOT stored here: it stays in Vercel env vars.
const { gql } = require('./_shopify');

const TYPE = 'wishlist_email_settings';
const HANDLE = 'default';

const FONTS = {
  arial: 'Arial, Helvetica, sans-serif',
  raleway: "'Raleway', Arial, Helvetica, sans-serif",
  verdana: 'Verdana, Geneva, sans-serif',
  trebuchet: "'Trebuchet MS', Helvetica, sans-serif",
  georgia: "Georgia, 'Times New Roman', serif",
  times: "'Times New Roman', Times, serif",
};

const DEFAULTS = {
  enabled: false, delayHours: 24, minGapDays: 3, maxItems: 5,
  subject: '{{customer_name}}, your wishlist at {{store_name}} is waiting',
  heading: 'Hi {{customer_name}}, you saved some favourites',
  message: 'You saved {{product_list}} at {{store_name}}. Still thinking it over?\n\nThey are waiting for you. Come back and pick up where you left off.',
  showList: true, listTitle: 'Your saved items', showPrice: true,
  buttonText: 'View my wishlist',
  fromName: '', replyTo: '', logoUrl: '',
  heroImageUrl: '', tagline: '', promoImageUrl: '', promoLink: '', footerImageUrl: '', footerImageLink: '',
  showTotal: true, totalLabel: 'Total', totalNote: '', shippingText: '',
  promoTitle: '', promoText: '', promoButton: '',
  supportText: '', supportLabel: '', supportEmail: '', supportPhone: '', supportHours: '', whatsappLink: '', showSupportIcons: true,
  bannerTitle: '', bannerText: '', instagramLink: '', facebookLink: '', xLink: '',
  footerTitle: 'Questions?',
  footerMessage: 'Just reply to this email or reach us at {email}. We are happy to help.',
  footerNote: 'You are getting this because you saved items at {{store_name}}. You can stop these emails at any time with the link below.',
  design: {
    corner: 8, headerBg: '#1f2937', logoFull: false, orderStyle: false, footerBg: '#f3f4f6', buttonBg: '#1f2937', buttonText: '#ffffff',
    headingColor: '#111111', textColor: '#444444', headingSize: 24, textSize: 15, font: 'arial',
  },
};

// ─── Sanitising: whatever comes in, a complete and safe config comes out ──────
const int = (v, min, max, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : d; };
const bool = (v, d) => (typeof v === 'boolean' ? v : d);
const hex = (v, d) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toLowerCase() : d);
const clean = (s) => [...s].filter((ch) => { const c = ch.charCodeAt(0); return c >= 32 || c === 9 || c === 10 || c === 13; }).join('');
const text = (v, max, d, { multiline = false, allowEmpty = false } = {}) => {
  if (typeof v !== 'string') return d;
  const t = clean(v).replace(multiline ? /\r\n?/g : /\s*[\r\n]+\s*/g, multiline ? '\n' : ' ').trim().slice(0, max);
  return t || (allowEmpty ? '' : d);
};

const https = (v) => (typeof v === 'string' && /^https:\/\/[^\s"'<>]+$/.test(v.trim()) ? v.trim().slice(0, 500) : '');

const reply2 = (v) => (typeof v === 'string' && /^[^s@<>,;]+@[^s@<>,;]+.[^s@<>,;]+$/.test(v.trim()) ? v.trim().slice(0, 200) : '');

function sanitize(raw) {
  const e = raw && typeof raw === 'object' ? raw : {};
  const D = DEFAULTS, d = e.design && typeof e.design === 'object' ? e.design : {}, DD = D.design;
  const logo = typeof e.logoUrl === 'string' && /^https:\/\/[^\s"'<>]+$/.test(e.logoUrl.trim()) ? e.logoUrl.trim().slice(0, 500) : '';
  const reply = typeof e.replyTo === 'string' && /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(e.replyTo.trim()) ? e.replyTo.trim().slice(0, 200) : '';
  return {
    enabled: bool(e.enabled, D.enabled),
    delayHours: int(e.delayHours, 0, 720, D.delayHours),
    minGapDays: int(e.minGapDays, 0, 90, D.minGapDays),
    maxItems: int(e.maxItems, 1, 10, D.maxItems),
    subject: text(e.subject, 150, D.subject),
    heading: text(e.heading, 150, D.heading, { allowEmpty: typeof e.heading === 'string' }),
    message: text(e.message, 1500, D.message, { multiline: true, allowEmpty: typeof e.message === 'string' }),
    showList: bool(e.showList, D.showList),
    listTitle: text(e.listTitle, 80, D.listTitle),
    showPrice: bool(e.showPrice, D.showPrice),
    buttonText: text(e.buttonText, 40, D.buttonText, { allowEmpty: typeof e.buttonText === 'string' }),
    fromName: text(e.fromName, 60, '', { allowEmpty: true }),
    replyTo: reply,
    logoUrl: logo,
    heroImageUrl: https(e.heroImageUrl), tagline: text(e.tagline, 80, '', { allowEmpty: true }),
    promoImageUrl: https(e.promoImageUrl), promoLink: https(e.promoLink),
    footerImageUrl: https(e.footerImageUrl), footerImageLink: https(e.footerImageLink),
    showTotal: bool(e.showTotal, D.showTotal), totalLabel: text(e.totalLabel, 30, D.totalLabel), totalNote: text(e.totalNote, 60, '', { allowEmpty: true }), shippingText: text(e.shippingText, 30, '', { allowEmpty: true }),
    promoTitle: text(e.promoTitle, 60, '', { allowEmpty: true }), promoText: text(e.promoText, 200, '', { multiline: true, allowEmpty: true }), promoButton: text(e.promoButton, 30, '', { allowEmpty: true }),
    supportText: text(e.supportText, 300, '', { multiline: true, allowEmpty: true }), supportLabel: text(e.supportLabel, 80, '', { allowEmpty: true }),
    supportEmail: reply2(e.supportEmail), supportPhone: text(e.supportPhone, 30, '', { allowEmpty: true }), supportHours: text(e.supportHours, 80, '', { allowEmpty: true }),
    whatsappLink: https(e.whatsappLink), showSupportIcons: bool(e.showSupportIcons, D.showSupportIcons),
    bannerTitle: text(e.bannerTitle, 60, '', { allowEmpty: true }), bannerText: text(e.bannerText, 120, '', { allowEmpty: true }),
    instagramLink: https(e.instagramLink), facebookLink: https(e.facebookLink), xLink: https(e.xLink),
    footerTitle: text(e.footerTitle, 80, D.footerTitle, { allowEmpty: typeof e.footerTitle === 'string' }),
    footerMessage: text(e.footerMessage, 400, D.footerMessage, { multiline: true, allowEmpty: typeof e.footerMessage === 'string' }),
    footerNote: text(e.footerNote, 400, D.footerNote, { multiline: true, allowEmpty: typeof e.footerNote === 'string' }),
    design: {
      corner: int(d.corner, 0, 24, DD.corner),
      headerBg: hex(d.headerBg, DD.headerBg),
      logoFull: bool(d.logoFull, DD.logoFull),
      orderStyle: bool(d.orderStyle, DD.orderStyle),
      footerBg: hex(d.footerBg, DD.footerBg),
      buttonBg: hex(d.buttonBg, DD.buttonBg),
      buttonText: hex(d.buttonText, DD.buttonText),
      headingColor: hex(d.headingColor, DD.headingColor),
      textColor: hex(d.textColor, DD.textColor),
      headingSize: int(d.headingSize, 16, 40, DD.headingSize),
      textSize: int(d.textSize, 12, 20, DD.textSize),
      font: FONTS[d.font] ? d.font : DD.font,
    },
  };
}

// ─── Storage (Shopify metaobject, created on first save) ──────────────────────
async function load() {
  try {
    const data = await gql(
      `query($h: MetaobjectHandleInput!) { metaobjectByHandle(handle: $h) { field(key: "config") { value } } }`,
      { h: { type: TYPE, handle: HANDLE } }
    );
    const v = data.metaobjectByHandle && data.metaobjectByHandle.field && data.metaobjectByHandle.field.value;
    return sanitize(v ? JSON.parse(v) : {});
  } catch (e) {
    console.error('[Email settings load]', e.message);
    return sanitize({});
  }
}

async function ensureDefinition() {
  const data = await gql(
    `mutation($d: MetaobjectDefinitionCreateInput!) {
       metaobjectDefinitionCreate(definition: $d) { metaobjectDefinition { id } userErrors { code message } }
     }`,
    { d: {
      type: TYPE, name: 'Wishlist Email Settings',
      fieldDefinitions: [{ key: 'config', name: 'Config (JSON)', type: 'multi_line_text_field', required: false }],
    } }
  );
  const errs = data.metaobjectDefinitionCreate.userErrors.filter((x) => x.code !== 'TAKEN');
  if (errs.length) throw new Error(JSON.stringify(errs));
}

async function save(raw) {
  const cfg = sanitize(raw);
  await ensureDefinition();
  const data = await gql(
    `mutation($h: MetaobjectHandleInput!, $m: MetaobjectUpsertInput!) {
       metaobjectUpsert(handle: $h, metaobject: $m) { metaobject { id } userErrors { message } }
     }`,
    { h: { type: TYPE, handle: HANDLE }, m: { fields: [{ key: 'config', value: JSON.stringify(cfg) }] } }
  );
  const errs = data.metaobjectUpsert.userErrors;
  if (errs.length) throw new Error(JSON.stringify(errs));
  return cfg;
}

module.exports = { DEFAULTS, FONTS, sanitize, load, save };
