(function () {
  'use strict';
  var R = window.RADAR, M = R.meta, ROWS = R.rows, LIVE = R.live;
  var CURATOR = { 'Risk Curators': 1, 'Onchain Capital Allocator': 1 };
  var $ = function (s, e) { return (e || document).querySelector(s); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  // ---------- formatting ----------
  function usd(n) {
    if (n == null) return '—';
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M';
    if (a >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + Math.round(n);
  }
  function full(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function pct(v) { return v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(1) + '%'; }
  function mult(v) { return v == null ? '—' : v.toFixed(v < 10 ? 3 : 1); }
  function srcLabel(m) { return m.multiple_source === 'category' ? 'category median · n=' + m.category_sample : 'global median'; }
  function chainsText(r) { return r.chains.length ? r.chains.join(', ') : '—'; }
  function chainsShort(r) { return !r.chains.length ? '—' : r.chains.length <= 2 ? r.chains.join(', ') : r.chains[0] + ' +' + (r.chains.length - 1); }

  // ---------- columns ----------
  // key, label, numeric, accessor, cell renderer
  var logMin = Math.log(Math.min.apply(null, ROWS.map(function (r) { return r.implied_value_usd; })));
  var logMax = Math.log(Math.max.apply(null, ROWS.map(function (r) { return r.implied_value_usd; })));
  function bar(v) { return Math.max(2, Math.round(100 * (Math.log(v) - logMin) / (logMax - logMin))); }
  function chg(v) { return '<td class="n ' + (v == null ? '' : v >= 0 ? 'up' : 'dn') + '">' + pct(v) + '</td>'; }

  var COLS = {
    board: [
      { k: 'rank', l: '#', n: 1, v: function (r) { return r.rank; }, c: function (r) { return '<td class="n rk">' + r.rank + '</td>'; } },
      { k: 'name', l: 'Protocol', v: function (r) { return r.name.toLowerCase(); }, c: function (r) { return '<td class="nm">' + esc(r.name) + (r.on_watchlist ? '<i title="On the make.fun watchlist">WL</i>' : '') + '</td>'; } },
      { k: 'cat', l: 'Category', v: function (r) { return r.category.toLowerCase(); }, c: function (r) { return '<td class="ct" title="' + esc(r.category) + '">' + esc(r.category) + (CURATOR[r.category] ? '<em title="TVL largely counts deposits into other protocols’ vaults; implied value can double-count">dbl?</em>' : '') + '</td>'; } },
      { k: 'chains', l: 'Chains', cls: 'ch', v: function (r) { return r.chains.length; }, n: 1, c: function (r) { return '<td class="n ch" title="' + esc(chainsText(r)) + '">' + esc(chainsShort(r)) + '</td>'; } },
      { k: 'tvl', l: 'TVL', n: 1, v: function (r) { return r.tvl_usd; }, c: function (r) { return '<td class="n">' + usd(r.tvl_usd) + '</td>'; } },
      { k: 'chg', l: '7d', n: 1, v: function (r) { return r.change_7d; }, c: function (r) { return chg(r.change_7d); } },
      { k: 'implied', l: 'Implied value', n: 1, v: function (r) { return r.implied_value_usd; }, c: function (r) { return '<td class="n iv">' + usd(r.implied_value_usd) + '<i style="width:' + bar(r.implied_value_usd) + '%"></i></td>'; } },
      { k: 'mult', l: 'Multiple', n: 1, v: function (r) { return r.model.category_multiple; }, c: function (r) { return '<td class="n mu">×' + mult(r.model.category_multiple) + '<small class="src">' + srcLabel(r.model) + '</small></td>'; } },
      { k: 'age', l: 'No token for', n: 1, v: function (r) { return r.age_days; }, c: function (r) { return '<td class="n">' + (r.age_days == null ? '—' : r.age_days + ' d') + '</td>'; } }
    ],
    live: [
      { k: 'name', l: 'Protocol', v: function (r) { return r.name.toLowerCase(); }, c: function (r) { return '<td class="nm">' + esc(r.name) + '</td>'; } },
      { k: 'sym', l: 'Symbol', v: function (r) { return (r.symbol || '').toLowerCase() || null; }, c: function (r) { return '<td>' + esc(r.symbol || '—') + '</td>'; } },
      { k: 'cat', l: 'Category', v: function (r) { return r.category.toLowerCase(); }, c: function (r) { return '<td class="ct">' + esc(r.category) + '</td>'; } },
      { k: 'chains', l: 'Chains', n: 1, cls: 'ch', v: function (r) { return r.chains.length; }, c: function (r) { return '<td class="n ch" title="' + esc(chainsText(r)) + '">' + esc(chainsShort(r)) + '</td>'; } },
      { k: 'mcap', l: 'Market cap', n: 1, v: function (r) { return r.mcap_usd || null; }, c: function (r) { return '<td class="n">' + (r.mcap_usd ? usd(r.mcap_usd) : '<span style="color:var(--dim)" title="no market cap recorded">n/a</span>') + '</td>'; } },
      { k: 'tvl', l: 'TVL', n: 1, v: function (r) { return r.tvl_usd; }, c: function (r) { return '<td class="n">' + usd(r.tvl_usd) + '</td>'; } },
      { k: 'chg', l: '7d', n: 1, v: function (r) { return r.change_7d; }, c: function (r) { return chg(r.change_7d); } },
      { k: 'ratio', l: 'Mcap / TVL', n: 1, v: function (r) { return r.mcap_usd && r.tvl_usd ? r.mcap_usd / r.tvl_usd : null; }, c: function (r) { return '<td class="n">' + (r.mcap_usd && r.tvl_usd ? '×' + mult(r.mcap_usd / r.tvl_usd) : '—') + '</td>'; } }
    ]
  };
  var DEFSORT = { board: ['rank', 1], live: ['mcap', -1] };

  // ---------- state (mirrored in the URL hash) ----------
  var S = { view: 'board', sel: null, cat: '', chain: '', wl: false, q: '', sort: 'rank', dir: 1 };
  function parseHash() {
    var h = location.hash.replace(/^#\/?/, ''), qs = '', i = h.indexOf('?');
    if (i >= 0) { qs = h.slice(i + 1); h = h.slice(0, i); }
    var p = h.split('/');
    S.view = 'board'; S.sel = null;
    if (p[0] === 'live' || p[0] === 'model') S.view = p[0];
    if (p[0] === 'p' && p[1]) S.sel = decodeURIComponent(p[1]);
    var o = {};
    qs.split('&').forEach(function (kv) { if (kv) { var a = kv.split('='); o[a[0]] = decodeURIComponent(a[1] || ''); } });
    S.cat = o.cat || ''; S.chain = o.chain || ''; S.wl = o.wl === '1'; S.q = o.q || '';
    var d = DEFSORT[S.view] || DEFSORT.board;
    S.sort = o.s || d[0]; S.dir = o.d ? +o.d : d[1];
  }
  function hash(over) {
    var s = {}, k; for (k in S) s[k] = S[k]; for (k in (over || {})) s[k] = over[k];
    var d = DEFSORT[s.view] || DEFSORT.board, a = [];
    if (s.cat) a.push('cat=' + encodeURIComponent(s.cat));
    if (s.chain) a.push('chain=' + encodeURIComponent(s.chain));
    if (s.wl) a.push('wl=1');
    if (s.q) a.push('q=' + encodeURIComponent(s.q));
    if (s.sort !== d[0] || s.dir !== d[1]) a.push('s=' + s.sort, 'd=' + s.dir);
    var path = s.sel ? 'p/' + encodeURIComponent(s.sel) : s.view === 'board' ? 'board' : s.view;
    return '#/' + path + (a.length ? '?' + a.join('&') : '');
  }
  function go(over) { var h = hash(over); if (location.hash === h) route(); else location.hash = h; }
  function replace(over) { var h = hash(over); history.replaceState(null, '', h); }

  // ---------- data selection ----------
  function dataset() { return S.view === 'live' ? LIVE : ROWS; }
  function pick() {
    var q = S.q.trim().toLowerCase();
    var rows = dataset().filter(function (r) {
      if (S.cat && r.category !== S.cat) return false;
      if (S.chain && r.chains.indexOf(S.chain) < 0) return false;
      if (S.wl && S.view === 'board' && !r.on_watchlist) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + (r.symbol || '') + ' ' + r.category).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var col = COLS[S.view].filter(function (c) { return c.k === S.sort; })[0] || COLS[S.view][0], dir = S.dir;
    rows.sort(function (a, b) {
      var x = col.v(a), y = col.v(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return (x < y ? -1 : x > y ? 1 : 0) * dir || (a.name < b.name ? -1 : 1);
    });
    return rows;
  }

  // ---------- rendering ----------
  var app = $('#app'), bar$ = $('#bar'), shown = null;
  function opts(list, cur, all) {
    return '<option value="">' + all + '</option>' + list.map(function (x) { return '<option' + (x === cur ? ' selected' : '') + ' value="' + esc(x) + '">' + esc(x) + '</option>'; }).join('');
  }
  function uniq(rows, f) { var m = {}; rows.forEach(function (r) { f(r).forEach(function (x) { m[x] = 1; }); }); return Object.keys(m).sort(function (a, b) { return a.toLowerCase() < b.toLowerCase() ? -1 : 1; }); }

  function renderBar() {
    var tab = function (v, t, n) { return '<a href="' + hash({ view: v, sel: null, cat: '', chain: '', wl: false, q: '', sort: (DEFSORT[v] || DEFSORT.board)[0], dir: (DEFSORT[v] || DEFSORT.board)[1] }) + '"' + (S.view === v ? ' aria-current="page"' : '') + '>' + t + (n != null ? ' <em>' + n + '</em>' : '') + '</a>'; };
    var h = '<div class="tabs">' + tab('board', 'Pre-token board', ROWS.length) + tab('live', 'Token already trades', LIVE.length) + tab('model', 'Model') + '</div>';
    if (S.view !== 'model') {
      var ds = dataset();
      h += '<div class="filters">' +
        '<select id="fcat" aria-label="Category">' + opts(uniq(ds, function (r) { return [r.category]; }), S.cat, 'All categories') + '</select>' +
        '<select id="fchain" aria-label="Chain">' + opts(uniq(ds, function (r) { return r.chains; }), S.chain, 'All chains') + '</select>' +
        (S.view === 'board' ? '<label class="chk"><input type="checkbox" id="fwl"' + (S.wl ? ' checked' : '') + '> Watchlist only</label>' : '') +
        '<input type="search" id="fq" placeholder="Search name, symbol…" aria-label="Search" value="' + esc(S.q) + '">' +
        '<span class="cnt" id="cnt"></span>' +
        '<button id="freset" type="button">Reset</button></div>';
    }
    bar$.innerHTML = h;
  }

  function renderTable() {
    var rows = pick(), cols = COLS[S.view];
    var sel = S.sel;
    var head = '<tr>' + cols.map(function (c) {
      var on = c.k === S.sort;
      return '<th class="' + (c.n ? 'n ' : '') + (c.cls || '') + '"' + (on ? ' aria-sort="' + (S.dir > 0 ? 'ascending' : 'descending') + '"' : '') + '><button type="button" data-sort="' + c.k + '">' + c.l + '</button></th>';
    }).join('') + '</tr>';
    var body = rows.map(function (r) {
      return '<tr' + (S.view === 'board' ? ' tabindex="0" data-slug="' + esc(r.slug) + '"' : '') + (r.slug === sel ? ' class="sel"' : '') + '>' + cols.map(function (c) { return c.c(r); }).join('') + '</tr>';
    }).join('');
    var tb = $('#tbox');
    var top = tb ? tb.scrollTop : 0;
    $('#tbox').innerHTML = '<table><thead>' + head + '</thead><tbody>' + body + '</tbody></table>' + (rows.length ? '' : '<div class="empty">No protocols match these filters.</div>');
    tb.scrollTop = top;
    var cnt = $('#cnt');
    if (cnt) cnt.innerHTML = '<b>' + rows.length + '</b> / ' + dataset().length;
  }

  function stepParts(s) {
    var m = /^(.*?)\s*Cost:\s*(.*?)\s*Time:\s*(.*)$/.exec(s);
    return m ? { t: m[1], c: m[2], d: m[3] } : { t: s, c: '', d: '' };
  }

  function renderDetail(r) {
    var m = r.model, g = m.growth_factor, a = m.age_factor;
    var steps = r.farm_steps.map(function (s) {
      var p = stepParts(s);
      return '<li><p>' + esc(p.t) + '</p>' + (p.c || p.d ? '<div class="ct2"><span>Cost <b>' + esc(p.c.replace(/\.$/, '')) + '</b></span><span>Time <b>' + esc(p.d.replace(/\.$/, '')) + '</b></span></div>' : '') + '</li>';
    }).join('');
    return '<aside class="detail" aria-label="Protocol detail">' +
      '<div class="dh"><div><h2>' + esc(r.name) + '</h2><div class="sub">#' + r.rank + ' · ' + esc(r.category) + ' · ' + esc(chainsText(r)) + (r.on_watchlist ? ' · watchlist' : '') + '</div></div><button class="x" type="button" id="close" aria-label="Close detail">✕</button></div>' +
      '<div class="big"><small>Implied value</small>' + full(r.implied_value_usd) + '</div>' +
      '<div class="eq">' + usd(r.tvl_usd) + ' TVL × ' + mult(m.category_multiple) + ' × ' + g.toFixed(4) + ' × ' + a.toFixed(4) + ' = ' + full(r.implied_value_usd) + ' <span title="factors shown rounded to 4 places">(factors rounded)</span></div>' +
      '<h3>Model inputs</h3><dl class="inp">' +
      '<div><dt>TVL</dt><dd>' + full(r.tvl_usd) + '</dd></div>' +
      '<div><dt>Multiple (mcap / TVL)</dt><dd>×' + mult(m.category_multiple) + '<small>' + srcLabel(m) + (m.multiple_source === 'global' ? ' (category has n=' + m.category_sample + ', needs ' + M.params.min_sample + ')' : '') + '</small></dd></div>' +
      '<div><dt>Growth factor</dt><dd>×' + g.toFixed(4) + '<small>7d TVL change ' + pct(r.change_7d) + (r.change_7d == null ? ' (not reported, factor 1)' : '') + '</small></dd></div>' +
      '<div><dt>Age factor</dt><dd>×' + a.toFixed(4) + '<small>' + (r.age_days == null ? 'listing date unknown, ' + M.params.unknown_age_days + ' d assumed' : r.age_days + ' days with no token') + (r.listed_at ? ', listed ' + esc(r.listed_at) : '') + '</small></dd></div></dl>' +
      (CURATOR[r.category] ? '<div class="warn"><b>Double-count risk.</b> ' + esc(r.category) + ' TVL largely counts deposits into other protocols’ vaults, so this implied value may count the same money twice.</div>' : '') +
      '<h3>Farm plan · ' + r.farm_steps.length + ' steps</h3><ol class="steps">' + steps + '</ol></aside>';
  }

  function renderModel() {
    var cm = M.category_multiples.slice().sort(function (a, b) { return (a.source === b.source ? 0 : a.source === 'category' ? -1 : 1) || b.sample - a.sample || (a.category < b.category ? -1 : 1); });
    var c = M.counts;
    return '<div class="page"><section>' +
      '<h2>Model</h2><p>' + esc(M.model_note) + '</p>' +
      '<div class="f">implied = TVL × multiple × growth × age<br><span>growth = 1 + 0.5 × clamp(7d change, −50, +100) / 100</span><br><span>age = 0.60 + 0.40 × ln(1 + days) / ln(1 + 1460)</span></div>' +
      '<h2>Snapshot</h2><dl><dt>as of</dt><dd>' + esc(M.as_of) + '</dd><dt>source</dt><dd>' + esc(M.source) + '</dd><dt>protocols</dt><dd>' + c.protocols + ' (' + c.has_token + ' token already trades, ' + c.pre_token + ' pre-token)</dd><dt>excluded</dt><dd>' + c.pre_token_excluded + ' pre-token (bridges, staking, wrapped, CEX, versions)</dd><dt>board</dt><dd>' + c.board_rows + ' rows, watchlist ' + c.watchlist_on_board + '/' + c.watchlist + '</dd><dt>global multiple</dt><dd>×' + mult(M.global_multiple) + ' (median of ' + M.global_sample + ')</dd></dl>' +
      '<h2>Caveat</h2><div class="caveat"><p><b>Curators and allocators can double-count.</b> TVL for Risk Curators and Onchain Capital Allocator protocols largely counts deposits into other protocols’ vaults, so the same dollars may already be counted in the vaults they feed. Their implied values, which sit at the top of the board, are upper bounds, not clean estimates. Rows are marked <b>dbl?</b>.</p><p>The figure is a claim from public snapshot numbers, not a prediction that a token will launch.</p></div>' +
      '</section><section><h2>Category multiples · ' + cm.length + ' categories</h2><table class="mt"><thead><tr><th><button type="button">Category</button></th><th class="n"><button type="button">Peers n</button></th><th class="n"><button type="button">Median mcap/TVL</button></th><th class="n"><button type="button">Used</button></th><th><button type="button">Source</button></th></tr></thead><tbody>' +
      cm.map(function (x) { return '<tr' + (x.source === 'global' ? ' class="g"' : '') + '><td class="ct">' + esc(x.category) + '</td><td class="n">' + x.sample + '</td><td class="n">' + (x.median_mcap_to_tvl == null ? '—' : mult(x.median_mcap_to_tvl)) + '</td><td class="n">×' + mult(x.multiple_used) + '</td><td>' + (x.source === 'category' ? 'category median' : 'global median') + '</td></tr>'; }).join('') +
      '</tbody></table></section></div>';
  }

  function route() {
    parseHash();
    renderBar();
    $('#stats').innerHTML = [['as of', M.as_of], ['pre-token', ROWS.length], ['token trades', LIVE.length], ['watchlist', M.counts.watchlist_on_board + '/' + M.counts.watchlist]].map(function (x) { return '<div>' + x[0].toUpperCase() + '<b>' + x[1] + '</b></div>'; }).join('');
    if (S.view === 'model') { app.innerHTML = renderModel(); return; }
    var r = S.sel && S.view === 'board' ? ROWS.filter(function (x) { return x.slug === S.sel; })[0] : null;
    app.innerHTML = '<div class="wrap' + (r ? ' split' : '') + '"><div class="tbox" id="tbox"></div>' + (r ? renderDetail(r) : '') + '</div>';
    renderTable();
    var d = $('.detail'); if (d) d.scrollTop = 0;
    if (r) { var row = $('tr.sel'); if (row && row.scrollIntoView) row.scrollIntoView({ block: 'nearest' }); }
  }

  // ---------- events ----------
  document.addEventListener('click', function (e) {
    var t = e.target, b = t.closest ? t.closest('[data-sort]') : null;
    if (b) { var k = b.getAttribute('data-sort'); go({ sort: k, dir: S.sort === k ? -S.dir : (k === 'name' || k === 'cat' || k === 'sym' || k === 'rank' ? 1 : -1) }); return; }
    var tr = t.closest ? t.closest('tr[data-slug]') : null;
    if (tr) { go({ view: 'board', sel: tr.getAttribute('data-slug') }); return; }
    if (t.id === 'close') { go({ sel: null }); return; }
    if (t.id === 'freset') go({ cat: '', chain: '', wl: false, q: '', sel: S.sel });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && S.sel) { go({ sel: null }); return; }
    var tr = e.target.closest && e.target.closest('tr[data-slug]');
    if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); go({ sel: tr.getAttribute('data-slug') }); }
    if (tr && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      var n = e.key === 'ArrowDown' ? tr.nextElementSibling : tr.previousElementSibling;
      if (n) { e.preventDefault(); n.focus(); }
    }
  });
  function filt(over) { for (var k in over) S[k] = over[k]; replace({}); renderTable(); }
  document.addEventListener('input', function (e) { if (e.target.id === 'fq') filt({ q: e.target.value }); });
  document.addEventListener('change', function (e) {
    var id = e.target.id;
    if (id === 'fcat') filt({ cat: e.target.value });
    else if (id === 'fchain') filt({ chain: e.target.value });
    else if (id === 'fwl') filt({ wl: e.target.checked });
  });
  window.addEventListener('hashchange', route);
  route();
})();
