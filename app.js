// Forkcast: tastes → a week of meals → shopping list → compare every UK supermarket → fill the
// chosen trolley in your own browser → cook. State lives in this browser (localStorage "forkcast").
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const money = n => "£" + (+n || 0).toFixed(2);

let S = { step: 0, answers: {}, seed: 1, keep: {}, plan: null, list: null, nutrition: null, job: null, pick: null, swaps: {} };
try { S = { ...S, ...JSON.parse(localStorage.getItem("forkcast") || "{}") }; } catch {}
const save = () => { try { if (typeof logWeek === "function" && C) logWeek(); localStorage.setItem("forkcast", JSON.stringify(S)); } catch {} };
let C = null, RECIPES = {}, OPEN = null, BOOKMARK = null, POLL = null;

// On the Mac mini the server plans and searches live. The public site (GitHub Pages) has no server:
// it plans in the page with the same engine and prices from the daily snapshot in data/prices/.
const STATIC = !!window.FORKCAST_STATIC;
const PRICES = {}, LOCALJOBS = {};
async function getJSON(u) { const r = await fetch(u, { cache: "no-cache" }); if (!r.ok) throw new Error(r.statusText); return r.json(); }
async function localApi(path, body) {
  if (path === "/api/content") return getJSON("data/content.json");
  if (path === "/api/plan") { const pl = E.plan(C.recipes, body.prefs, body.seed || 1, body.keep || {}); return { plan: pl, list: E.list(pl, C.recipes, C.ingredients, body.prefs), nutrition: E.nutrition(pl, C.recipes, body.prefs) }; }
  if (path === "/api/list") { const pl = E.setPortions(body.plan, C.recipes, body.prefs); return { plan: pl, list: E.list(pl, C.recipes, C.ingredients, body.prefs), nutrition: E.nutrition(pl, C.recipes, body.prefs) }; }
  if (path === "/api/compare") {
    const shops = await getJSON("data/retailers.json"), todo = body.list.filter(l => !l.skip), job = { id: "local" + Date.now(), total: todo.length, retailers: {}, finished: Date.now() };
    await Promise.all(shops.map(async r => {
      const px = PRICES[r.id] || (PRICES[r.id] = await getJSON(`data/prices/${r.id}.json`).catch(() => ({ items: {} })));
      const results = {}; for (const l of todo) results[l.item] = px.items[l.item] || [];
      job.retailers[r.id] = { id: r.id, name: r.name, inStoreOnly: r.inStoreOnly, canFill: r.canFill, trolleyUrl: r.trolleyUrl, fillStatus: r.fillStatus,
        pricedAt: px.at, done: todo.length, state: "done", ...E.basket(body.list, results, C.ingredients, body.prefs, k => px.items[k]) };
    }));
    return (LOCALJOBS[job.id] = job);
  }
  if (path.startsWith("/api/compare/")) return LOCALJOBS[path.split("/").pop()] || S.job;
  throw new Error("not available on the public site");
}
async function api(path, body) {
  if (STATIC) return localApi(path, body);
  const r = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  return r.json();
}

// ---------------------------------------------------------------- answers → prefs
function prefs() {
  const a = S.answers, q = id => a[id] ?? (C.questionnaire.find(x => x.id === id) || {}).default;
  return {
    adults: +q("adults") || 2, children: +q("children") || 0, meals: S.meals || PRESETS["weeknight-weekend"],
    diet: q("diet") || "none", mustBe: q("mustBe") || [], allergies: q("allergies") || [], cuisines: q("cuisines") || {}, proteins: q("proteins") || {},
    spice: q("spice") ?? 2, weeknightTime: +q("weeknightTime") || 45, confidence: +q("confidence") || 2, kit: q("kit") || [], goal: q("goal") || "balanced",
    budget: +q("budget") || 0, style: q("style") || "auto", loyalty: q("loyalty") === true || q("loyalty") === "yes", variety: q("variety") || "variety",
    avoid: (q("avoid") || []).map(s => String(s).toLowerCase()), pantryHave: S.pantryHave || [], pantryAll: S.pantryAll ?? true,
    targets: S.targets || {}, scalePortions: S.scalePortions ?? true, cupboard: cupActive(),
    favourites: S.favs || [], ratings: S.ratings || {}, recent: recentMeals(),
  };
}

// ---------------------------------------------------------------- calendar weeks and the log
// Each plan belongs to a Monday–Sunday week, keyed by its Monday (YYYY-MM-DD). Everything about a
// week (plan, list, shop chosen, total) is logged in S.weeks as it changes, so you can look back.
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dateOf = k => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (k, n) => { const d = dateOf(k); d.setDate(d.getDate() + n); return ymd(d); };
function mondayOf(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return ymd(x); }
// planning on Mon/Tue = this week; from Wednesday on, you're shopping for next week
const defaultWeek = () => { const t = new Date(); return [1, 2].includes(t.getDay()) ? mondayOf(t) : addDays(mondayOf(t), 7); };
const fmtD = (k, o) => dateOf(k).toLocaleDateString("en-GB", o);
const weekLabel = k => `${fmtD(k, { weekday: "short", day: "numeric" })} – ${fmtD(addDays(k, 6), { weekday: "short", day: "numeric", month: "short" })}`;
const weekNo = k => { const d = dateOf(addDays(k, 3)), y = new Date(d.getFullYear(), 0, 4); return 1 + Math.round(((d - y) / 864e5 - 3 + ((y.getDay() + 6) % 7)) / 7); };   // ISO week
if (!S.week) S.week = defaultWeek();
if (!S.weeks) S.weeks = {};
function logWeek() {
  if (!S.plan) return;
  const r = S.pick && S.job?.retailers?.[S.pick], v = r && r.state === "done" ? shopView(r) : null;
  S.weeks[S.week] = { ...(S.weeks[S.week] || {}), plan: S.plan, meals: S.meals, list: S.list, nutrition: S.nutrition, keep: S.keep,
    shop: r ? r.name : (S.weeks[S.week] || {}).shop, total: v ? +v.fair.toFixed(2) : (S.weeks[S.week] || {}).total, updated: Date.now() };
}
// recipes eaten in the two weeks before the one being planned
function recentMeals() {
  const ids = new Set();
  for (const k of [addDays(S.week, -7), addDays(S.week, -14)]) (S.weeks[k]?.plan?.days || []).forEach(d => MEALS.forEach(m => d[m] && ids.add(d[m])));
  return [...ids];
}
// open a logged week (or start an empty one)
function openWeek(k) {
  logWeek();
  S.week = k; const w = S.weeks[k];
  S.plan = w?.plan || null; S.list = w?.list || null; S.nutrition = w?.nutrition || null; S.keep = w?.keep || {}; if (w?.meals) S.meals = w.meals;
  S.job = null; S.pick = null; S.swaps = {}; S.step = S.plan ? 1 : 0; save(); render(); scrollTo(0, 0);
}
async function planNextWeek() {
  logWeek();
  const next = addDays(S.week, 7);
  if (S.weeks[next]?.plan) return openWeek(next);
  S.week = next; S.plan = S.list = S.job = S.pick = null; S.keep = {}; S.swaps = {};
  await buildWeek({}, (S.seed || 1) + 101);
}
function weekBar() {
  const has = k => !!S.weeks[k]?.plan;
  return `<div class="weekbar"><button class="ico" aria-label="Previous week" onclick="openWeek(addDays(S.week,-7))">‹</button>
    <span><span class="wk-k">Week ${weekNo(S.week)}</span><b>${weekLabel(S.week)}</b>${S.week === mondayOf(new Date()) ? ` <span class="badge">this week</span>` : S.week === addDays(mondayOf(new Date()), 7) ? ` <span class="badge">next week</span>` : ""}</span>
    <button class="ico" aria-label="Next week" onclick="openWeek(addDays(S.week,7))">›</button>${has(addDays(S.week, -7)) || has(addDays(S.week, 7)) ? "" : ""}</div>`;
}
function historyHTML() {
  const ks = Object.keys(S.weeks || {}).filter(k => S.weeks[k]?.plan).sort().reverse();
  if (!ks.length) return "";
  const rows = ks.map(k => { const w = S.weeks[k], n = w.plan.days.reduce((a, d) => a + MEALS.filter(m => d[m]).length, 0);
    const dinners = w.plan.days.map(d => RECIPES[d.dinner]?.name).filter(Boolean);
    return `<button class="histrow ${k === S.week ? "on" : ""}" onclick="openWeek('${k}')"><span class="wk-k">Wk ${weekNo(k)}</span><span><b>${weekLabel(k)}</b><span class="sub">${n} meals · ${esc(dinners.slice(0, 3).join(", "))}${dinners.length > 3 ? "…" : ""}</span></span><span class="amt">${w.total ? money(w.total) : ""}<span class="sub">${esc(w.shop || "")}</span></span></button>`; }).join("");
  return fold("Your weeks", `${ks.length} logged · newest first`, `<div class="hist">${rows}</div>`, false);
}

