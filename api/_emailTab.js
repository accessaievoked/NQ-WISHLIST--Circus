// The "Email" tab of the admin dashboard: Gmail connection status, template design with a live preview,
// reminder settings and a test email. admin.js pastes css / html / js into the page.

const css = `
.em-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:20px;align-items:start}
@media(max-width:1000px){.em-grid{grid-template-columns:1fr}}
.em-card{background:#fff;border:1px solid #f0f0ee;border-radius:12px;padding:18px;margin-bottom:16px}
.em-card h3{font-size:10px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:#9a9a93;margin-bottom:14px}
.em-row{display:flex;gap:12px;margin-bottom:12px;flex-wrap:wrap}
.em-f{flex:1;min-width:140px;display:flex;flex-direction:column;gap:5px}
.em-f label{font-size:12px;font-weight:500;color:#444}
.em-f input[type=text],.em-f input[type=number],.em-f input[type=email],.em-f textarea,.em-f select{width:100%;padding:9px 11px;border:1px solid #e8e8e4;border-radius:8px;font-size:13px;font-family:'Inter',sans-serif;background:#fafaf8;color:#0a0a0a;outline:none}
.em-f input:focus,.em-f textarea:focus,.em-f select:focus{border-color:#0a0a0a;background:#fff}
.em-f textarea{min-height:92px;resize:vertical;line-height:1.5}
.em-f input[type=color]{width:100%;height:36px;padding:2px;border:1px solid #e8e8e4;border-radius:8px;background:#fff;cursor:pointer}
.em-hint{font-size:11px;color:#9a9a93;line-height:1.5}
.em-check{display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:10px;cursor:pointer}
.em-status{display:flex;align-items:center;gap:10px;font-size:13px;margin-bottom:10px;flex-wrap:wrap}
.em-dot{width:9px;height:9px;border-radius:50%;background:#c9c9c2;flex-shrink:0}
.em-dot.ok{background:#1f9d55}.em-dot.bad{background:#c0392b}
.em-steps{font-size:12px;color:#555;line-height:1.7;background:#fafaf8;border:1px solid #f0f0ee;border-radius:8px;padding:12px 14px;margin-top:10px}
.em-steps code{background:#efefec;padding:1px 5px;border-radius:4px;font-size:11px}
.em-btn{padding:9px 16px;border-radius:8px;border:1px solid #0a0a0a;background:#0a0a0a;color:#fff;font-size:13px;font-weight:500;font-family:'Inter',sans-serif;cursor:pointer}
.em-btn:disabled{opacity:.5;cursor:not-allowed}
.em-btn.ghost{background:#fff;color:#0a0a0a;border-color:#e8e8e4}
.em-preview{position:sticky;top:76px}
.em-preview iframe{width:100%;height:640px;border:1px solid #f0f0ee;border-radius:12px;background:#f3f4f6}
.em-subject{font-size:12px;color:#555;margin-bottom:8px}
.em-savebar{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
`;

const html = `
<div id="screen-email" class="screen" style="display:none">
  <div class="page-header">
    <div>
      <div class="page-eyebrow">Reminders</div>
      <h1 class="page-title">Email</h1>
    </div>
    <div class="em-savebar">
      <span class="em-hint" id="em-saved"></span>
      <button class="em-btn" id="em-save" type="button">Save changes</button>
    </div>
  </div>
  <div id="em-root"><div class="em-hint">Loading…</div></div>
</div>`;

