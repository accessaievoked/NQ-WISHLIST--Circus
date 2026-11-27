// Small Shopify helpers shared by the email endpoints (not a route: leading underscore).
const STORE = process.env.SHOPIFY_STORE_URL;
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

async function gql(query, variables = {}) {
  const res = await fetch(`https://${STORE}/admin/api/2024-10/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Shopify API error: ${res.status} ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

// Every wishlist_entry as a flat object { id, phone, customer_email, ... }
async function fetchAllEntries() {
  const out = [];
  let cursor = null, more = true;
  while (more) {
    const data = await gql(
      `query($after: String) {
         metaobjects(type: "wishlist_entry", first: 250, after: $after) {
           nodes { id fields { key value } }
           pageInfo { hasNextPage endCursor }
         }
       }`,
      { after: cursor }
    );
    const { nodes, pageInfo } = data.metaobjects;
    for (const n of nodes) out.push({ id: n.id, ...Object.fromEntries(n.fields.map((f) => [f.key, f.value])) });
    more = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;
  }
  return out;
}

async function updateEntry(id, fields) {
  const data = await gql(
    `mutation($id: ID!, $fields: [MetaobjectFieldInput!]!) {
       metaobjectUpdate(id: $id, metaobject: { fields: $fields }) {
         metaobject { id }
         userErrors { field message }
       }
     }`,
    { id, fields: Object.entries(fields).map(([key, value]) => ({ key, value: String(value) })) }
  );
  const errs = data.metaobjectUpdate.userErrors;
  if (errs.length) throw new Error(JSON.stringify(errs));
}

// Product prices are stored as plain text; format for the email
const money = (v) => {
  const n = Number(v);
  return v === '' || v == null || !Number.isFinite(n) ? '' : '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
};

// Compare-at (MRP) price per variant id, as formatted text. Missing when the variant has none. Never throws.
async function compareAtByVariant(variantIds) {
  const ids = [...new Set(variantIds.map((v) => String(v || '').replace(/\D/g, '')).filter(Boolean))];
  const out = {};
  if (!ids.length) return out;
  try {
    const data = await gql(
      `query($ids: [ID!]!) { nodes(ids: $ids) { ... on ProductVariant { id compareAtPrice price } } }`,
      { ids: ids.map((i) => `gid://shopify/ProductVariant/${i}`) }
    );
    for (const n of data.nodes) {
      if (!n || !n.compareAtPrice) continue;
      if (Number(n.compareAtPrice) > Number(n.price)) out[n.id.split('/').pop()] = money(n.compareAtPrice);
    }
  } catch (e) { console.error('[Compare-at prices]', e.message); }
  return out;
}

// Fills in a missing saved price from the live Shopify price (variant first, then product handle).
// rows: wishlist entries. Returns Map(row -> formatted price) only for rows whose stored price was empty. Never throws.
async function fillMissingPrices(rows) {
  const out = new Map();
  const missing = rows.filter((r) => !money(r.product_price));
  if (!missing.length) return out;
  try {
    const ids = [...new Set(missing.map((r) => String(r.variant_id || '').replace(/\D/g, '')).filter(Boolean))];
    const byVariant = {};
    if (ids.length) {
      const data = await gql(
        `query($ids: [ID!]!) { nodes(ids: $ids) { ... on ProductVariant { id price } } }`,
        { ids: ids.map((i) => `gid://shopify/ProductVariant/${i}`) }
      );
      for (const n of data.nodes) if (n && n.price) byVariant[n.id.split('/').pop()] = money(n.price);
    }
    for (const r of missing) {
      let p = byVariant[String(r.variant_id || '').replace(/\D/g, '')];
      if (!p && r.product_handle) {
        const d = await gql(
          `query($h: String!) { productByHandle(handle: $h) { priceRangeV2 { minVariantPrice { amount } } } }`,
          { h: r.product_handle }
        );
        const a = d.productByHandle && d.productByHandle.priceRangeV2.minVariantPrice.amount;
        if (a) p = money(a);
      }
      if (p) out.set(r, p);
    }
  } catch (e) { console.error('[Missing prices]', e.message); }
  return out;
}

// Adds any email-related fields the wishlist_entry definition is missing (same job as /api/setup, but automatic).
// Returns true if something was added.
async function ensureEntryFields() {
  const want = [
    ['customer_email', 'Customer Email'], ['reminded_at', 'Reminder Sent At'], ['unsubscribed', 'Unsubscribed From Email'],
    ['restock_notified_at', 'Back In Stock Email Sent At'],
  ];
  const look = await gql(`query { metaobjectDefinitionByType(type: "wishlist_entry") { id fieldDefinitions { key } } }`);
  const def = look.metaobjectDefinitionByType;
  if (!def) return false;
  const have = new Set(def.fieldDefinitions.map((f) => f.key));
  const missing = want.filter(([k]) => !have.has(k));
  if (!missing.length) return false;
  const r = await gql(
    `mutation($id: ID!, $d: MetaobjectDefinitionUpdateInput!) {
       metaobjectDefinitionUpdate(id: $id, definition: $d) { userErrors { message } }
     }`,
    { id: def.id, d: { fieldDefinitions: missing.map(([key, name]) => ({ create: { key, name, type: 'single_line_text_field', required: false } })) } }
  );
  if (r.metaobjectDefinitionUpdate.userErrors.length) throw new Error(JSON.stringify(r.metaobjectDefinitionUpdate.userErrors));
  return true;
}

module.exports = { gql, fetchAllEntries, updateEntry, ensureEntryFields, money, compareAtByVariant, fillMissingPrices };
