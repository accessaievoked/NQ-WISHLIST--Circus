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

module.exports = { gql, fetchAllEntries, updateEntry, money };
