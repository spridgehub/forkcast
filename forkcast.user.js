// ==UserScript==
// @name         Forkcast Helper
// @namespace    forkcast.spridge
// @version      1.0.1792906678
// @description  One-click trolley filling for Forkcast and Plates: fills your supermarket trolley in your own browser.
// @match        https://ocado.com/*
// @match        https://*.ocado.com/*
// @match        https://tesco.com/*
// @match        https://*.tesco.com/*
// @match        https://sainsburys.co.uk/*
// @match        https://*.sainsburys.co.uk/*
// @match        https://asda.com/*
// @match        https://*.asda.com/*
// @match        https://morrisons.com/*
// @match        https://*.morrisons.com/*
// @match        https://waitrose.com/*
// @match        https://*.waitrose.com/*
// @match        https://iceland.co.uk/*
// @match        https://*.iceland.co.uk/*
// @match        https://aldi.co.uk/*
// @match        https://*.aldi.co.uk/*
// @match        http://100.122.51.100/*
// @match        https://100.122.51.100/*
// @match        http://192.168.1.178/*
// @match        https://192.168.1.178/*
// @match        http://localhost/*
// @match        https://localhost/*
// @match        http://127.0.0.1/*
// @match        https://127.0.0.1/*
// @match        http://spridge-bot.github.io/*
// @match        https://spridge-bot.github.io/*
// @run-at       document-idle
// @grant        none
// @inject-into  page
// @downloadURL  https://spridge-bot.github.io/forkcast/forkcast.user.js
// @updateURL    https://spridge-bot.github.io/forkcast/forkcast.user.js
// ==/UserScript==
(() => {
  "use strict";
  const VERSION = "1.0.1792906678";
  const here = location.hostname;
  // on Forkcast / Plates: just say the helper is installed, so they offer the one-click button
  if (["100.122.51.100","192.168.1.178","localhost","127.0.0.1","spridge-bot.github.io"].includes(here)) { document.documentElement.dataset.fcHelper = VERSION; return; }
  const FILLS = [
    { host: "ocado.com", tag: "forkcast", run: () => {
// Runs ON ocado.com, in whatever browser you're using (bookmarklet). Replaces that browser's Ocado
// trolley with the Forkcast basket carried in the link: #forkcast=<id>:<qty>,…  (ids without dashes).
// After you confirm, everything else in the trolley is taken out and each product is set to exactly
// the list's quantity, in one request. Running it twice is harmless.
(async () => {
  const TAG = "forkcast";
  const h = new URLSearchParams(location.hash.slice(1)).get(TAG);
  if (!h) return alert("Open Ocado from the Forkcast comparison page first, then tap this again.");
  const uuid = s => s.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
  const want = {};
  h.split(",").map(x => x.split(":")).forEach(([i, q]) => { if (i) want[uuid(decodeURIComponent(i).replace(/-/g, ""))] = +q || 1; });
  const html = await (await fetch("/", { headers: { Accept: "text/html" }, credentials: "include" })).text();
  const tok = (/"csrf":\{"token":"([^"]+)"/.exec(html) || [])[1];
  if (!tok) return alert("Ocado isn't ready yet. Wait a moment and tap again.");
  const cart = await (await fetch("/api/cart/v1/carts/active?cartProductSorting=CATEGORIES", { headers: { Accept: "application/json" }, credentials: "include" })).json();
  const have = {};
  (Array.isArray(cart.items) ? cart.items : Object.values(cart.items || {})).forEach(i => have[i.productId] = i.quantity);
  const total = Object.values(want).reduce((a, q) => a + q, 0);
  const extra = Object.keys(have).filter(id => !(id in want)).length;
  if (extra && !confirm(`Replace your Ocado trolley with the ${TAG === "plates" ? "Plates" : "Forkcast"} list (${total} packs)?\n\n${extra} other item${extra === 1 ? "" : "s"} in the trolley will be taken out.`)) return;
  const ops = [];
  for (const id of new Set([...Object.keys(want), ...Object.keys(have)])) {
    const d = (want[id] || 0) - (have[id] || 0);
    if (d) ops.push({ productId: id, quantity: d });
  }
  if (ops.length) {
    const r = await fetch("/api/cart/v1/carts/active/apply-quantity?cartProductSorting=CATEGORIES", { method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json; charset=utf-8", "x-csrf-token": tok }, body: JSON.stringify(ops) });
    if (!r.ok) return alert("Ocado didn't accept the items (HTTP " + r.status + "). Try again in a minute.");
  }
  history.replaceState(null, "", "/basket");
  location.href = "/basket";
})();

} },
    { host: "tesco.com", tag: "forkcast", run: () => {
// Forkcast → Tesco trolley. Runs ON www.tesco.com as a bookmarklet, in the shopper's own browser.
// Reads #forkcast=<encodeURIComponent(tpnc)>:<qty>,… and adds what's missing to THIS browser's
// trolley through Tesco's own GraphQL gateway (the same GetBasket / UpdateBasket operations the
// site's mfe-basket-manager sends). Never removes anything, never checks out.
//
// Tesco has no guest trolley: the basket service answers 401 "Unauthorized" to a signed-out
// browser, and the site itself sends guests to the sign-in page when they press "Add". So the
// shopper must be signed in to Tesco; this script then uses the page's own config
// (script[type="application/discover+json"] → mfe-orchestrator.props.config: mangoUrl,
// mangoApiKey, authorization) exactly as the site does.
(async () => {
  try {
    // If Tesco sent the shopper off to sign in, the #fragment is lost on the way back, so the list
    // is parked in localStorage (same www.tesco.com origin) and picked up on the next tap.
    let raw = (/[#&]forkcast=([^&]*)/.exec(location.hash) || [])[1];
    const PARK = "forkcastPending";
    if (!raw) try { const p = JSON.parse(localStorage.getItem(PARK) || "null"); if (p && Date.now() - p.t < 3 * 3600e3) raw = p.raw; } catch (e) {}
    if (!raw) return alert("Open Tesco from your Forkcast shopping list first, then tap this again.");
    const park = () => { try { localStorage.setItem(PARK, JSON.stringify({ raw, t: Date.now() })); } catch (e) {} };
    const unpark = () => { try { localStorage.removeItem(PARK); } catch (e) {} };
    if (!/(^|\.)tesco\.com$/.test(location.hostname)) return alert("Open tesco.com first, then tap this again.");
    const want = [];
    raw.split(",").forEach(x => {
      const i = x.lastIndexOf(":"), id = decodeURIComponent(i > 0 ? x.slice(0, i) : x).trim();
      const q = Math.max(1, Math.round(+(i > 0 ? x.slice(i + 1) : 1)) || 1);
      if (id) want.push({ id, q });
    });
    if (!want.length) return alert("The Forkcast list in this link is empty.");

    let url = "https://xapi.tesco.com/", key = "TvOSZJHlEk0pjniDGQFAc9Q59WGAR4dA", auth = null, signedIn;
    try {
      const d = JSON.parse(document.querySelector('script[type="application/discover+json"]').textContent);
      const c = d["mfe-orchestrator"].props.config;
      url = c.mangoUrl || url; key = c.mangoApiKey || key; auth = c.authorization || null;
      const a = d["mfe-basket-manager"] && d["mfe-basket-manager"].props.authentication;
      if (a) signedIn = !!a.authenticated;
    } catch (e) {}
    const SIGN_IN_MSG = "Sign in to Tesco first (Tesco only lets signed-in shoppers fill a trolley), then tap Forkcast again.";
    const SIGN_IN = () => { park(); alert(SIGN_IN_MSG); };
    if (signedIn === false) return SIGN_IN();

    const headers = { accept: "application/json", "accept-language": "en-GB", "content-type": "application/json",
      "x-apikey": key, language: "en-GB", region: "UK" };
    if (auth) headers.authorization = auth;
    const gql = async (operationName, query, variables) => {
      const r = await fetch(url, { method: "POST", credentials: "include", headers,
        body: JSON.stringify([{ operationName, variables, extensions: { mfeName: "mfe-basket-manager" }, query }]) });
      const j = await r.json().catch(() => null), d = Array.isArray(j) ? j[0] : j;
      const unauth = r.status === 401 || (d && (d.status === 401 || (d.errors || []).some(e => /unauthori[sz]ed/i.test(e.message || ""))));
      return { d, unauth, ok: r.ok };
    };

    // Same query text as the site's mfe-basket-manager GetBasket.
    const GET_BASKET = "\n  query GetBasket {\n    basket {\n      id\n      orderId\n      splitView {\n        __typename\n        id\n        items {\n          __typename\n          id\n          quantity\n          cost\n          unit\n          groupBulkBuyLimitReached\n          bulkBuyLimitReached\n          groupBulkBuyQuantity\n          substitutionOption\n          product {\n            __typename\n            id\n            bulkBuyLimit\n            bulkBuyLimitGroupId\n            groupBulkBuyLimit\n            productType\n            averageWeight\n            tpnb # needed for analytics MFE\n            price {\n              actual\n              unitPrice\n              unitOfMeasure\n            }\n            seller {\n              id\n            }\n          }\n          weight\n        }\n      }\n      items {\n        id\n        product {\n          __typename\n          id\n          seller {\n            id\n          }\n        }\n      }\n    }\n  }\n";
    const UPDATE_BASKET = "\n  mutation UpdateBasket($items: [BasketLineItemInputType], $orderId: ID) {\n    basket(items: $items, orderId: $orderId) {\n      id\n      splitView {\n        __typename\n        id\n        items {\n          __typename\n          id\n          unit\n          weight\n          cost\n          quantity\n          originalQuantity\n          groupBulkBuyLimitReached\n          bulkBuyLimitReached\n          groupBulkBuyQuantity\n          originalWeight\n          product {\n            id\n            seller {\n              id\n            }\n            __typename\n          }\n        }\n      }\n      items {\n        __typename\n        id\n        unit\n        weight\n        cost\n        quantity\n        originalQuantity\n        groupBulkBuyLimitReached\n        bulkBuyLimitReached\n        groupBulkBuyQuantity\n        isNewlyAdded\n        originalWeight\n        product {\n          id\n          seller {\n            id\n          }\n          __typename\n        }\n      }\n      updates {\n        items {\n          id\n          successful\n        }\n      }\n    }\n  }\n";

    const g = await gql("GetBasket", GET_BASKET, {});
    if (g.unauth) return SIGN_IN();
    const basket = g.d && g.d.data && g.d.data.basket;
    if (!basket) return alert("Tesco's trolley didn't load. Wait a moment and tap Forkcast again.");
    const views = Array.isArray(basket.splitView) ? basket.splitView : [basket.splitView].filter(Boolean);
    const have = {};
    views.flatMap(v => v.items || []).forEach(i => {
      const pid = i.product && i.product.id;
      if (pid) have[pid] = { q: i.unit === "kg" ? Infinity : (+i.quantity || 0), seller: i.product.seller && i.product.seller.id };
    });

    // Bulk add in one mutation (the site's "add all from list" path sends the same item shape).
    const items = [];
    want.forEach(w => {
      const h = have[w.id], cur = h ? h.q : 0;
      if (cur >= w.q) return;
      const it = { adjustment: false, id: w.id, newValue: w.q, newUnitChoice: "pcs" };
      if (h) { it.oldValue = cur; it.oldUnitChoice = "pcs"; if (h.seller) it.sellerId = h.seller; }
      items.push(it);
    });
    if (items.length) {
      const u = await gql("UpdateBasket", UPDATE_BASKET, { items, orderId: basket.orderId || basket.id });
      if (u.unauth) return SIGN_IN();
      const ups = (u.d && u.d.data && u.d.data.basket && u.d.data.basket.updates && u.d.data.basket.updates.items) || null;
      if (!ups) return alert("Tesco didn't accept the items. Try again in a minute.");
      const bad = ups.filter(x => !x.successful).length;
      if (bad) alert(`Tesco couldn't add ${bad} of ${items.length} item${items.length > 1 ? "s" : ""} (probably unavailable right now). The rest are in your trolley.`);
    }
    unpark();
    history.replaceState(null, "", location.pathname + location.search);
    location.href = "/groceries/en-GB/trolley";
  } catch (e) {
    alert("Forkcast couldn't fill your Tesco trolley (" + (e && e.message || e) + "). Try again in a minute.");
  }
})();

} },
    { host: "sainsburys.co.uk", tag: "forkcast", run: () => {
// Forkcast → Sainsbury's trolley. Runs ON www.sainsburys.co.uk as a bookmarklet, in the shopper's
// own browser. Reads #forkcast=<encodeURIComponent(product_uid)>:<qty>,… and adds what's missing to
// THIS browser's trolley through the site's own basket API (/groceries-api/gol-services/basket/v2),
// sending the same headers the site's fetch wrapper sends (WCAuthToken from the WC_AUTHENTICATION_*
// cookie, Authorization: Bearer <oidc access_token> from localStorage). Never removes anything,
// never checks out.
//
// Sainsbury's has no guest trolley: a signed-out browser can read its (always empty) basket, but
// POST …/basket/v2/basket/item(s) answers 401 UNAUTHORIZED, and the site sends guests who press
// "Add" to account.sainsburys.co.uk to log in. So the shopper must be logged in.
(async () => {
  try {
    if (location.hostname === "account.sainsburys.co.uk") return alert("Log in to Sainsbury's here first, then open your Forkcast link again and tap Forkcast.");
    if (location.hostname !== "www.sainsburys.co.uk") return alert("Open sainsburys.co.uk first, then tap this again.");
    // The list is parked in localStorage if we have to send the shopper off to log in (the
    // #fragment doesn't survive the login round trip).
    const PARK = "forkcastPending";
    let raw = (/[#&]forkcast=([^&]*)/.exec(location.hash) || [])[1];
    if (!raw) try { const p = JSON.parse(localStorage.getItem(PARK) || "null"); if (p && Date.now() - p.t < 3 * 3600e3) raw = p.raw; } catch (e) {}
    if (!raw) return alert("Open Sainsbury's from your Forkcast shopping list first, then tap this again.");
    const park = () => { try { localStorage.setItem(PARK, JSON.stringify({ raw, t: Date.now() })); } catch (e) {} };
    const unpark = () => { try { localStorage.removeItem(PARK); } catch (e) {} };
    const SIGN_IN = () => { park(); alert("Log in to Sainsbury's first (Sainsbury's only lets logged-in shoppers fill a trolley), then tap Forkcast again."); };

    const want = [];
    raw.split(",").forEach(x => {
      const i = x.lastIndexOf(":"), id = decodeURIComponent(i > 0 ? x.slice(0, i) : x).trim();
      const q = Math.max(1, Math.round(+(i > 0 ? x.slice(i + 1) : 1)) || 1);
      if (id) want.push({ id, q });
    });
    if (!want.length) return alert("The Forkcast list in this link is empty.");

    // Same auth headers as the site's own fetch wrapper.
    let wc = "", wc2 = "", token = "";
    document.cookie.split("; ").forEach(c => {
      const i = c.indexOf("="), k = c.slice(0, i), v = c.slice(i + 1);
      if (k.indexOf("WC_AUTHENTICATION_") === 0 && v !== "DEL") { if (k.endsWith("-1002")) wc2 = v; else wc = v; }
    });
    try {
      const k = Object.keys(localStorage).find(k => k.indexOf("oidc.user:") === 0 && k.endsWith(":gol"));
      const u = k && JSON.parse(localStorage.getItem(k));
      if (u && u.access_token && (!u.expires_at || u.expires_at * 1000 > Date.now())) token = u.access_token;
    } catch (e) {}
    if (!token && !wc && !wc2) return SIGN_IN();
    let wcv = wc || wc2; try { wcv = decodeURIComponent(wcv); } catch (e) {}
    const H = { Accept: "application/json", "Content-Type": "application/json", WCAuthToken: encodeURIComponent(wcv) };
    if (token) H.Authorization = "Bearer " + token;
    const API = "/groceries-api/gol-services";
    const call = (method, path, body) => fetch(API + path, { method, credentials: "include", headers: H, body: body ? JSON.stringify(body) : undefined });

    // Store and pick time exactly as the site derives them (slot reservation, else store 2168 / tomorrow).
    let store = "2168", pick = new Date(Date.now() + 864e5).toISOString().slice(0, 19) + "Z", booked = false;
    try {
      const s = await (await call("GET", "/slot/v1/slot/reservation")).json();
      if (s.store_identifier) store = s.store_identifier;
      if (s.slot && s.slot.start_time) pick = new Date(s.slot.start_time).toISOString().slice(0, 19) + "Z";
      booked = !!(s.reservation_type && s.reservation_type !== "none");
    } catch (e) {}
    const qs = "?pick_time=" + encodeURIComponent(pick) + "&store_number=" + encodeURIComponent(store) + "&slot_booked=" + booked;

    const br = await call("GET", "/basket/v2/basket" + qs);
    if (br.status === 401 || br.status === 403) return SIGN_IN();
    if (!br.ok) return alert("Sainsbury's trolley didn't load (HTTP " + br.status + "). Try again in a minute.");
    const basket = await br.json();
    const have = {};
    (basket.items || []).forEach(i => {
      const p = i.product || {};
      const pid = String(p.sku || p.product_uid || i.product_uid || i.sku || "");
      if (pid) have[pid] = i;
    });

    // uom / catch-weight the way the site's add button computes them.
    const info = async id => {
      try {
        const p = await (await call("GET", "/product/v1/product/" + encodeURIComponent(id))).json();
        const uom = p.product_type === "LOOSE" ? "C62" : ((p.retail_price && p.retail_price.measure) || "ea");
        const cw = (p.catchweight && p.catchweight[0] && (p.catchweight[0].range || "")) || "";
        return { uom, cw };
      } catch (e) { return { uom: "ea", cw: "" }; }
    };

    const add = [], bump = [];
    for (const w of want) {
      const h = have[w.id];
      if (!h) add.push(w);
      else if (!/^(kg|kgm)$/i.test(h.uom || "") && (+h.quantity || 0) < w.q) bump.push({ w, h });
    }
    let failed = 0;
    if (add.length) {
      const body = [];
      for (const w of add) { const { uom, cw } = await info(w.id); body.push({ product_uid: w.id, quantity: w.q, uom, selected_catchweight: cw }); }
      body.sort((a, b) => (a.uom === "C62") - (b.uom === "C62"));
      const r = await call("POST", "/basket/v2/basket/items" + qs, body);
      if (r.status === 401 || r.status === 403) return SIGN_IN();
      if (!r.ok) {
        // Fall back to one at a time so one unavailable product doesn't sink the rest.
        for (const it of body) {
          const r1 = await call("POST", "/basket/v2/basket/item" + qs, it);
          if (r1.status === 401 || r1.status === 403) return SIGN_IN();
          if (!r1.ok) failed++;
        }
      }
    }
    for (const { w, h } of bump) {
      const r = await call("PUT", "/basket/v2/basket" + qs, { items: [{ product_uid: w.id, item_uid: h.item_uid, quantity: w.q,
        uom: h.uom || "ea", selected_catchweight: h.selected_catchweight || "", decreasing_quantity: false }] });
      if (r.status === 401 || r.status === 403) return SIGN_IN();
      if (!r.ok) failed++;
    }
    if (failed) alert(`Sainsbury's couldn't add ${failed} item${failed > 1 ? "s" : ""} (probably unavailable right now). The rest are in your trolley.`);
    unpark();
    history.replaceState(null, "", location.pathname + location.search);
    location.href = "/gol-ui/trolley";
  } catch (e) {
    alert("Forkcast couldn't fill your Sainsbury's trolley (" + (e && e.message || e) + "). Try again in a minute.");
  }
})();

} },
    { host: "asda.com", tag: "forkcast", run: () => {
// Forkcast bookmarklet for Asda (www.asda.com/groceries). Runs ON asda.com in the shopper's own browser.
// Reads #forkcast=<CIN>:<qty>,… and adds only the shortfall to the shopper's Asda trolley through the
// same Salesforce Commerce API the site's own "Add" button uses (via asda.com's /mobify/proxy/ghs-api).
// Asda only keeps a trolley for signed-in shoppers (a guest's "Add" goes to the sign-in page), so a
// guest gets a "sign in first" message. Never removes anything, never touches slots or checkout.
(async () => {
  const say = m => alert(m);
  try {
    const m = /[#&]forkcast=([^&]*)/.exec(location.hash);
    if (!m || !m[1]) return say("Open Asda from your Forkcast list first, then tap this again.");
    if (!/(^|\.)asda\.com$/.test(location.hostname)) return say("Open www.asda.com/groceries first, then tap this again.");
    const want = {};
    m[1].split(",").forEach(x => { const k = x.lastIndexOf(":"); const id = decodeURIComponent(k > 0 ? x.slice(0, k) : x).trim();
      const q = k > 0 ? parseInt(x.slice(k + 1), 10) : 1; if (id) want[id] = (want[id] || 0) + (q > 0 ? q : 1); });
    const ids = Object.keys(want);
    if (!ids.length) return say("Your Forkcast list looks empty.");

    // The site's own token manager hands the page its current shopper (SLAS) access token.
    const tr = await fetch("/api/ghs/token-manager/get-tokens?key=SLAS.AUTH_TOKEN", { credentials: "include", headers: { "Cache-Control": "no-store", Pragma: "no-store" } });
    const bearer = tr.ok ? (await tr.json())[0] : null;
    if (!bearer) return say("Asda isn't ready yet. Wait for the page to load, then tap again.");
    const jwt = JSON.parse(atob(bearer.split(" ").pop().split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    if (/upn:Guest/i.test(jwt.isb || "") || !/(^|::)rcid:/.test(jwt.isb || "")) return say("Sign in to Asda first, then tap again.");
    const cid = (/(?:^|::)rcid:([^:]+)/.exec(jwt.isb) || [])[1];

    const API = "/mobify/proxy/ghs-api", ORG = "f_ecom_bjgs_prd", SITE = "siteId=ASDA_GROCERIES";
    let sid = null; try { sid = sessionStorage.getItem("apiSessionId"); } catch (e) {}
    const H = () => ({ Authorization: bearer, "Content-Type": "application/json", "X-ApiSession-Id": sid || (sid = crypto.randomUUID()), "correlation-id": crypto.randomUUID() });
    const call = async (method, path, body) => {
      const r = await fetch(API + path, { method, headers: H(), credentials: "include", body: body && JSON.stringify(body) });
      let j = {}; try { j = await r.json(); } catch (e) {}
      if (r.status === 401) throw { signin: true };
      if (!r.ok) throw new Error((j && (j.detail || j.title)) || "HTTP " + r.status);
      return j;
    };

    // The shopper's current basket (the one the trolley page shows), or a new one if they have none.
    const list = await call("GET", `/customer/shopper-customers/v1/organizations/${ORG}/customers/${cid}/baskets?${SITE}`);
    let basket = (list.baskets || [])[0];
    if (!basket) basket = await call("POST", `/checkout/shopper-baskets/v1/organizations/${ORG}/baskets?${SITE}`, {});
    const have = {};
    (basket.productItems || []).forEach(i => { have[i.productId] = (have[i.productId] || 0) + (+i.quantity || 0); });
    const add = ids.map(id => ({ productId: id, quantity: want[id] - (have[id] || 0) })).filter(x => x.quantity > 0);
    if (add.length) {
      // POST …/items adds to any existing line for that product (SFCC default), so send only the shortfall.
      const res = await call("POST", `/checkout/shopper-baskets/v1/organizations/${ORG}/baskets/${basket.basketId}/items?${SITE}`, add);
      const got = {}; (res.productItems || []).forEach(i => { got[i.productId] = (got[i.productId] || 0) + (+i.quantity || 0); });
      const missing = add.filter(a => !got[a.productId]).length;
      if (missing) say(missing + " item(s) couldn't be added (maybe unavailable at your store). The rest are in your trolley.");
    }
    history.replaceState(null, "", location.pathname + location.search);
    location.href = "/groceries/trolley";
  } catch (e) {
    if (e && e.signin) return say("Sign in to Asda first, then tap again.");
    say("Forkcast couldn't fill your Asda trolley: " + (e && e.message || e));
  }
})();

} },
    { host: "morrisons.com", tag: "forkcast", run: () => {
// Runs ON groceries.morrisons.com (same platform as Ocado), in whatever browser you're using (bookmarklet). Replaces that browser's Morrisons
// trolley with the Forkcast basket carried in the link: #forkcast=<id>:<qty>,…  (ids without dashes).
// After you confirm, everything else in the trolley is taken out and each product is set to exactly
// the list's quantity, in one request. Running it twice is harmless.
(async () => {
  const TAG = "forkcast";
  const h = new URLSearchParams(location.hash.slice(1)).get(TAG);
  if (!h) return alert("Open Morrisons from the Forkcast comparison page first, then tap this again.");
  const uuid = s => s.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
  const want = {};
  h.split(",").map(x => x.split(":")).forEach(([i, q]) => { if (i) want[uuid(decodeURIComponent(i).replace(/-/g, ""))] = +q || 1; });
  const html = await (await fetch("/", { headers: { Accept: "text/html" }, credentials: "include" })).text();
  const tok = (/"csrf":\{"token":"([^"]+)"/.exec(html) || [])[1];
  if (!tok) return alert("Morrisons isn't ready yet. Wait a moment and tap again.");
  const cart = await (await fetch("/api/cart/v1/carts/active?cartProductSorting=CATEGORIES", { headers: { Accept: "application/json" }, credentials: "include" })).json();
  const have = {};
  (Array.isArray(cart.items) ? cart.items : Object.values(cart.items || {})).forEach(i => have[i.productId] = i.quantity);
  const total = Object.values(want).reduce((a, q) => a + q, 0);
  const extra = Object.keys(have).filter(id => !(id in want)).length;
  if (extra && !confirm(`Replace your Morrisons trolley with the ${TAG === "plates" ? "Plates" : "Forkcast"} list (${total} packs)?\n\n${extra} other item${extra === 1 ? "" : "s"} in the trolley will be taken out.`)) return;
  const ops = [];
  for (const id of new Set([...Object.keys(want), ...Object.keys(have)])) {
    const d = (want[id] || 0) - (have[id] || 0);
    if (d) ops.push({ productId: id, quantity: d });
  }
  if (ops.length) {
    const r = await fetch("/api/cart/v1/carts/active/apply-quantity?cartProductSorting=CATEGORIES", { method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json; charset=utf-8", "x-csrf-token": tok }, body: JSON.stringify(ops) });
    if (!r.ok) return alert("Morrisons didn't accept the items (HTTP " + r.status + "). Try again in a minute.");
  }
  history.replaceState(null, "", "/basket");
  location.href = "/basket";
})();

} },
    { host: "waitrose.com", tag: "forkcast", run: () => {
// Runs ON waitrose.com (bookmarklet). Fills this browser's Waitrose trolley with the Forkcast list
// carried in the link: #forkcast=<productId>:<qty>,…  (productId like "019706-9575-9576").
// Waitrose has no guest trolley: the shopper must be signed in. Uses the site's own front-end calls:
//   GET  /api/token-client-prod/v1/csrf?clientType=WEB_APP      → {headerName, token}
//   POST /api/token-client-prod/v1/token?clientType=WEB_APP     (csrf header) → {accessToken}; 401 = signed out
//   POST /api/graphql-prod/graph/live  shoppingContext          → customerOrderId
//   POST /api/graphql-prod/graph/live  getTrolley(orderId)      → current items
//   POST /api/graphql-prod/graph/live  updateTrolleyItems(...)  → absolute quantities; new lines use
//        trolleyItemId = -lineNumber, exactly as the site does when it replays a pre-sign-in trolley.
// Only raises quantities to what the list needs; never lowers or removes anything; never checks out.
(async () => {
  const h = (/[#&]forkcast=([^&]*)/.exec(location.hash) || [])[1];
  if (!h) return alert("Open Waitrose from your Forkcast shopping list first, then tap this again.");
  const want = {};
  h.split(",").filter(Boolean).forEach(x => { const i = x.lastIndexOf(":"), id = decodeURIComponent(i > 0 ? x.slice(0, i) : x);
    want[id] = Math.max(want[id] || 0, Math.round(+(i > 0 ? x.slice(i + 1) : 1)) || 1); });
  try {
    const c = await (await fetch("/api/token-client-prod/v1/csrf?clientType=WEB_APP", { credentials: "include" })).json();
    const t = await fetch("/api/token-client-prod/v1/token?clientType=WEB_APP", { method: "POST", credentials: "include", headers: { [c.headerName]: c.token } });
    if (t.status === 401 || t.status === 403) {
      alert("Waitrose only lets signed-in shoppers fill a trolley. Sign in to Waitrose, then come back to the Forkcast link and tap this again.");
      return;
    }
    if (!t.ok) throw new Error("token HTTP " + t.status);
    const auth = "Bearer " + (await t.json()).accessToken;
    const g = async (query, variables) => {
      const r = await fetch("/api/graphql-prod/graph/live?clientType=WEB_APP", { method: "POST", credentials: "include",
        headers: { "content-type": "application/json", accept: "application/json", authorization: auth }, body: JSON.stringify({ query, variables }) });
      const j = await r.json(); if (j.errors && !j.data) throw new Error(j.errors[0].message); return j.data;
    };
    const orderId = (await g("query { shoppingContext { customerOrderId } }", {})).shoppingContext.customerOrderId;
    if (!orderId || orderId === "0") throw new Error("no order");
    const gt = (await g(`query($orderId: ID!) { getTrolley(orderId: $orderId) { trolley { trolleyItems {
      trolleyItemId productId lineNumber canSubstitute noteToShopper quantity { amount uom } } } failures { message type } } }`, { orderId })).getTrolley;
    const have = {}; ((gt.trolley && gt.trolley.trolleyItems) || []).forEach(i => { have[i.lineNumber] = i; });
    const items = [];
    for (const id in want) {
      const line = id.split("-")[0], cur = have[line];
      if (!cur) items.push({ trolleyItemId: -parseInt(line, 10), lineNumber: line, productId: id, canSubstitute: true,
        noteToShopper: null, quantity: { amount: want[id], uom: "C62" } });
      else if (cur.quantity.uom === "C62" && cur.quantity.amount < want[id])
        items.push({ trolleyItemId: cur.trolleyItemId, lineNumber: line, productId: cur.productId, canSubstitute: cur.canSubstitute,
          noteToShopper: cur.noteToShopper, quantity: { amount: want[id], uom: "C62" } });
    }
    if (items.length) {
      const u = (await g(`mutation($orderId: ID!, $trolleyItems: [TrolleyItemInput]) { updateTrolleyItems(orderId: $orderId, trolleyItems: $trolleyItems) {
        failures { message type } } }`, { orderId, trolleyItems: items })).updateTrolleyItems;
      if (u && u.failures && u.failures.length) {
        alert("Waitrose didn't accept some items (" + u.failures.map(f => f.message).join("; ").slice(0, 200) + "). Check your trolley.");
      }
    }
  } catch (e) {
    alert("Couldn't fill the Waitrose trolley (" + (e && e.message || e) + "). Make sure you're signed in, wait a moment and tap again.");
    return;
  }
  history.replaceState(null, "", location.pathname + location.search);
  location.href = "/ecom/trolley";
})();

} },
    { host: "iceland.co.uk", tag: "forkcast", run: () => {
// Runs ON iceland.co.uk (bookmarklet). Fills this browser's Iceland basket with the Forkcast list
// carried in the link: #forkcast=<productId>:<qty>,…  (productId like "61796").
// Iceland only lets a signed-in shopper with a delivery address add to the basket (a guest who taps
// "Add" is sent to /login, and a guest session has no basket). Uses the site's own basket call:
//   POST /mobify/proxy/ocapi/on/demandware.store/Sites-icelandfoodsuk-Site/default/Basket-updateBasketItemQuantity
//        body []                               → current basket (basket.productItems[{productId,quantity}])
//        body [{productId, quantity}, …]       → sets ABSOLUTE quantities (the site sends quantity 0 to remove)
// Only raises quantities to what the list needs; never lowers or removes anything; never checks out.
(async () => {
  const h = (/[#&]forkcast=([^&]*)/.exec(location.hash) || [])[1];
  if (!h) return alert("Open Iceland from your Forkcast shopping list first, then tap this again.");
  const want = {};
  h.split(",").filter(Boolean).forEach(x => { const i = x.lastIndexOf(":"), id = decodeURIComponent(i > 0 ? x.slice(0, i) : x);
    want[id] = Math.max(want[id] || 0, Math.round(+(i > 0 ? x.slice(i + 1) : 1)) || 1); });
  const URL_ = "/mobify/proxy/ocapi/on/demandware.store/Sites-icelandfoodsuk-Site/default/Basket-updateBasketItemQuantity";
  const post = async body => {
    const r = await fetch(URL_, { method: "POST", credentials: "include", headers: { "content-type": "text/plain;charset=UTF-8" }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  };
  try {
    const cur = await post([]);
    if (!cur.basket || !cur.basket.basketId) {
      alert("Iceland only lets signed-in shoppers fill a basket. Sign in to Iceland (and choose your delivery address), then come back to the Forkcast link and tap this again.");
      return;
    }
    const have = {}; (cur.basket.productItems || []).forEach(i => { have[i.productId] = (have[i.productId] || 0) + (+i.quantity || 0); });
    const add = Object.keys(want).filter(id => want[id] > (have[id] || 0)).map(id => ({ productId: id, quantity: want[id] }));
    if (add.length) {
      const r = await post(add);
      const failed = r.failed || [];
      if (failed.length) {
        const why = [...new Set(failed.map(f => f.msg))].join("; ");
        if (/current basket/i.test(why) && !(r.basket && r.basket.basketId))
          return alert("Iceland didn't accept the items. Sign in and choose your delivery address, then tap this again.");
        alert(failed.length + " item(s) couldn't be added at Iceland (" + why.slice(0, 160) + "). The rest are in your basket.");
      } else if (!r.success) throw new Error("not accepted");
    }
  } catch (e) {
    alert("Couldn't fill the Iceland basket (" + (e && e.message || e) + "). Wait a moment and tap again.");
    return;
  }
  history.replaceState(null, "", location.pathname + location.search);
  location.href = "/basket";
})();

} },
    { host: "aldi.co.uk", tag: "forkcast", run: () => {
// Runs ON aldi.co.uk (bookmarklet). Aldi UK no longer sells groceries online, so there is no trolley
// to fill. Instead this turns the Forkcast list in the link (#forkcast=<sku>:<qty>,…) into an in-store
// checklist overlay: grouped by section of the shop (Fresh, Chilled, Frozen, …), with current prices,
// an estimated total, tick boxes (remembered on this device), Print and Copy buttons.
// Product details come from the same API the Aldi site uses:
//   GET https://asl.api.aldi.co.uk/commerce/v2/products/<sku>?serviceType=walk-in&servicePoint=C091
// Read-only: nothing is added, bought or sent anywhere.
(async () => {
  const h = (/[#&]forkcast=([^&]*)/.exec(location.hash) || [])[1];
  if (!h) return alert("Open Aldi from your Forkcast shopping list first, then tap this again.");
  const want = [], seen = {};
  h.split(",").filter(Boolean).forEach(x => { const i = x.lastIndexOf(":"), id = decodeURIComponent(i > 0 ? x.slice(0, i) : x);
    const q = Math.round(+(i > 0 ? x.slice(i + 1) : 1)) || 1;
    if (seen[id]) seen[id].q = Math.max(seen[id].q, q); else want.push(seen[id] = { id, q }); });
  const old = document.getElementById("forkcast-aldi"); if (old) old.remove();

  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const title = s => (s || "").toLowerCase().replace(/(^|[\s&\-(/])([a-zà-ÿ])/g, (m, a, c) => a + c.toUpperCase()).replace(/'S\b/g, "'s");
  const get = async w => {
    try {
      const r = await fetch(`https://asl.api.aldi.co.uk/commerce/v2/products/${encodeURIComponent(w.id)}?serviceType=walk-in&servicePoint=C091`, { headers: { accept: "application/json" } });
      const d = r.ok ? (await r.json()).data : null;
      if (!d) return { ...w, name: "Product " + w.id, section: "Other", missing: true };
      const brand = title(d.brandName), price = ((d.price && (d.price.amountRelevant != null ? d.price.amountRelevant : d.price.amount)) || 0) / 100;
      return { ...w, name: (brand && !d.name.toLowerCase().startsWith(brand.toLowerCase()) ? brand + " " : "") + d.name,
        size: d.sellingSize || (d.price && d.price.perUnitDisplay) || "", price,
        section: (d.categories && d.categories[0] && d.categories[0].name) || "Other", gone: d.discontinued };
    } catch (e) { return { ...w, name: "Product " + w.id, section: "Other", missing: true }; }
  };
  const items = [];
  for (let i = 0; i < want.length; i += 4) items.push(...await Promise.all(want.slice(i, i + 4).map(get)));

  const order = ["Fresh Food", "Bakery", "Chilled Food", "Food Cupboard", "Frozen Food", "Drinks", "Alcohol", "Household", "Health & Beauty", "Baby & Toddler", "Pet Care", "Other"];
  const groups = {};
  items.forEach(it => (groups[it.section] = groups[it.section] || []).push(it));
  const secs = Object.keys(groups).sort((a, b) => ((order.indexOf(a) + 1) || 99) - ((order.indexOf(b) + 1) || 99));
  const total = items.reduce((t, it) => t + (it.price || 0) * it.q, 0);
  const key = "forkcast-aldi-ticks:" + h.slice(0, 500);
  let ticks = {}; try { ticks = JSON.parse(localStorage.getItem(key) || "{}"); } catch (e) {}

  const css = `#forkcast-aldi{position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.45);overflow:auto;font:15px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;color:#1a1a1a}
#forkcast-aldi .fc-card{background:#fff;max-width:640px;margin:24px auto;padding:20px 20px 12px;border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,.3)}
#forkcast-aldi h2{margin:0 0 4px;font-size:20px;color:#00005f}#forkcast-aldi .fc-note{margin:0 0 12px;color:#555;font-size:13px}
#forkcast-aldi h3{margin:14px 0 4px;font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:#00005f;border-bottom:2px solid #00005f}
#forkcast-aldi label{display:flex;gap:10px;align-items:flex-start;padding:7px 2px;border-bottom:1px solid #eee;cursor:pointer}
#forkcast-aldi input{width:20px;height:20px;margin:1px 0 0;flex:none}#forkcast-aldi .fc-n{flex:1}#forkcast-aldi .fc-s{color:#777;font-size:12px}
#forkcast-aldi .fc-p{white-space:nowrap;font-variant-numeric:tabular-nums}#forkcast-aldi label.fc-done .fc-n{text-decoration:line-through;color:#999}
#forkcast-aldi .fc-tot{display:flex;justify-content:space-between;font-weight:600;padding:10px 2px}
#forkcast-aldi .fc-bar{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px}#forkcast-aldi button{font:inherit;padding:8px 14px;border-radius:8px;border:1px solid #00005f;background:#fff;color:#00005f;cursor:pointer}
#forkcast-aldi button.fc-main{background:#00005f;color:#fff}
@media print{body>*:not(#forkcast-aldi){display:none!important}#forkcast-aldi{position:static;background:none;overflow:visible}#forkcast-aldi .fc-card{box-shadow:none;margin:0;max-width:none}#forkcast-aldi .fc-bar{display:none}}`;
  const row = it => `<label data-id="${esc(it.id)}"${ticks[it.id] ? ' class="fc-done"' : ""}><input type="checkbox"${ticks[it.id] ? " checked" : ""}>
    <span class="fc-n">${it.q} × ${esc(it.name)}<br><span class="fc-s">${esc(it.size)}${it.missing ? " · details unavailable" : ""}${it.gone ? " · may no longer be stocked" : ""}</span></span>
    <span class="fc-p">${it.price ? "£" + (it.price * it.q).toFixed(2) : ""}</span></label>`;
  const box = document.createElement("div");
  box.id = "forkcast-aldi";
  box.innerHTML = `<style>${css}</style><div class="fc-card" role="dialog" aria-label="Aldi shopping list">
    <h2>Your Aldi shopping list</h2>
    <p class="fc-note">Aldi UK doesn't deliver groceries online, so take this list to your local store. Prices are Aldi's current in-store prices and can vary slightly by store.</p>
    ${secs.map(s => `<h3>${esc(s)}</h3>` + groups[s].map(row).join("")).join("")}
    <div class="fc-tot"><span>${items.reduce((n, it) => n + it.q, 0)} items · estimated total</span><span>£${total.toFixed(2)}</span></div>
    <div class="fc-bar"><button class="fc-main" data-a="print">Print</button><button data-a="copy">Copy as text</button><button data-a="close">Close</button></div></div>`;
  document.body.appendChild(box);
  box.addEventListener("change", e => {
    const l = e.target.closest("label"); if (!l) return;
    ticks[l.dataset.id] = e.target.checked; l.classList.toggle("fc-done", e.target.checked);
    try { localStorage.setItem(key, JSON.stringify(ticks)); } catch (e2) {}
  });
  box.addEventListener("click", async e => {
    const a = e.target.dataset && e.target.dataset.a;
    if (e.target === box || a === "close") box.remove();
    else if (a === "print") window.print();
    else if (a === "copy") {
      const txt = "Aldi shopping list\n" + secs.map(s => "\n" + s.toUpperCase() + "\n" + groups[s].map(it => `[ ] ${it.q} x ${it.name}${it.size ? " (" + it.size + ")" : ""}${it.price ? "  £" + (it.price * it.q).toFixed(2) : ""}`).join("\n")).join("\n") + `\n\nEstimated total £${total.toFixed(2)}`;
      try { await navigator.clipboard.writeText(txt); e.target.textContent = "Copied"; } catch (e2) { prompt("Copy your list:", txt); }
    }
  });
})();

} },
    { host: "ocado.com", tag: "plates", run: () => {
// Runs ON ocado.com, in whatever browser you're using (bookmarklet). Replaces that browser's Ocado
// trolley with the Plates basket carried in the link: #plates=<id>:<qty>,…  (ids without dashes).
// After you confirm, everything else in the trolley is taken out and each product is set to exactly
// the list's quantity, in one request. Running it twice is harmless.
(async () => {
  const TAG = "plates";
  const h = new URLSearchParams(location.hash.slice(1)).get(TAG);
  if (!h) return alert("Open Ocado from the Plates basket page first, then tap this again.");
  const uuid = s => s.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
  const want = {};
  h.split(",").map(x => x.split(":")).forEach(([i, q]) => { if (i) want[uuid(decodeURIComponent(i).replace(/-/g, ""))] = +q || 1; });
  const html = await (await fetch("/", { headers: { Accept: "text/html" }, credentials: "include" })).text();
  const tok = (/"csrf":\{"token":"([^"]+)"/.exec(html) || [])[1];
  if (!tok) return alert("Ocado isn't ready yet. Wait a moment and tap again.");
  const cart = await (await fetch("/api/cart/v1/carts/active?cartProductSorting=CATEGORIES", { headers: { Accept: "application/json" }, credentials: "include" })).json();
  const have = {};
  (Array.isArray(cart.items) ? cart.items : Object.values(cart.items || {})).forEach(i => have[i.productId] = i.quantity);
  const total = Object.values(want).reduce((a, q) => a + q, 0);
  const extra = Object.keys(have).filter(id => !(id in want)).length;
  if (extra && !confirm(`Replace your Ocado trolley with the ${TAG === "plates" ? "Plates" : "Forkcast"} list (${total} packs)?\n\n${extra} other item${extra === 1 ? "" : "s"} in the trolley will be taken out.`)) return;
  const ops = [];
  for (const id of new Set([...Object.keys(want), ...Object.keys(have)])) {
    const d = (want[id] || 0) - (have[id] || 0);
    if (d) ops.push({ productId: id, quantity: d });
  }
  if (ops.length) {
    const r = await fetch("/api/cart/v1/carts/active/apply-quantity?cartProductSorting=CATEGORIES", { method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json; charset=utf-8", "x-csrf-token": tok }, body: JSON.stringify(ops) });
    if (!r.ok) return alert("Ocado didn't accept the items (HTTP " + r.status + "). Try again in a minute.");
  }
  history.replaceState(null, "", "/basket");
  location.href = "/basket";
})();

} }
  ];
  const mine = FILLS.filter(f => here === f.host || here.endsWith("." + f.host));
  if (!mine.length) return;
  // some shops' sites break on a # link, so Forkcast sends ?forkcast= there; move it to the # for the fill
  (function () { const m = /[?&](forkcast|plates)=([^&]*)/.exec(location.search);
    if (m && !new RegExp("[#&]" + m[1] + "=").test(location.hash)) history.replaceState(null, "", location.pathname + (location.search.replace(m[0], "").replace(/^&/, "?") || "") + "#" + m[1] + "=" + m[2]); })();
  const KEY = "forkcast-helper-pending", now = Date.now();
  let pending = null; try { pending = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) {}
  if (pending && now - pending.t > 30 * 60e3) pending = null;
  const fromLink = mine.find(f => new RegExp("[#&]" + f.tag + "=").test(location.hash));
  let fill = fromLink, quiet = false;
  if (fromLink) {
    pending = { tag: fromLink.tag, hash: location.hash, t: now, tries: 0 };
  } else if (pending && !/login|sign-?in|account\/auth|logon/i.test(location.href)) {
    // back from signing in: put the list back in the link and try again, without repeating the alert
    fill = mine.find(f => f.tag === pending.tag);
    if (!fill || pending.tries >= 4) { try { localStorage.removeItem(KEY); } catch (e) {} return; }
    history.replaceState(null, "", location.pathname + location.search + pending.hash);
    pending.tries++; quiet = true;
  }
  if (!fill) return;
  // keep the list parked only if the shop says it needs you to sign in
  try { localStorage.removeItem(KEY); } catch (e) {}
  const realAlert = window.alert.bind(window);
  window.alert = msg => {
    if (/sign ?in|log ?in/i.test(String(msg))) { try { localStorage.setItem(KEY, JSON.stringify(pending)); } catch (e) {} if (!quiet) realAlert(String(msg) + "\n\nForkcast will fill your trolley as soon as you're signed in."); return; }
    realAlert(msg);
  };
  setTimeout(() => { window.alert = realAlert; }, 120e3);
  // let the shop's own page finish starting up (some read tokens it sets on load)
  setTimeout(() => { try { fill.run(); } catch (e) { realAlert("Forkcast couldn't fill the trolley: " + e.message); } }, 1500);
})();