// Desktop: wide layouts (two columns, the week as seven columns, the order panel beside the shops)
const WIDEQ = matchMedia("(min-width: 1100px)");
let WIDE = WIDEQ.matches;
WIDEQ.addEventListener?.("change", e => { WIDE = e.matches; render(); });
const cols = (main, side) => `<div class="cols"><div class="col-main">${main}</div><div class="col-side">${side}</div></div>`;

// ---------------------------------------------------------------- render
// Four steps: Tastes → Plan (week + list) → Shop (ranked shops, order inline) → Cook.
function go(n) { if (n > maxStep()) return; S.step = n; OPEN = null; save(); render(); scrollTo(0, 0); }
const maxStep = () => !S.plan ? 0 : !S.job ? 1 : 3;
function render() {
  if (S.step > 3) S.step = 3;
  document.querySelectorAll("#steps button").forEach(b => { const n = +b.dataset.s;
    b.classList.toggle("on", n === S.step); b.disabled = n > maxStep();
    if (n === S.step) b.setAttribute("aria-current", "step"); else b.removeAttribute("aria-current"); });
  if (!C) { $("#view").innerHTML = `<p class="dim" style="margin-top:40px">Loading…</p>`; return; }
  $("#view").innerHTML = `<div class="glow"></div>` + [tastes, week, shop, recipes][S.step]();
}
document.querySelectorAll("#steps button").forEach(b => b.onclick = () => go(+b.dataset.s));
const head = (kicker, title, em, lede) => `<p class="kicker">${kicker}</p><h1>${title}${em ? `<em>${em}</em>` : ""}</h1>${lede ? `<p class="lede">${lede}</p>` : ""}`;
const panel = (title, meta, body) => `<section class="panel">${title ? `<div class="panel-h"><h2>${title}</h2>${meta ? `<span class="meta">${meta}</span>` : ""}</div>` : ""}${body}</section>`;
const fold = (title, meta, body, open) => `<details class="fold" ${open ? "open" : ""}><summary>${title}${meta ? ` <span class="meta">${meta}</span>` : ""}</summary><div class="in">${body}</div></details>`;
const nextBar = (note, label, action, dis) => `<div class="next"><div class="in"><span class="note">${note}</span>${label ? `<button class="go big" ${dis ? "disabled" : ""} onclick="${action}">${label}</button>` : ""}</div></div>`;
const sec = (t, meta = "") => `<div class="panel-h" style="margin-top:22px"><h2>${t}</h2>${meta ? `<span class="meta">${meta}</span>` : ""}</div>`;

// ---------------------------------------------------------------- 1. tastes
function setA(id, v) { S.answers[id] = v; save(); }
function toggleA(id, v) { const cur = new Set(S.answers[id] ?? (C.questionnaire.find(x => x.id === id).default || [])); cur.has(v) ? cur.delete(v) : cur.add(v); setA(id, [...cur]); render(); }
function gridA(id, row, v) { const cur = { ...(S.answers[id] || C.questionnaire.find(x => x.id === id).default || {}) }; cur[row] = v; setA(id, cur); render(); }
function val(q) { return S.answers[q.id] ?? q.default; }
function question(q) {
  const v = val(q), o = q.options || [];
  let body = "";
  const same = (a, b) => String(a) === String(b);
  if (q.type === "single") body = `<div class="chips">${o.map(x => `<button class="chip" aria-pressed="${same(v, x.value)}" onclick='setA(${JSON.stringify(q.id)},${JSON.stringify(x.value)});render()'>${esc(x.label)}</button>`).join("")}</div>`;
  else if (q.type === "multi" || q.type === "chips") body = `<div class="chips">${o.map(x => `<button class="chip" aria-pressed="${(v || []).map(String).includes(String(x.value))}" onclick='toggleA(${JSON.stringify(q.id)},${JSON.stringify(x.value)})'>${esc(x.label)}</button>`).join("")}</div>`;
  else if (q.type === "number") body = `<div class="row"><input type="number" inputmode="decimal" min="${q.min ?? 0}" max="${q.max ?? 999}" step="${q.step ?? 1}" value="${esc(v ?? "")}" aria-label="${esc(q.title)}" onchange='setA(${JSON.stringify(q.id)},this.value===""?null:Number(this.value))'>${q.unit ? `<span class="dim small">${esc(q.unit)}</span>` : ""}</div>`;
  else if (q.type === "scale") { const lo = q.min ?? 0, hi = q.max ?? 3, labels = q.labels || o.map(x => x.label);
    body = `<div class="scale"><input type="range" min="${lo}" max="${hi}" step="1" value="${v ?? lo}" aria-label="${esc(q.title)}" oninput='setA(${JSON.stringify(q.id)},Number(this.value));this.nextElementSibling.textContent=${JSON.stringify(labels)}[this.value-${lo}]||this.value'><span class="small" style="min-width:120px">${esc(labels[(v ?? lo) - lo] ?? v)}</span></div>`; }
  else if (q.type === "grid") { const opts = o.length ? o : [{ value: "love", label: "Love" }, { value: "fine", label: "Fine" }, { value: "no", label: "No" }];
    body = `<div class="gridq">${(q.rows || []).map(r => { const rv = (v || {})[r.value] ?? "fine";
      return `<span>${esc(r.label)}${r.count ? ` <span class="small dim num">${r.count}</span>` : ""}</span><span class="seg">${opts.map(x => `<button class="${x.value === "no" ? "no" : ""}" aria-pressed="${rv === x.value}" onclick='gridA(${JSON.stringify(q.id)},${JSON.stringify(r.value)},${JSON.stringify(x.value)})'>${esc(x.label)}</button>`).join("")}</span>`; }).join("")}</div>`; }
  return `<div class="q"><h3>${esc(q.title)}</h3>${q.help ? `<p class="help">${esc(q.help)}</p>` : ""}${body}</div>`;
}
// Which meals to plan: a day × meal grid. Tap a cell to cycle it: off → cook → (lunch only) leftovers.
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], MEALS = ["breakfast", "lunch", "dinner"];
const WK = d => d === "Sat" || d === "Sun";
const PRESETS = {
  "weeknight-weekend": ["Weeknight dinners + full weekend", d => WK(d) ? { breakfast: "cook", lunch: "cook", dinner: "cook" } : { dinner: "cook" }],
  "work-lunches": ["…plus leftovers for work lunches", d => WK(d) ? { breakfast: "cook", lunch: "cook", dinner: "cook" } : { lunch: "leftovers", dinner: "cook" }],
  "dinners": ["Dinners only", () => ({ dinner: "cook" })],
  "everything": ["Every meal", () => ({ breakfast: "cook", lunch: "cook", dinner: "cook" })],
};
for (const k in PRESETS) PRESETS[k] = Object.assign(Object.fromEntries(DAYS.map(d => [d, PRESETS[k][1](d)])), { label: PRESETS[k][0] });
const sameMeals = (a, b) => DAYS.every(d => MEALS.every(m => (a[d]?.[m] || "") === (b[d]?.[m] || "")));
function mealCell(d, m) {
  const cur = (S.meals || PRESETS["weeknight-weekend"])[d]?.[m] || "";
  const next = cur === "" ? "cook" : cur === "cook" && m === "lunch" ? "leftovers" : "";
  const meals = JSON.parse(JSON.stringify(S.meals || PRESETS["weeknight-weekend"]));
  meals[d] = { ...(meals[d] || {}) }; next ? meals[d][m] = next : delete meals[d][m];
  delete meals.label; S.meals = meals; save(); render();
}
function mealsHTML() {
  const M = S.meals || PRESETS["weeknight-weekend"];
  const n = { cook: 0, leftovers: 0 };
  DAYS.forEach(d => MEALS.forEach(m => { const v = M[d]?.[m]; if (v) n[v]++; }));
  return `<div class="chips">${Object.entries(PRESETS).map(([k, v]) => `<button class="chip" aria-pressed="${sameMeals(M, v)}" onclick="S.meals=JSON.parse(JSON.stringify(PRESETS['${k}']));delete S.meals.label;save();render()">${esc(v.label)}</button>`).join("")}</div>
    <div class="mealgrid" role="grid" aria-label="Meals to plan"><span></span>${DAYS.map(d => `<span class="mg-d ${WK(d) ? "wk" : ""}">${d}</span>`).join("")}
    ${MEALS.map(m => `<span class="mg-m">${m[0].toUpperCase() + m.slice(1)}</span>${DAYS.map(d => { const v = M[d]?.[m] || "";
      return `<button class="mg-c ${v}" aria-pressed="${!!v}" aria-label="${d} ${m}: ${v || "off"}" onclick="mealCell('${d}','${m}')">${v === "cook" ? "✓" : v === "leftovers" ? "↺" : ""}</button>`; }).join("")}`).join("")}</div>
    <p class="small dim" style="margin:10px 0 0"><b class="num" style="color:var(--ink-1)">${n.cook}</b> meals to cook${n.leftovers ? ` + ${n.leftovers} leftover lunches` : ""}. Tap to switch; tap a lunch twice for ↺ leftovers from the night before.</p>`;
}
// The hard rules (diet, must-be, allergies) decide which recipes are possible at all; the later
// questions then only offer choices that still exist among those, with how many meals each has.
function possible(skip) {
  const p = prefs(), d = p.diet;
  return C.recipes.filter(r => {
    if (d === "vegan" && !r.diet.includes("vegan")) return false;
    if (d === "vegetarian" && !(r.diet.includes("vegetarian") || r.diet.includes("vegan"))) return false;
    if (d === "pescatarian" && !(r.diet.includes("pescatarian") || r.diet.includes("vegetarian") || r.diet.includes("vegan"))) return false;
    if ((p.mustBe || []).some(m => !r.diet.includes(m))) return false;
    if ((p.allergies || []).some(a => r.allergens.includes(a))) return false;
    if (skip !== "cuisines" && p.cuisines[r.cuisine] === "no") return false;
    if (skip !== "proteins" && p.proteins[r.protein] === "no") return false;
    if (skip !== "spice" && r.spice > (p.spice ?? 3)) return false;
    return true;
  });
}
function refine(q) {
  if (q.id === "proteins" || q.id === "cuisines") {
    const key = q.id === "proteins" ? "protein" : "cuisine", pool = possible(q.id), n = {};
    pool.forEach(r => n[r[key]] = (n[r[key]] || 0) + 1);
    return { ...q, rows: (q.rows || []).filter(r => n[r.value]).map(r => ({ ...r, label: r.label, count: n[r.value] })) };
  }
  if (q.id === "avoid") {
    const pool = possible(), names = pool.map(r => r.name.toLowerCase() + " " + r.ingredients.map(i => i.item).join(" "));
    return { ...q, options: (q.options || []).filter(o => names.some(t => t.includes(String(o.value).toLowerCase().replace(/s$/, "")))) };
  }
  return q;
}
// ---------------------------------------------------------------- favourites, ratings, saved weeks
const isFav = id => (S.favs || []).includes(id);
function toggleFav(id) { const f = new Set(S.favs || []); f.has(id) ? f.delete(id) : f.add(id); S.favs = [...f]; save(); render(); }
function rate(id, n) { S.ratings = { ...(S.ratings || {}), [id]: (S.ratings || {})[id] === n ? undefined : n }; if (!S.ratings[id]) delete S.ratings[id]; save(); render(); }
const heart = id => `<button class="ico fav" aria-pressed="${isFav(id)}" aria-label="${isFav(id) ? "Remove from" : "Add to"} favourites" title="Favourite" onclick="toggleFav('${id}')">${isFav(id) ? "♥" : "♡"}</button>`;
const starsHTML = id => { const v = (S.ratings || {})[id] || 0;
  return `<span class="stars" role="group" aria-label="Rate it">${[1, 2, 3, 4, 5].map(n => `<button class="star ${n <= v ? "on" : ""}" aria-label="${n} star${n > 1 ? "s" : ""}${n === 1 ? " (never again)" : ""}" onclick="rate('${id}',${n})">★</button>`).join("")}</span>`; };