// Runs in the browser. (Written as a real function so it is syntax-checked here, then pasted into the page as text.)
function client() {
  var secret = '', cfg = null, inited = false, timer = null, dirty = false;
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); };
  var toast = function (m) { try { window.showToast ? window.showToast(m) : null; } catch (e) {} var t = $('toast'); if (t) { t.textContent = m; t.classList.add('show'); setTimeout(function () { t.classList.remove('show'); }, 2400); } };
  var url = function (what, extra) { return '/api/admin?data=' + what + '&secret=' + encodeURIComponent(secret) + (extra || ''); };
  var call = function (what, body, extra) {
    return fetch(url(what, extra), body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
      .then(function (r) { return r.json(); });
  };

  var FONTS = [['arial', 'Arial'], ['verdana', 'Verdana'], ['trebuchet', 'Trebuchet'], ['georgia', 'Georgia'], ['times', 'Times']];
  var get = function (k) { return k.indexOf('design.') === 0 ? cfg.design[k.slice(7)] : cfg[k]; };
  var set = function (k, v) { if (k.indexOf('design.') === 0) cfg.design[k.slice(7)] = v; else cfg[k] = v; };

  function field(k, label, type, extra) {
    extra = extra || {};
    var v = get(k), a = ' data-k="' + k + '"';
    var input;
    if (type === 'textarea') input = '<textarea' + a + ' rows="' + (extra.rows || 4) + '">' + esc(v) + '</textarea>';
    else if (type === 'select') input = '<select' + a + '>' + extra.options.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === v ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>';
    else if (type === 'number') input = '<input type="number"' + a + ' min="' + extra.min + '" max="' + extra.max + '" value="' + esc(v) + '">';
    else if (type === 'color') input = '<input type="color"' + a + ' value="' + esc(v) + '">';
    else input = '<input type="' + (type || 'text') + '"' + a + ' value="' + esc(v) + '"' + (extra.ph ? ' placeholder="' + esc(extra.ph) + '"' : '') + '>';
    return '<div class="em-f"><label>' + label + '</label>' + input + (extra.hint ? '<div class="em-hint">' + extra.hint + '</div>' : '') + '</div>';
  }
  function check(k, label) {
    return '<label class="em-check"><input type="checkbox" data-k="' + k + '"' + (get(k) ? ' checked' : '') + '> ' + label + '</label>';
  }

  function build(info) {
    var p = '{{customer_name}}, {{store_name}}, {{product_list}}, {{product_name}}, {{product_count}}, {{wishlist_url}}';
    $('em-root').innerHTML =
      '<div class="em-grid"><div>' +

      '<div class="em-card"><h3>Gmail connection</h3>' +
      '<div class="em-status"><span class="em-dot" id="em-dot"></span><span id="em-conn">' + (info.configured ? 'Login found for <b>' + esc(info.from) + '</b>' : 'Not connected yet') + '</span>' +
      '<button class="em-btn ghost" id="em-check" type="button">Check connection</button></div>' +
      '<div class="em-steps">Emails are sent from your own Gmail. To connect it, add these in <b>Vercel → your project → Settings → Environment Variables</b>, then redeploy:<br>' +
      '<code>GMAIL_USER</code> your Gmail / Google Workspace address<br>' +
      '<code>GMAIL_APP_PASSWORD</code> a 16-character App Password from <b>myaccount.google.com/apppasswords</b> (2-Step Verification must be on)<br>' +
      '<code>PUBLIC_API_URL</code> this site\'s address, e.g. https://your-app.vercel.app (needed for the Unsubscribe link)<br>' +
      '<code>CRON_SECRET</code> any random text<br>' +
      'Your password is kept in Vercel, never in this page or in Shopify.' +
      (info.publicUrl ? '' : '<br><b style="color:#c0392b">PUBLIC_API_URL is not set: emails would go out without an Unsubscribe link.</b>') +
      '</div></div>' +

      '<div class="em-card"><h3>Automatic reminders</h3>' +
      check('enabled', 'Send reminder emails automatically') +
      '<div class="em-row">' + field('delayHours', 'Send after (hours)', 'number', { min: 0, max: 720, hint: 'Hours after the shopper saves an item' }) +
      field('minGapDays', 'Gap between emails (days)', 'number', { min: 0, max: 90, hint: 'Never email the same person more often' }) +
      field('maxItems', 'Max products shown', 'number', { min: 1, max: 10 }) + '</div>' +
      '<div class="em-hint">Reminders only go to shoppers who left an email address. They run once a day.</div></div>' +

      '<div class="em-card"><h3>Sender</h3><div class="em-row">' +
      field('fromName', 'From name', 'text', { ph: 'Your store name' }) + field('replyTo', 'Reply-to email', 'email', { ph: 'care@yourstore.com' }) + '</div>' +
      '<div class="em-row">' + field('logoUrl', 'Logo link (https)', 'text', { ph: 'https://…/logo.png', hint: 'Shown at the top. Leave empty to show the store name.' }) + '</div></div>' +

      '<div class="em-card"><h3>Content</h3>' +
      '<div class="em-row">' + field('subject', 'Subject', 'text') + '</div>' +
      '<div class="em-row">' + field('heading', 'Heading', 'text') + '</div>' +
      '<div class="em-row">' + field('message', 'Message', 'textarea', { rows: 6, hint: 'Leave a blank line between paragraphs. You can use: ' + p }) + '</div>' +
      check('showList', 'Show the list of saved products') + check('showPrice', 'Show prices') +
      '<div class="em-row">' + field('listTitle', 'List title', 'text') + field('buttonText', 'Button text', 'text', { hint: 'Empty hides the button' }) + '</div>' +
      '<div class="em-row">' + field('footerTitle', 'Footer title', 'text') + '</div>' +
      '<div class="em-row">' + field('footerMessage', 'Footer message', 'textarea', { rows: 3, hint: '{email} becomes your reply-to / Gmail address' }) + '</div>' +
      '<div class="em-row">' + field('footerNote', 'Footer note', 'textarea', { rows: 3 }) + '</div></div>' +

      '<div class="em-card"><h3>Design</h3><div class="em-row">' +
      field('design.headerBg', 'Header', 'color') + field('design.footerBg', 'Footer', 'color') + field('design.buttonBg', 'Button', 'color') + field('design.buttonText', 'Button text', 'color') + '</div>' +
      '<div class="em-row">' + field('design.headingColor', 'Heading colour', 'color') + field('design.textColor', 'Text colour', 'color') +
      field('design.font', 'Font', 'select', { options: FONTS }) + '</div>' +
      '<div class="em-row">' + field('design.headingSize', 'Heading size', 'number', { min: 16, max: 40 }) + field('design.textSize', 'Text size', 'number', { min: 12, max: 20 }) +
      field('design.corner', 'Corner roundness', 'number', { min: 0, max: 24 }) + '</div></div>' +

      '<div class="em-card"><h3>Send a test</h3><div class="em-row">' +
      '<div class="em-f"><label>Send a sample email to</label><input type="email" id="em-to" placeholder="you@example.com"></div></div>' +
      '<button class="em-btn ghost" id="em-test" type="button">Send test email</button> <span class="em-hint" id="em-test-res"></span>' +
      '<div class="em-hint" style="margin-top:8px">Sends what you see on the right, even if you have not saved yet.</div></div>' +

      '</div><div class="em-preview"><div class="em-card"><h3>Live preview</h3><div class="em-subject" id="em-subject"></div><iframe id="em-frame" title="Email preview"></iframe></div></div></div>';

    // inputs -> state -> preview
    $('em-root').addEventListener('input', onInput);
    $('em-root').addEventListener('change', onInput);
    $('em-check').onclick = check_;
    $('em-test').onclick = test;
    refreshPreview();
  }

  function onInput(e) {
    var el = e.target, k = el.getAttribute && el.getAttribute('data-k');
    if (!k) return;
    var v = el.type === 'checkbox' ? el.checked : (el.type === 'number' ? Number(el.value) : el.value);
    set(k, v);
    dirty = true; $('em-saved').textContent = 'Unsaved changes';
    clearTimeout(timer); timer = setTimeout(refreshPreview, 350);
  }

  function refreshPreview() {
    call('email-preview', cfg).then(function (r) {
      if (r && r.html) { $('em-frame').srcdoc = r.html; $('em-subject').innerHTML = 'Subject: <b>' + esc(r.subject) + '</b>'; }
    }).catch(function () {});
  }

  function check_() {
    var b = $('em-check'); b.disabled = true; b.textContent = 'Checking…';
    call('email', null, '&check=1').then(function (r) {
      var c = r && r.connection || {};
      $('em-dot').className = 'em-dot ' + (c.connected ? 'ok' : 'bad');
      $('em-conn').innerHTML = c.connected ? 'Connected as <b>' + esc(c.from) + '</b>' : esc(c.error || 'Not connected');
    }).catch(function () { $('em-conn').textContent = 'Could not check the connection'; })
      .then(function () { b.disabled = false; b.textContent = 'Check connection'; });
  }

  function test() {
    var to = $('em-to').value.trim(), b = $('em-test'), out = $('em-test-res');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) { out.textContent = 'Enter a valid email address first'; return; }
    b.disabled = true; out.textContent = 'Sending…';
    call('email-test', { to: to, settings: cfg }).then(function (r) {
      out.textContent = r.status === 'sent' ? 'Sent. Check the inbox (and spam).' : (r.reason || r.error || 'Could not send');
    }).catch(function () { out.textContent = 'Could not send'; }).then(function () { b.disabled = false; });
  }

  function save() {
    var b = $('em-save'); b.disabled = true; b.textContent = 'Saving…';
    call('email', cfg).then(function (r) {
      if (r.error) throw new Error(r.error);
      cfg = r.settings; dirty = false; $('em-saved').textContent = 'Saved';
      toast('Email settings saved ✓');
    }).catch(function (e) { toast('Could not save: ' + (e.message || 'error')); })
      .then(function () { b.disabled = false; b.textContent = 'Save changes'; });
  }

  window.initEmailTab = function (s) {
    secret = s || secret;
    if (inited) return;
    inited = true;
    $('em-save').onclick = save;
    call('email').then(function (r) {
      if (r.error) throw new Error(r.error);
      cfg = r.settings; build(r);
    }).catch(function (e) {
      inited = false;
      $('em-root').innerHTML = '<div class="em-hint">Could not load the email settings (' + esc(e.message) + '). Reload the page and try again.</div>';
    });
  };
}

const js = `(${client.toString()})();`;

module.exports = { css, html, js, client };