// Ranking: stars first, then favourite, then how many saved weeks it appears in
function ranked() {
  const seen = {}; (S.saved || []).forEach(w => w.plan.days.forEach(d => MEALS.forEach(m => { if (d[m] && !(m === "lunch" && d.lunchLeftovers)) seen[d[m]] = (seen[d[m]] || 0) + 1; })));
  const ids = new Set([...(S.favs || []), ...Object.keys(S.ratings || {}).filter(k => S.ratings[k] >= 4), ...Object.keys(seen)]);
  return [...ids].filter(id => RECIPES[id] && (S.ratings || {})[id] !== 1)
    .map(id => ({ id, r: RECIPES[id], score: ((S.ratings || {})[id] || 3) * 2 + (isFav(id) ? 3 : 0) + (seen[id] || 0), seen: seen[id] || 0 }))
    .sort((a, b) => b.score - a.score);
}
function saveWeek() {
  const name = prompt("Name this week so you can use it again:", `Week of ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`);
  if (!name) return;
  S.saved = [{ name: name.slice(0, 60), at: Date.now(), plan: S.plan, meals: S.meals, used: 0 }, ...(S.saved || [])].slice(0, 30); save(); render();
}
async function useWeek(i) {
  const w = S.saved[i]; w.used = (w.used || 0) + 1; w.lastUsed = Date.now();
  S.meals = w.meals || S.meals; S.plan = JSON.parse(JSON.stringify(w.plan));
  const keep = {}; S.plan.days.forEach(d => MEALS.forEach(m => { if (d[m] && !(m === "lunch" && d.lunchLeftovers)) keep[`${d.day}.${m}`] = d[m]; }));
  S.keep = keep;
  const r = await api("/api/list", { plan: S.plan, prefs: prefs() });
  S.plan = r.plan || S.plan; S.list = r.list; S.nutrition = r.nutrition; S.job = null; S.pick = null; S.swaps = {}; S.step = 1; save(); render(); scrollTo(0, 0);
}
function delWeek(i) { if (confirm(`Delete "${S.saved[i].name}"?`)) { S.saved.splice(i, 1); save(); render(); } }
function favouritesHTML() {
  const saved = [...(S.saved || [])].map((w, i) => ({ w, i })).sort((a, b) => (b.w.used || 0) - (a.w.used || 0) || b.w.at - a.w.at), top = ranked();
  if (!saved.length && !top.length) return "";
  let h = "";
  if (saved.length) h += panel("Use a saved week", "most used first", `<div class="pills">${saved.map(({ w, i }) => `<button class="pill" onclick="useWeek(${i})"><b>${esc(w.name)}</b><span>${w.plan.days.map(d => RECIPES[d.dinner]?.name).filter(Boolean).slice(0, 2).map(esc).join(", ")}…${w.used ? ` · used ${w.used}×` : ""}</span></button>`).join("")}</div>
    <p class="small dim" style="margin:8px 0 0">Manage: ${saved.map(({ w, i }) => `<button class="link" onclick="delWeek(${i})">delete ${esc(w.name)}</button>`).join(" · ")}</p>`);
  if (top.length) h += fold("Your favourites", `${top.length} · they come up more often`, top.slice(0, 20).map(x => `<div class="li"><span style="flex:1">${esc(x.r.name)}<br><span class="small dim">${x.r.meal} · ${x.r.time} min${x.seen ? ` · in ${x.seen} saved week${x.seen > 1 ? "s" : ""}` : ""}</span></span>${starsHTML(x.id)}${heart(x.id)}</div>`).join(""));
  return h;
}
const ESSENTIAL = ["adults", "children", "diet", "mustBe", "allergies"];

// ---------------------------------------------------------------- calorie and macro targets
// Per person per day. The planner picks meals that fit each one's share of the day and (unless
// turned off) sizes the portions to land on the calories; the shopping list follows the portions.
const TARGETS = [["kcal", "Calories", "kcal", 50], ["protein_g", "Protein", "g", 5], ["carbs_g", "Carbs", "g", 5], ["fat_g", "Fat", "g", 5]];
// share of the calories from protein, carbs and fat (4, 4 and 9 kcal a gram)
const SPLITS = { balanced: ["Balanced", .3, .4, .3], "high-protein": ["High protein", .4, .3, .3], "lower-carb": ["Lower carb", .35, .2, .45] };
function targetsHTML() {
  const t = S.targets || {};
  return panel("Calories & macros", "optional · per person, per day", `<div class="inline-q targets">${TARGETS.map(([k, l, u, st]) => `<label>${l} <input type="number" inputmode="numeric" min="0" step="${st}" value="${t[k] || ""}" placeholder="–" onchange="setTarget('${k}',this.value)"><span class="dim small">${u}</span></label>`).join("")}</div>
    ${t.kcal ? `<div class="chips" style="margin-top:12px"><span class="small dim" style="align-self:center">Macros from your calories:</span>${Object.entries(SPLITS).map(([k, [l]]) => `<button class="chip" onclick="splitMacros('${k}')">${l}</button>`).join("")}</div>` : ""}
    <label class="row small" style="margin-top:12px"><input type="checkbox" ${S.scalePortions ?? true ? "checked" : ""} onchange="S.scalePortions=this.checked;save();S.plan?relist():render()"> Size the portions to hit the calories (the shopping list follows)</label>
    <p class="small dim" style="margin:8px 0 0">Breakfast aims at a quarter of the day, lunch about a third and dinner the rest; meals you don't plan are left for you.</p>`);
}
function setTarget(k, v) { const t = { ...(S.targets || {}) }; +v > 0 ? t[k] = Math.round(+v) : delete t[k]; S.targets = t; save(); S.plan ? relist() : render(); }
function splitMacros(k) { const [, p, c, f] = SPLITS[k], kcal = S.targets.kcal;
  S.targets = { kcal, protein_g: Math.round(kcal * p / 4), carbs_g: Math.round(kcal * c / 4), fat_g: Math.round(kcal * f / 9) }; save(); S.plan ? relist() : render(); }

// ---------------------------------------------------------------- the cupboard
// What's already in, so it isn't bought again: { item: { qty, unit, name, until } }. No qty means
// plenty; a qty comes off what the week needs. Long-life things stay until they run out or the amount
// is used up; fresh things you say you have count for that week only (until its Sunday).
const cupActive = () => Object.fromEntries(Object.entries(S.cupboard || {}).filter(([, c]) => !c.until || c.until >= S.week));
const keepsLong = item => { const c = C.ingredients[item]; return !!c && (!c.perishable || (c.shelfDays || 0) >= 30); };
const cupEntry = k => { const c = C.ingredients[k] || {}; return { unit: c.unit, name: c.name || k, since: Date.now(), ...(keepsLong(k) ? {} : { until: addDays(S.week, 6) }) }; };
function setCupboard(cup) { S.cupboard = cup; save(); S.plan ? relist() : render(); }
function toggleHave(item) { const cup = { ...(S.cupboard || {}) }; cupActive()[item] ? delete cup[item] : cup[item] = cupEntry(item); setCupboard(cup); }
function addCup(name) {
  const k = Object.keys(C.ingredients).find(k => C.ingredients[k].name.toLowerCase() === String(name).trim().toLowerCase());
  if (k) setCupboard({ ...(S.cupboard || {}), [k]: cupEntry(k) });
}
function setCup(k, v) { const c = { ...S.cupboard[k] }; v === "" ? delete c.qty : c.qty = Math.max(0, +v); setCupboard({ ...S.cupboard, [k]: c }); }
function ranOut(k) { const cup = { ...(S.cupboard || {}) }; delete cup[k]; setCupboard(cup); }
function cupboardHTML() {
  const cup = cupActive(), ks = Object.keys(cup).sort((a, b) => (cup[a].name || a).localeCompare(cup[b].name || b));
  const opts = Object.keys(C.ingredients).filter(k => !cup[k]).map(k => C.ingredients[k].name).sort().map(n => `<option value="${esc(n)}">`).join("");
  const rows = ks.map(k => { const c = cup[k], u = c.unit || C.ingredients[k]?.unit;
    return `<div class="li cup"><span style="flex:1">${esc(c.name || k)}${c.until ? ` <span class="small dim">· this week</span>` : ""}</span>
      <input type="number" inputmode="numeric" min="0" step="${u === "each" ? 1 : 10}" value="${c.qty ?? ""}" placeholder="plenty" aria-label="How much ${esc(c.name || k)}" onchange="setCup('${esc(k)}',this.value)"><span class="small dim u">${u === "each" ? "×" : esc(u || "")}</span>
      <button class="tiny" onclick="ranOut('${esc(k)}')">Ran out</button></div>`; }).join("");
  return fold("Your cupboard", ks.length ? `${ks.length} item${ks.length > 1 ? "s" : ""} · not bought again` : "what you've already got",
    `<p class="small dim" style="margin:0 0 8px">Anything here comes off the shopping list. Leave the amount blank for plenty. When you order, Forkcast adds what's left of long-life packs (rice, pasta, tins) so it isn't bought again.</p>${rows}
    <div class="row" style="margin-top:10px"><input list="cup-ings" placeholder="Add something you've got…" aria-label="Add something you've got" style="flex:1" onchange="addCup(this.value)"><datalist id="cup-ings">${opts}</datalist></div>`, ks.length > 0 && WIDE);
}
// After ordering: take this week's cooking out of the cupboard and put the long-life spare in
function markOrdered(id) {
  const r = S.job.retailers[id], v = shopView(r), before = cupActive();
  S.cupboard = E.restock(Object.fromEntries(Object.entries(S.cupboard || {}).filter(([, c]) => !c.until || c.until >= S.week)), S.list, v.lines, C.ingredients);
  const kept = Object.keys(S.cupboard).filter(k => !before[k] || (S.cupboard[k].qty ?? 0) > (before[k].qty ?? 0)).length;
  S.weeks[S.week] = { ...(S.weeks[S.week] || {}), ordered: { at: Date.now(), shop: r.name, kept } };
  save(); render();
}
function tastes() {
  const Q = id => C.questionnaire.find(q => q.id === id), rest = C.questionnaire.filter(q => ![...ESSENTIAL, "dinners", "lunches", "meals"].includes(q.id));
  const p = prefs();
  const who = `<div class="inline-q"><label>Adults <input type="number" min="1" max="8" value="${p.adults}" onchange="setA('adults',Number(this.value)||1);render()"></label>
    <label>Children <input type="number" min="0" max="8" value="${p.children}" onchange="setA('children',Number(this.value)||0);render()"></label></div>`;
  return head("Your week, planned and priced", "What do you", "fancy?", "Tell us how you eat. Forkcast plans the week, works out the shopping, and finds the best supermarket for it.")
    + weekBar()
    + (WIDE
      ? cols(panel("Meals", "", mealsHTML()) + fold("More about what you like", "optional · cuisines, spice, time, budget…", rest.map(q => question(refine(q))).join(""), true),
          whoPanel(who, Q) + targetsHTML() + cupboardHTML() + historyHTML() + favouritesHTML())
      : panel("Meals", "", mealsHTML()) + whoPanel(who, Q) + targetsHTML() + cupboardHTML()
        + fold("More about what you like", "optional · cuisines, spice, time, budget…", rest.map(q => question(refine(q))).join(""))
        + historyHTML() + favouritesHTML())
    + nextBar(matchLine(), S.plan ? "Re-plan my week" : "Plan my week", "buildWeek()");
}
const whoPanel = (who, Q) => panel("Who's eating", "", who + `<div class="q" style="margin-top:20px">${questionBody(Q("diet"))}</div>` + [Q("mustBe"), Q("allergies")].filter(Boolean).map(q => question(q)).join(""));
// a question without its own heading (for diet, which sits under "Who's eating")
function questionBody(q) { return question(q).replace(/^<div class="q">/, "").replace(/<\/div>$/, ""); }
function matchLine() {
  const pool = possible(), by = m => pool.filter(r => r.meal === m).length;
  const need = { breakfast: 0, lunch: 0, dinner: 0 }, M = S.meals || PRESETS["weeknight-weekend"];
  DAYS.forEach(d => MEALS.forEach(m => { if (M[d]?.[m] === "cook") need[m]++; }));
  const short = MEALS.filter(m => need[m] && by(m) < need[m]);
  return `<b>${by("dinner")}</b> dinners, <b>${by("lunch")}</b> lunches and <b>${by("breakfast")}</b> breakfasts suit you${short.length ? ` <span class="miss">· too few ${short.join("/")} for no repeats</span>` : ""}`;
}
async function buildWeek(keep = {}, seed) {
  S.seed = seed ?? (S.seed || 1); S.keep = keep;
  const r = await api("/api/plan", { prefs: prefs(), seed: S.seed, keep });
  S.plan = r.plan; S.list = r.list; S.nutrition = r.nutrition; S.job = null; S.pick = null; S.swaps = {}; S.step = 1; save(); render(); scrollTo(0, 0);
}

// ---------------------------------------------------------------- 2. plan (week + list)
function week() {
  const p = prefs(), n = S.nutrition?.perDay || {}, keep = S.keep || {};
  const days = S.plan.days.map(d => `<div class="day"><span class="d">${d.day}<span class="dt">${fmtD(addDays(S.week, DAYS.indexOf(d.day)), { day: "numeric", month: "short" })}</span></span><div>${MEALS.filter(m => d[m]).map(m => { const r = RECIPES[d[m]]; if (!r) return "";
      const k = `${d.day}.${m}`, left = m === "lunch" && d.lunchLeftovers, pin = keep[k] === d[m], f = d.portion?.[m] || 1;
      const size = f === 1 ? "" : ` · ${f > 1 ? "bigger" : "smaller"} portion (${f}×)`;
      return `<div class="meal"><span class="t"><span class="mt">${m}${left ? " · leftovers" : ""}</span><span class="n">${esc(r.name)}</span><span class="m">${left ? `from last night · ${Math.round(r.kcal * f)} kcal` : `${r.time} min · ${Math.round(r.kcal * f)} kcal`}${size}</span></span>
        ${left ? "" : `${heart(d[m])}<button class="ico" aria-pressed="${pin}" title="${pin ? "Kept" : "Keep this one"}" aria-label="Keep" onclick="pinMeal('${k}','${d[m]}')">${pin ? "●" : "○"}</button><button class="ico" title="Swap for something else" aria-label="Swap" onclick="swapMeal('${k}')">↻</button>`}</div>`; }).join("")}</div></div>`).join("");
  const L = S.list || [], buy = L.filter(l => !l.skip), cup = cupActive(), fromCup = L.filter(l => l.have > 0).length;
  let aisle = "";
  const listBody = `<label class="row small" style="margin-bottom:6px"><input type="checkbox" ${S.pantryAll ?? true ? "checked" : ""} onchange="S.pantryAll=this.checked;relist()"> I already have the store-cupboard basics (oil, salt, spices)</label>`
    + L.map(l => { const a = l.aisle !== aisle ? `<div class="aisle">${esc((aisle = l.aisle).replace(/-/g, " "))}</div>` : "";
      // store-cupboard basics keep their own switch; anything else goes in (or out of) your cupboard
      const act = l.pantry && !cup[l.item] ? "togglePantry" : "toggleHave", part = l.have > 0 && !l.skip ? `<span class="small dim"> · have ${fmtQty(l.have, l.unit)}</span>` : "";
      return a + `<div class="li ${l.skip ? "skip-it" : ""}"><span class="qty num">${fmtQty(l.skip ? l.need ?? l.qty : l.qty, l.unit)}</span><span style="flex:1">${esc(l.name)}${part}</span><button class="tiny" onclick="${act}('${esc(l.item)}')" aria-label="${l.skip ? "Need" : "Have"} ${esc(l.name)}">${l.skip ? "Need it" : "Have it"}</button></div>`; }).join("");
  return head("Step 2", "Your", "week.", "") + weekBar()
    + panel("", "", `<div class="row wrap" style="justify-content:space-between;margin-bottom:14px"><span class="small dim">${p.adults} adult${p.adults > 1 ? "s" : ""}${p.children ? ` + ${p.children} child${p.children > 1 ? "ren" : ""}` : ""} · ● keep · ↻ swap · ♡ favourite</span>
        <span class="row" style="gap:6px"><button class="tiny" onclick="reshuffle()">Reshuffle</button><button class="tiny" onclick="saveWeek()">Save week</button></span></div><div class="weekgrid">` + days + `</div>`)
    + (S.targets && Object.keys(S.targets).length ? targetDaysHTML(S.nutrition) : "")
    + `<div class="pair">` + panel("", "", `<div class="nutri"><span><b>${n.kcal ?? "–"}</b>kcal</span><span><b>${n.protein_g ?? "–"}</b>g protein</span><span><b>${n.carbs_g ?? "–"}</b>g carbs</span><span><b>${n.fibre_g ?? "–"}</b>g fibre</span><span><b>${n.salt_g ?? "–"}</b>g salt</span></div><p class="small dim" style="margin:8px 0 0">Per person per day from these meals, averaged over the week.</p>`)
    + fold("Shopping list", `${buy.length} items${fromCup ? ` · ${fromCup} from your cupboard` : ""}`, `<div class="listcols">${listBody}</div>`, WIDE) + `</div>`
    + nextBar(`<b>${buy.length}</b> items to buy`, "Find the best shop", "startCompare()", !buy.length);
}
// Each day against its targets: the share of the day for the meals planned (dinner only: 40%)
function targetDaysHTML(N) {
  const T = S.targets || {}, ks = [["kcal", "Calories", ""], ["protein_g", "Protein", "g"], ["carbs_g", "Carbs", "g"], ["fat_g", "Fat", "g"]].filter(([k]) => T[k] > 0);
  const days = (N?.days || []).filter(d => d.share > 0);
  if (!ks.length || !days.length) return "";
  const cell = (d, k, u) => { const t = d.target?.[k], v = d[k], off = t ? Math.abs(v / t - 1) : 0;
    return `<td class="${!t ? "" : off <= .1 ? "ok" : off <= .2 ? "near" : "off"}"><b class="num">${v.toLocaleString("en-GB")}${u}</b><span class="dim">of ${(t || 0).toLocaleString("en-GB")}${u}</span></td>`; };
  const onKcal = T.kcal ? days.filter(d => d.target?.kcal && Math.abs(d.kcal / d.target.kcal - 1) <= .1).length : null;
  // the recipes can only do so much: say plainly what's short on average, and how to top it up
  const short = ks.filter(([k]) => k !== "kcal").map(([k, l]) => { const t = days.reduce((a, d) => a + (d.target?.[k] || 0), 0), v = days.reduce((a, d) => a + d[k], 0);
    return t && v / t < .85 ? `${l.toLowerCase()} by about ${Math.round((t - v) / days.length)} g a day` : ""; }).filter(Boolean);
  const tip = short.length ? `<p class="notice">These meals fall short on ${short.join(" and ")}.${short.some(x => x.startsWith("protein")) ? " A high-protein snack (Greek yoghurt, eggs, a shake) closes the gap, or pick the high-protein goal under More about what you like." : ""}</p>` : "";
  return panel("Your targets", onKcal == null ? "per person" : `${onKcal} of ${days.length} days within 10% on calories`,
    `<div class="tgt-wrap"><table class="tgt"><thead><tr><th>Day</th>${ks.map(([, l]) => `<th>${l}</th>`).join("")}</tr></thead><tbody>${days.map(d =>
      `<tr><th>${d.day}${d.share < 1 ? `<span class="dim">${Math.round(d.share * 100)}% of day</span>` : ""}</th>${ks.map(([k, , u]) => cell(d, k, u)).join("")}</tr>`).join("")}</tbody></table></div>
    ${tip}<p class="small dim" style="margin:8px 0 0">Per person, for the meals planned each day (a % shows the share of the day they cover). <span class="tg-key ok">within 10%</span> <span class="tg-key near">within 20%</span> <span class="tg-key off">further out</span></p>`);
}
function pinMeal(k, id) { const kp = { ...(S.keep || {}) }; kp[k] === id ? delete kp[k] : kp[k] = id; S.keep = kp; save(); render(); }
function reshuffle() { buildWeek(S.keep || {}, (S.seed || 1) + 1); }
// swap one meal: hold every other meal where it is for this one rebuild, then restore the real pins
function swapMeal(k) {
  const hold = {}; S.plan.days.forEach(d => MEALS.forEach(m => { if (d[m] && !(m === "lunch" && d.lunchLeftovers) && `${d.day}.${m}` !== k) hold[`${d.day}.${m}`] = d[m]; }));
  const pins = { ...(S.keep || {}) }; delete pins[k];
  buildWeek(hold, (S.seed || 1) * 31 + k.length + Math.floor(Math.random() * 1000)).then(() => { S.keep = pins; save(); render(); });
}

const fmtQty = (q, u) => u === "each" ? `${q} ×` : u === "g" && q >= 1000 ? `${(q / 1000).toFixed(q % 1000 ? 1 : 0)} kg` : u === "ml" && q >= 1000 ? `${(q / 1000).toFixed(1)} L` : `${q} ${u}`;
function togglePantry(item) { const have = new Set(S.pantryHave || []); const l = S.list.find(x => x.item === item);
  if (S.pantryAll ?? true) { S.pantryAll = false; S.list.filter(x => x.pantry && x.skip).forEach(x => have.add(x.item)); }
  l.skip ? have.delete(item) : have.add(item); S.pantryHave = [...have]; relist(); }
async function relist() { const r = await api("/api/list", { plan: S.plan, prefs: prefs() }); S.plan = r.plan || S.plan; S.list = r.list; S.nutrition = r.nutrition; S.job = null; S.pick = null; save(); render(); }

// ---------------------------------------------------------------- 3. shop
async function startCompare() {
  const r = await api("/api/compare", { list: S.list, prefs: prefs() });
  S.job = r; S.pick = null; S.swaps = {}; S.step = 2; save(); render(); scrollTo(0, 0); poll();
}
function poll() {
  clearTimeout(POLL);
  if (!S.job || S.job.finished) return;
  POLL = setTimeout(async () => {
    try { S.job = await api("/api/compare/" + S.job.id); save(); if (S.step === 2) render(); } catch { S.job.finished = Date.now(); }
    poll();
  }, 2000);
}
// A shop's total with its chosen swaps, plus a fair estimate for anything it didn't stock (the
// middle price of that item elsewhere), so a shop missing half the list can't look cheapest.
function shopView(r) {
  const lines = (r.lines || []).map(l => { const k = S.swaps[r.id]?.[l.item]; return k != null && l.alts?.[k] ? { ...l, ...l.alts[k], alts: l.alts, swapped: k } : l; });
  let total = 0, q = 0, n = 0;
  for (const l of lines) if (!l.missing) { total += l.cost; q += l.q; n++; }
  const shops = Object.values(S.job.retailers).filter(x => x.state === "done");
  let est = 0;
  for (const l of lines.filter(l => l.missing)) {
    const others = shops.map(s => (s.lines || []).find(x => x.item === l.item && !x.missing)?.cost).filter(x => x != null).sort((a, b) => a - b);
    if (others.length) est += others[Math.floor(others.length / 2)];
  }
  return { lines, total, fair: total + est, est, quality: n ? q / n : 0, matched: n, missing: lines.length - n };
}
const qualityLabel = q => q >= 2.9 ? "premium" : q >= 2.3 ? "good" : q >= 1.7 ? "standard" : "basic";
function shop() {
  const p = prefs(), J = S.job; if (!J) return week();
  const all = Object.values(J.retailers), done = all.filter(r => r.state === "done" && r.matched), waiting = all.filter(r => r.state !== "done");
  const V = Object.fromEntries(done.map(r => [r.id, shopView(r)]));
  const ranked = [...done].sort((a, b) => V[a.id].fair - V[b.id].fair);
  const bestQ = [...done].sort((a, b) => V[b.id].quality - V[a.id].quality)[0];
  const bestValue = [...done].filter(r => !r.inStoreOnly).sort((a, b) => V[a.id].fair / Math.pow(V[a.id].quality, 1.1) - V[b.id].fair / Math.pow(V[b.id].quality, 1.1))[0];
  const when = ranked[0]?.pricedAt ? new Date(ranked[0].pricedAt).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "just now";
  let rows = ranked.map((r, i) => {
    const v = V[r.id], open = S.pick === r.id;
    const badges = [r === bestValue && "Best value", r === bestQ && "Best quality"].filter(Boolean).map(b => `<span class="badge ${b === "Best quality" ? "q" : ""}">${b}</span>`).join("");
    const sub = [r.inStoreOnly && "in store only", v.missing ? `${v.missing} items not stocked, estimated` : "everything on your list", qualityLabel(v.quality) + " quality"].filter(Boolean).join(" · ");
    if (WIDE) return `<button class="shoprow ${open ? "on" : ""}" aria-expanded="${open}" onclick="S.pick=S.pick==='${r.id}'?null:'${r.id}';OPEN=null;save();render()"><span class="rk">${i + 1}</span><span><span class="nm">${esc(r.name)}</span>${badges}<span class="sub">${sub}</span></span><span class="tot">${money(v.fair)}</span><span class="chev side"></span></button>`;
    return `<button class="shoprow ${open ? "on" : ""}" aria-expanded="${open}" onclick="S.pick=S.pick==='${r.id}'?null:'${r.id}';OPEN=null;save();render()"><span class="rk">${i + 1}</span><span><span class="nm">${esc(r.name)}</span>${badges}<span class="sub">${sub}</span></span><span class="tot">${money(v.fair)}</span><span class="chev"></span></button>`
      + (open ? orderPanel(r, v) : "");
  }).join("");
  rows += waiting.map(r => `<div class="shoprow"><span class="rk">·</span><span><span class="nm">${esc(r.name)}</span><span class="sub">checking prices… ${r.done}/${J.total}</span></span><span></span><span></span></div>`).join("");
  return head(`Step 3 · week ${weekNo(S.week)}`, "Where to", "shop.", `Your list priced at each supermarket (${STATIC ? "prices from " + when : "live prices"}). Pick one to fill its basket.`)
    + `<div class="row wrap" style="gap:12px"><label class="row">Choose products <select onchange="setA('style',this.value);startCompare()">${Object.entries(C.styles).map(([k, l]) => `<option value="${k}" ${p.style === k ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>
      <label class="row"><input type="checkbox" ${p.loyalty ? "checked" : ""} onchange="setA('loyalty',this.checked);startCompare()"> Loyalty card prices</label>${p.budget ? `<span class="small dim">Budget <b class="num" style="color:var(--ink-1)">${money(p.budget)}</b></span>` : ""}</div>`
    + (WIDE ? cols(`<div class="shops">${rows}</div>`, S.pick && V[S.pick] ? `<div class="sticky"><div class="shops"><div class="side-h"><span class="nm">${esc(J.retailers[S.pick].name)}</span><span class="tot">${money(V[S.pick].fair)}</span></div>${orderPanel(J.retailers[S.pick], V[S.pick])}</div></div>` : `<div class="panel dim">Pick a supermarket to see how to order from it.</div>`)
      : `<div class="shops">${rows}</div>`)
    + (ranked.length > 1 ? heatmap(ranked, V) : "")
    + `<p class="small dim">Totals count whole packs. Items a shop doesn't stock are estimated from the other shops so the comparison is fair.</p>`
    + nextBar(S.pick ? `Ordering from <b>${esc(J.retailers[S.pick]?.name || "")}</b>` : "Pick a shop above", "Recipes", "go(3)");
}
// Price heatmap: shops down the side (in ranked order), list items across. Each cell is the shop's
// UNIT price for that item (per 100 g, per litre, or per item), so a 1 kg bag and a 500 g bag compare
// fairly. Shading is per item, cheapest to dearest unit price, in one hue; the items where shops
// differ most (in proportion) come first. Hover or tap a cell for the pack and what you'd pay.
const UNIT = { g: { per: 100, label: "per 100g" }, ml: { per: 1000, label: "per litre" }, each: { per: 1, label: "each" } };
// Unit price for an item: the shop's own published unit price when it makes sense, else worked out
// from the pack size. Shops publish per kg, per litre, per 100g/10g or per item, and some give pence
// where others give pounds; the reading that implies a believable pack size wins.
function unitPrice(l) {
  const cat = C.ingredients[l.item] || {}, u = UNIT[l.unit] || UNIT.g, price = l.product.price;
  const y = E.packYield({ size: l.product.size, name: l.product.name }, { unit: l.unit, item: l.item }, cat);
  const fromPack = y ? (price / y) * u.per : null;
  const shop = shopUnit(l.product, cat, l.unit, price);
  if (shop == null) return fromPack;
  if (fromPack == null) return shop;
  // both known: trust the shop unless it's wildly off what the pack says (a mislabelled listing)
  return shop / fromPack > 2.5 || fromPack / shop > 2.5 ? fromPack : shop;
}
function shopUnit(prod, cat, unit, price) {
  const v = +prod.unitPrice, lab = String(prod.unitLabel || "").toLowerCase();
  if (!(v > 0) || !price) return null;
  // what one "label unit" is, in grams / ml / items
  let base = null, kind = null;
  if (/dr\.?wt/.test(lab)) return null;                                  // drained weight: not comparable
  if (/^(kg|kilo)/.test(lab)) { base = 1000; kind = "g"; }
  else if (/^100\s*g|per 100 gram/.test(lab)) { base = 100; kind = "g"; }
  else if (/^10\s*g/.test(lab)) { base = 10; kind = "g"; }
  else if (/^(l|ltr|litre|liter)\b/.test(lab)) { base = 1000; kind = "ml"; }
  else if (/^100\s*ml/.test(lab)) { base = 100; kind = "ml"; }
  else if (/^(each|ea|unit|u)$/.test(lab)) { base = 1; kind = "each"; }
  else return null;
  // pounds or pence? the one that implies a believable pack size
  const sane = (pp) => { const q = price / pp * base; return kind === "each" ? q >= .9 && q <= 60 : q >= 5 && q <= 12000; };
  const per = sane(v) ? v : sane(v / 100) ? v / 100 : null;
  if (per == null) return null;
  // convert to the ingredient's own unit: per 100 g, per litre, or per item
  const each = cat.eachWeight || 150;
  if (unit === "g") return kind === "g" ? per / base * 100 : kind === "ml" ? per / base * 100 : null;
  if (unit === "ml") return kind === "ml" ? per / base * 1000 : kind === "g" ? per / base * 1000 : null;
  if (unit === "each") return kind === "each" ? per : kind === "g" ? per / base * each : null;
  return null;
}
function heatmap(ranked, V) {
  const items = (S.list || []).filter(l => !l.skip);
  const cols = items.map(it => {
    const cells = ranked.map(r => V[r.id].lines.find(l => l.item === it.item)).map(l => l && !l.missing ? { l, up: unitPrice(l) } : null).map(c => c && c.up ? c : null);
    const vals = cells.filter(Boolean).map(c => c.up);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    return { it, cells, lo, hi, ratio: vals.length > 1 && lo > 0 ? hi / lo : 1, unit: (UNIT[it.unit] || UNIT.g).label };
  }).filter(c => c.cells.some(Boolean)).sort((a, b) => b.ratio - a.ratio);
  const fmtU = v => v >= 10 ? "£" + v.toFixed(0) : v >= 1 ? "£" + v.toFixed(2) : Math.round(v * 100) + "p";
  const cell = (c, col, r) => {
    if (!c) return `<td class="hm-x" title="${esc(r.name)}: not stocked">–</td>`;
    const t = col.hi > col.lo ? Math.log(c.up / col.lo) / Math.log(col.hi / col.lo) : 0, pct = Math.round(8 + t * 72);
    const l = c.l, tip = `${r.name}: ${l.product.name}${l.product.size ? " (" + l.product.size + ")" : ""}, ${money(l.product.price)} a pack = ${fmtU(c.up)} ${col.unit}. You'd buy ${l.packs} for ${money(l.cost)}.`;
    return `<td class="hm-c ${t > .6 ? "dark" : ""} ${c.up === col.lo ? "low" : ""}" style="--p:${pct}%" tabindex="0" data-tip="${esc(tip)}">${fmtU(c.up)}</td>`;
  };
  const table = `<div class="hm-wrap" role="region" aria-label="Unit price of each item at each supermarket" tabindex="0"><table class="hm">
    <thead><tr><th scope="col" class="hm-shop">Shop</th>${cols.map(c => `<th scope="col"><span>${esc(c.it.name)} <em>${c.unit}</em></span></th>`).join("")}</tr></thead>
    <tbody>${ranked.map((r, i) => `<tr><th scope="row" class="hm-shop">${esc(r.name)}</th>${cols.map(c => cell(c.cells[i], c, r)).join("")}</tr>`).join("")}</tbody></table></div>`;
  return panel("Price heatmap", `${cols.length} items × ${ranked.length} shops`,
    `<p class="help">Unit prices, so pack sizes compare fairly: per 100g, per litre, or per item. Darker means dearer than the other shops for that item; underlined is the cheapest. The biggest gaps between shops are on the left.</p>
     <div class="hm-legend"><span>cheapest</span><i></i><span>dearest</span><span class="hm-x-key">– not stocked</span></div>${table}<div class="hm-tip" id="hm-tip" role="status"></div>`);
}
// tooltip for the heatmap (hover on a computer, tap on a phone)
document.addEventListener("mouseover", e => hmTip(e.target.closest?.(".hm-c")));
document.addEventListener("focusin", e => hmTip(e.target.closest?.(".hm-c")));
document.addEventListener("click", e => hmTip(e.target.closest?.(".hm-c")));
function hmTip(td) {
  const tip = document.getElementById("hm-tip"); if (!tip) return;
  if (!td) { tip.classList.remove("on"); return; }
  tip.textContent = td.dataset.tip; tip.classList.add("on");
  const r = td.getBoundingClientRect(), w = tip.offsetWidth;
  tip.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + "px";
  tip.style.top = (r.top + scrollY - tip.offsetHeight - 8) + "px";
}
function shopLink(r, buy) {
  const list = buy.map(l => `${encodeURIComponent(l.product.id)}:${l.packs}`).join(",");
  return r.id === "sainsburys" ? `${r.trolleyUrl}?forkcast=${list}` : `${r.trolleyUrl}#forkcast=${list}`;   // Sainsbury's site breaks on a # link
}
function orderPanel(r, v) {
  const buy = v.lines.filter(l => !l.missing), link = shopLink(r, buy);
  const products = buy.map(l => `<div class="pl"><span><a href="${esc(l.product.url || "#")}" target="_blank" rel="noopener">${l.packs} × ${esc(l.product.name)}</a> <span class="small dim">${esc(l.product.size || "")}</span><br><span class="tier ${l.product.tier}">${l.product.tier}</span> ${l.sub ? `<span class="badge q">swap</span> ` : ""}<span class="small dim">${l.sub ? `${esc(l.sub)} instead of ` : "for "}${fmtQty(l.qty, l.unit)} ${esc(l.name.toLowerCase())}${l.product.promo ? ` · ${esc(l.product.promo)}` : ""}</span></span><span class="pc">${money(l.cost)}</span>
      ${l.alts?.length ? `<span class="alts">${l.alts.slice(0, 3).map((a, k) => `<button class="tiny" aria-pressed="${l.swapped === k}" onclick="swapLine('${r.id}','${esc(l.item)}',${k})" title="${esc(a.product.name)}">${esc(short(a.product.name))} ${money(a.cost)}</button>`).join("")}${l.swapped != null ? `<button class="tiny" onclick="swapLine('${r.id}','${esc(l.item)}',null)">Undo</button>` : ""}</span>` : ""}</div>`).join("")
    + v.lines.filter(l => l.missing).map(l => `<div class="pl"><span class="miss">${esc(l.name)} (${fmtQty(l.qty, l.unit)}): not stocked here</span><span></span></div>`).join("");
  let h = `<div class="order">`;
  if (r.inStoreOnly) h += `<div class="stepline"><span class="n">1</span><div class="b"><b>${esc(r.name)} is in store only.</b> Take the list with you.<div class="row wrap" style="margin-top:10px"><button class="go" onclick="print()">Print list</button><button onclick="copyList('${r.id}')">Copy list</button></div></div></div>`;
  else if (HELPER) h += `<div class="stepline"><span class="n">1</span><div class="b"><a class="btn go big" target="_blank" rel="noopener" href="${esc(link)}">Fill my ${esc(r.name)} basket ↗</a><p class="small dim">Opens ${esc(r.name)} and fills the basket. Log in when it asks, then check out.</p></div></div>`;
  else {
    h += `<div class="stepline"><span class="n">1</span><div class="b"><a class="btn go" target="_blank" rel="noopener" href="${esc(link)}">Open ${esc(r.name)} ↗</a><p class="small dim">Opens in a new tab with your list attached.</p></div></div>
      <div class="stepline"><span class="n">2</span><div class="b"><b>On ${esc(r.name)}, tap ★ Forkcast</b> (your bookmark, or Share › Forkcast on iPhone). It fills the basket${/sign-in/.test(r.fillStatus) ? `; if ${esc(r.name)} asks you to log in first, log in and tap it again` : ""}.
        <p class="small" style="margin-top:6px"><button class="link" onclick="OPEN=OPEN==='bm'?null:'bm';render()">${OPEN === "bm" ? "Hide" : "First time? Set up ★ Forkcast on this device (once)"}</button></p>${OPEN === "bm" ? bookmarkHelp() : ""}</div></div>
      <div class="stepline"><span class="n">3</span><div class="b">Log in to ${esc(r.name)} if you haven't, book a slot and check out.</div></div>`;
    if (/unverified/.test(r.fillStatus)) h += `<p class="notice">Filling a ${esc(r.name)} basket is new and only partly tested. If anything's missing, the full list is below.</p>`;
  }
  h += fold("Products", `${buy.length} · ${money(v.total)}${v.missing ? ` · ${v.missing} not stocked` : ""}`, products + `<div class="row" style="margin-top:10px"><button class="tiny" onclick="copyList('${r.id}')">Copy as text</button></div>`);
  const done = S.weeks?.[S.week]?.ordered;
  h += done ? `<p class="small dim" style="margin-top:14px">✓ Ordered from ${esc(done.shop)}.${done.kept ? ` ${done.kept} long-life leftover${done.kept > 1 ? "s" : ""} went in your cupboard, so ${done.kept > 1 ? "they" : "it"} won't be bought again.` : ""}</p>`
    : `<div class="stepline"><span class="n">✓</span><div class="b"><button onclick="markOrdered('${r.id}')">I've ordered this</button><p class="small dim">Forkcast keeps what's left of long-life packs (rice, pasta, tins…) in your cupboard, so next week's list doesn't buy them again.</p></div></div>`;
  return h + `</div>`;
}
// The bookmark is the one thing every browser has built in that can act on a supermarket's own page.
function bookmarkHelp() {
  if (BOOKMARK === null) { BOOKMARK = ""; fetch(STATIC ? "bookmark-loader.js" : "/api/bookmark-loader").then(r => r.text()).then(t => { BOOKMARK = "javascript:" + encodeURIComponent(t); LOADER = t; render(); }); }
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1), android = /Android/.test(navigator.userAgent);
  const computer = `<p style="margin:0 0 8px"><b>On a computer:</b> drag this button onto your bookmarks bar: <a class="btn go tiny" href="${BOOKMARK || "#"}" onclick="alert('Drag this onto your bookmarks bar. Then, on the supermarket site, click it.');return false">★ Forkcast</a></p>`;
  const iphone = `<p style="margin:0 0 8px"><b>On iPhone or iPad</b> (once, about a minute) add Forkcast to Safari's Share menu:</p>
    <ol class="small" style="margin:0 0 8px;padding-left:18px"><li><button class="tiny" onclick="copyShortcut()">Copy the Forkcast code</button></li>
    <li>Open the <b>Shortcuts</b> app › <b>+</b> › search for <b>Run JavaScript on Web Page</b> and add it.</li>
    <li>Tap the code box in that action, select all, and paste.</li>
    <li>Tap the <b>ⓘ</b> (or the name at the top) › turn on <b>Show in Share Sheet</b>, and name it <b>Forkcast</b>.</li></ol>
    <p style="margin:0 0 8px">Then on the supermarket's site: tap <b>Share</b> › <b>Forkcast</b>.</p>`;
  const droid = `<p style="margin:0 0 8px"><b>On Android (Chrome):</b> <button class="tiny" onclick="navigator.clipboard?.writeText(BOOKMARK).then(()=>alert('Copied. Bookmark this page (⋮ › ☆), then edit the bookmark: name it Forkcast and paste this as its URL.'))">Copy the button</button>, bookmark this page, then edit the bookmark: name it <b>Forkcast</b> and paste as the URL. On the supermarket's site, tap the address bar, type <b>Forkcast</b> and tap the bookmark.</p>`;
  return `<div class="notice" style="border-color:var(--tom)">${ios ? iphone : android ? droid : computer}
    <details class="small" style="margin-top:6px"><summary style="cursor:pointer;color:var(--ink-3)">Other devices</summary><div style="margin-top:8px">${[ios ? "" : iphone, android ? "" : droid, ios || android ? computer : ""].join("")}</div></details>
    <p class="small dim" style="margin:8px 0 0">Why? For your safety, browsers never let one website change another website's basket. A button you add yourself runs on the supermarket's own page, so it can. It always fetches the latest version, so you only set it up once.</p></div>`;
}
let LOADER = "";
// Shortcuts' "Run JavaScript on Web Page" needs completion() at the end
function copyShortcut() { navigator.clipboard?.writeText(LOADER + "\ncompletion(true);").then(() => alert("Copied. Now open the Shortcuts app and follow steps 2–4."), () => alert("Couldn't copy here; try again.")); }
const short = s => s.length > 30 ? s.slice(0, 28) + "…" : s;
function swapLine(shop, item, k) { const m = { ...(S.swaps[shop] || {}) }; k == null ? delete m[item] : m[item] = k; S.swaps[shop] = m; save(); render(); }
let HELPER = !!document.documentElement.dataset.fcHelper;
setTimeout(() => { if (!HELPER && document.documentElement.dataset.fcHelper) { HELPER = true; render(); } }, 1500);
function copyList(id) { const r = S.job.retailers[id], v = shopView(r);
  navigator.clipboard?.writeText(v.lines.map(l => l.missing ? `${l.name} (${fmtQty(l.qty, l.unit)}) - elsewhere` : `${l.packs} x ${l.product.name} ${l.product.size || ""} - ${money(l.cost)}`).join("\n")).then(() => alert("Copied")); }

// ---------------------------------------------------------------- 4. cook
function recipes() {
  const who = (+prefs().adults || 2) + .6 * (+prefs().children || 0);
  let h = head(`Step 4 · week ${weekNo(S.week)}`, "Let's", "cook.", "Quantities scaled for your household. Rate each one after you've cooked it: 4–5★ and ♥ come up more often, 1★ never again.") + `<div class="recipes">`;
  for (const d of S.plan.days) for (const slot of MEALS) {
    const r = RECIPES[d[slot]]; if (!r || (slot === "lunch" && d.lunchLeftovers)) continue;
    const nextDay = S.plan.days.find(x => x.day === DAYS[(DAYS.indexOf(d.day) + 1) % 7]);
    const double = slot === "dinner" && nextDay?.lunchLeftovers && nextDay.lunch === d.dinner;
    const f = d.portion?.[slot] || 1, f2 = double ? nextDay.portion?.lunch || 1 : 0, k = who * (f + f2) / (r.serves || 4);
    h += fold(`<span style="color:var(--tom-ink);font:700 15px/1 var(--font-head);letter-spacing:.08em;text-transform:uppercase;min-width:92px">${d.day} ${fmtD(addDays(S.week, DAYS.indexOf(d.day)), { day: "numeric" })} ${slot === "dinner" ? "" : slot}</span>${esc(r.name)}`, `${r.time} min`,
      `<div class="row" style="justify-content:space-between;margin-bottom:6px"><p class="recipe meta" style="margin:0">${Math.round(r.kcal * f)} kcal · ${Math.round(r.protein_g * f)} g protein · serves ${Math.round(who * (double ? 2 : 1) * 10) / 10}${f !== 1 ? ` · ${f}× portions` : ""}${double ? ` · <span style="color:var(--tom-ink)">makes double: half is ${esc(nextDay.day)}'s lunch</span>` : ""}</p><span class="row" style="gap:2px">${starsHTML(r.id)}${heart(r.id)}</span></div>
      <div class="two"><ul class="ing">${r.ingredients.map(i => `<li><span class="num">${fmtQty(Math.ceil(i.qty * k), i.unit)}</span><span>${esc((C.ingredients[i.item] || {}).name || i.item)}${i.note ? ` <span class="dim small">${esc(i.note)}</span>` : ""}</span></li>`).join("")}</ul>
      <ol class="steps-list">${r.steps.map(s => `<li>${esc(s)}</li>`).join("")}</ol></div>`);
  }
  h = h.replace("<!--recipes-->", "") ;
  return h + `</div>` + nextBar(`Next: week ${weekNo(addDays(S.week, 7))}, ${weekLabel(addDays(S.week, 7))}. Meals from the last two weeks get a rest.`, "Plan next week", "planNextWeek()");
}

// ---------------------------------------------------------------- boot
api("/api/content").then(c => { C = c; RECIPES = Object.fromEntries(c.recipes.map(r => [r.id, r])); if (S.step > 3) S.step = S.pick ? 2 : 1; if (S.step > maxStep()) S.step = maxStep(); render(); poll(); })
  .catch(e => { $("#view").innerHTML = `<p class="miss" style="margin-top:30px">Couldn't load Forkcast: ${esc(e.message)}</p>`; });
render();
