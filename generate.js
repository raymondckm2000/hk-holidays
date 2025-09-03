// generate.js — HK holidays JSON builder (2017–2026)
// Offline-friendly: will use local files from ./inputs when present; otherwise tries network with IPv4-first + retries.
// Output: hk_holidays_2017_2026.json
//
// ── Quick Start ─────────────────────────────────────────────────────────────────
// 1) OPTIONAL (recommended): add to package.json → { "type": "module" }
// 2) Create inputs folder:  mkdir -p inputs
// 3) If your network blocks node-fetch, manually download files in a browser, then place in ./inputs :
//    • 2017–2023 GovHK EN pages → inputs/govhk_YYYY_en.html
//    • 2017–2023 GovHK TC pages → inputs/govhk_YYYY_tc.html
//    • 2017–2026 Labour statutory pages → inputs/labour_YYYY.html  (2019–2026 可用同一彙總頁另存為不同檔名)
//    • 2024–2026 1823:  JSON → inputs/1823_en.json  或 ICS → inputs/1823_en.ics
//       (在瀏覽器打開 https://www.1823.gov.hk/common/ical/en.json 或 en.ics，另存檔到 inputs/
//        若有中文端點，亦可放 inputs/1823_tc.json 或 1823_tc.ics)
// 4) Run:  node generate.js  （或 node --dns-result-order=ipv4first generate.js）
//
// ── Notes ────────────────────────────────────────────────────────────────────────
// • If both network and local files are missing for a year, that year will be skipped (and logged).
// • You can run again after adding more files; the script regenerates the single JSON output.

import dns from "node:dns";
try { dns.setDefaultResultOrder("ipv4first"); } catch {}

import fetch from "node-fetch";
import * as cheerio from "cheerio";
import dayjs from "dayjs";
import fs from "node:fs";
import path from "node:path";

// ---------- Config ----------
const START_YEAR = 2017;
const END_YEAR = 2026;

const GOVHK_EN = (y) => `https://www.gov.hk/en/about/abouthk/holiday/${y}.htm`;
const GOVHK_TC = (y) => `https://www.gov.hk/tc/about/abouthk/holiday/${y}.htm`;

const LABOUR_YEAR_PAGES = {
  2017: "https://www.labour.gov.hk/eng/news/latest_holidays2017.htm",
  2018: "https://www.labour.gov.hk/eng/news/latest_holidays2018.htm",
  // Use per-year pages (more reliable than the summary list)
  2019: "https://www.labour.gov.hk/eng/news/latest_holidays2019.htm",
  2020: "https://www.labour.gov.hk/eng/news/latest_holidays2020.htm",
  2021: "https://www.labour.gov.hk/eng/news/latest_holidays2021.htm",
  2022: "https://www.labour.gov.hk/eng/news/latest_holidays2022.htm",
  2023: "https://www.labour.gov.hk/eng/news/latest_holidays2023.htm",
  2024: "https://www.labour.gov.hk/eng/news/latest_holidays2024.htm",
  2025: "https://www.labour.gov.hk/eng/news/latest_holidays2025.htm",
  2026: "https://www.labour.gov.hk/eng/news/latest_holidays2026.htm",
};

const DPO_1823_EN_JSON = "https://www.1823.gov.hk/common/ical/en.json";
const DPO_1823_EN_ICS  = "https://www.1823.gov.hk/common/ical/en.ics";
const DPO_1823_TC_JSON = [
  "https://www.1823.gov.hk/common/ical/tc.json",
  "https://www.1823.gov.hk/common/ical/zh.json",
];
const DPO_1823_TC_ICS  = [
  "https://www.1823.gov.hk/common/ical/tc.ics",
  "https://www.1823.gov.hk/common/ical/zh.ics",
];

const INPUTS_DIR = path.resolve("inputs");
const DEFAULT_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari",
  "Accept-Language": "zh-HK,zh-TW,zh,en;q=0.9",
  "Connection": "keep-alive",
};

// ---------- Helpers ----------
const ensureDir = (dir) => { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); };
const normalize = (s) => (s || "").replace(/\u00A0/g, " ").replace(/[ \t]+/g, " ").trim();
const stripWeekdayParen = (s) => s
  .replace(/(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun|星期[一二三四五六日天])(?:day)?/gi, "")
  .replace(/[（(].*?[)）]/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchSafe(url, type = "text", tries = 3, timeoutMs = 15000) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, { headers: DEFAULT_HEADERS, signal: ac.signal, redirect: "follow" });
      clearTimeout(t);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return type === "json" ? await res.json() : await res.text();
    } catch (e) {
      clearTimeout(t);
      const msg = e?.name === "AbortError" ? "timeout" : (e?.message || e);
      console.warn(`⚠️ Fetch ${attempt}/${tries} failed: ${url} — ${msg}`);
      if (attempt === tries) return type === "json" ? null : "";
      await sleep(500 * attempt + Math.random() * 300);
    }
  }
  return type === "json" ? null : "";
}

function parseISO(txt, year) {
  const t = stripWeekdayParen(normalize(txt));
  const tryFormats = [
    "D MMMM YYYY", "MMMM D, YYYY", "D MMM YYYY", "MMM D, YYYY",
    "YYYY-MM-DD", "YYYY/M/D", "YYYY年M月D日", "M月D日 YYYY年", "M月D日",
  ];
  for (const f of tryFormats) {
    const d = dayjs(t.match(/\d{4}/) ? t : `${t} ${year}`, f, "en", true);
    if (d.isValid()) return d.format("YYYY-MM-DD");
  }
  const zh = t.match(/(\d{1,2})月(\d{1,2})日/);
  if (zh) {
    const d = dayjs(`${year}-${zh[1]}-${zh[2]}`, "YYYY-M-D", true);
    if (d.isValid()) return d.format("YYYY-MM-DD");
  }
  return "";
}

function pickRows($) {
  const rows = [];
  $("table tr").each((_, tr) => rows.push(normalize($(tr).text())));
  if (!rows.length) $("li").each((_, li) => rows.push(normalize($(li).text())));
  return rows.filter(Boolean);
}

function parseGovHKRowsToMap(rows, year, isChinese) {
  const map = new Map(); // date -> { name_en?, name_zh? }
  for (const line of rows) {
    const dateEN = line.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\b[^,]*\d{1,2}(?:,?\s*\d{4})?/i)?.[0] || "";
    const dateZH = line.match(/\d{1,2}\s*月\s*\d{1,2}\s*日(?:\s*\d{4}\s*年)?/);
    const datePart = dateEN || (dateZH ? dateZH[0] : "");
    let name = line;
    if (datePart) {
      const idx = line.indexOf(datePart);
      if (idx > 0) name = normalize(line.slice(0, idx));
    }
    name = name.replace(/^[\d\.\-\•\·\s]+/, "").trim();
    const iso = parseISO(datePart, year);
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso) && name.length >= 2) {
      const prev = map.get(iso) || {};
      map.set(iso, isChinese ? { ...prev, name_zh: name } : { ...prev, name_en: name });
    }
  }
  return map;
}

// ---------- Parsers for ICS & 1823 JSON ----------
function parseICS(text) {
  // very small ICS parser for all-day events (DTSTART;VALUE=DATE:YYYYMMDD, SUMMARY:...)
  const out = [];
  const lines = text.split(/\r?\n/);
  let current = {};
  for (const line of lines) {
    if (line.startsWith("BEGIN:VEVENT")) { current = {}; }
    else if (line.startsWith("DTSTART")) {
      const m = line.match(/:(\d{8})/);
      if (m) current.date = `${m[1].slice(0,4)}-${m[1].slice(4,6)}-${m[1].slice(6,8)}`;
    } else if (line.startsWith("SUMMARY:")) {
      current.title = line.slice(8).trim();
    } else if (line.startsWith("END:VEVENT")) {
      if (current.date) out.push({ date: current.date, title: normalize(current.title || "") });
      current = {};
    }
  }
  return out;
}

function parse1823Json(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.filter(x => x && x.date).map(x => ({
    date: x.date,
    name_en: normalize(x.title || x.summary || x.name || ""),
    name_zh: "",
  }));
}

// ---------- Local file helpers ----------
function readIfExists(p, mode = "text") {
  try {
    if (fs.existsSync(p)) return mode === "json" ? JSON.parse(fs.readFileSync(p, "utf8")) : fs.readFileSync(p, "utf8");
  } catch {}
  return null;
}

// ---------- Fetchers (prefer local, fallback to web) ----------
async function getGovHKYear(year) {
  const localEN = path.join(INPUTS_DIR, `govhk_${year}_en.html`);
  const localTC = path.join(INPUTS_DIR, `govhk_${year}_tc.html`);
  const enHtml = readIfExists(localEN, "text") || await fetchSafe(GOVHK_EN(year), "text", 3, 15000);
  const tcHtml = readIfExists(localTC, "text") || await fetchSafe(GOVHK_TC(year), "text", 3, 15000);

  if (!enHtml && !tcHtml) {
    console.warn(`⚠️ GovHK ${year} EN/TC both unavailable, skip this year.`);
    return [];
  }

  const dates = new Set();
  let enMap = new Map();
  let zhMap = new Map();
  if (enHtml) { const $en = cheerio.load(enHtml); enMap = parseGovHKRowsToMap(pickRows($en), year, false); for (const d of enMap.keys()) dates.add(d); }
  if (tcHtml) { const $tc = cheerio.load(tcHtml); zhMap = parseGovHKRowsToMap(pickRows($tc), year, true);  for (const d of zhMap.keys()) dates.add(d); }

  const out = [];
  for (const d of dates) {
    const name_en = enMap.get(d)?.name_en || "";
    const name_zh = zhMap.get(d)?.name_zh || "";
    if (!name_en && !name_zh) continue;
    out.push({ date: d, name_en, name_zh, types: { general_holiday: true, statutory_holiday: false }, sources: [
      ...(enHtml ? [{ kind: enHtml === readIfExists(localEN, "text") ? "GovHK(local)" : "GovHK", url: enHtml === readIfExists(localEN, "text") ? localEN : GOVHK_EN(year) }] : []),
      ...(tcHtml ? [{ kind: tcHtml === readIfExists(localTC, "text") ? "GovHK(local)" : "GovHK", url: tcHtml === readIfExists(localTC, "text") ? localTC : GOVHK_TC(year) }] : []),
    ]});
  }
  out.sort((a,b)=>a.date.localeCompare(b.date));
  console.log(`• ${year}: GovHK parsed ${out.length} holidays`);
  return out;
}

async function get1823All() {
  // Prefer local files
  const localJsonEN = path.join(INPUTS_DIR, "1823_en.json");
  const localIcsEN  = path.join(INPUTS_DIR, "1823_en.ics");
  const localJsonTC = [path.join(INPUTS_DIR, "1823_tc.json"), path.join(INPUTS_DIR, "1823_zh.json")];
  const localIcsTC  = [path.join(INPUTS_DIR, "1823_tc.ics"), path.join(INPUTS_DIR, "1823_zh.ics")];

  let en = readIfExists(localJsonEN, "json");
  if (!en && fs.existsSync(localIcsEN)) en = parseICS(readIfExists(localIcsEN, "text")).map(x => ({ date:x.date, name_en:x.title, name_zh:"" }));
  if (!en) {
    const remote = await fetchSafe(DPO_1823_EN_JSON, "json", 2, 12000);
    en = parse1823Json(remote);
    if (!en.length) {
      const ics = await fetchSafe(DPO_1823_EN_ICS, "text", 2, 12000);
      if (ics) en = parseICS(ics).map(x => ({ date:x.date, name_en:x.title, name_zh:"" }));
    }
  }

  let zh = null;
  for (const p of localJsonTC) { zh = zh || readIfExists(p, "json"); }
  if (!zh) {
    for (const p of localIcsTC) { if (fs.existsSync(p)) { zh = parseICS(readIfExists(p, "text")).map(x => ({ date:x.date, name_zh:x.title })); break; } }
  }
  if (!zh) {
    for (const u of DPO_1823_TC_JSON) {
      const data = await fetchSafe(u, "json", 2, 12000);
      if (Array.isArray(data) && data.length) { zh = data.map(x => ({ date:x.date, name_zh: normalize(x.title || x.summary || x.name || "") })); break; }
    }
    if (!zh) {
      for (const u of DPO_1823_TC_ICS) {
        const ics = await fetchSafe(u, "text", 2, 12000);
        if (ics) { zh = parseICS(ics).map(x => ({ date:x.date, name_zh:x.title })); break; }
      }
    }
  }

  if ((!en || !en.length) && (!zh || !zh.length)) {
    console.warn("⚠️ 1823 not available (local nor remote). Skipping 2024–2026.");
    return [];
  }

  // Merge EN + ZH on date
  const map = new Map();
  for (const h of (en || [])) if (h?.date) map.set(h.date, { name_en: normalize(h.name_en || ""), name_zh: "" });
  for (const h of (zh || [])) if (h?.date) map.set(h.date, { ...(map.get(h.date)||{ name_en:"", name_zh:"" }), name_zh: normalize(h.name_zh || "") });

  const out = [];
  for (const [date, { name_en, name_zh }] of map.entries()) out.push({ date, name_en, name_zh, types: { general_holiday: true, statutory_holiday: false }, sources: [{ kind: en ? "1823" : "1823(local)", url: en ? DPO_1823_EN_JSON : localJsonEN }] });
  out.sort((a,b)=>a.date.localeCompare(b.date));
  return out;
}

async function getStatutoryDates(year) {
  const local = path.join(INPUTS_DIR, `labour_${year}.html`);
  const html = readIfExists(local, "text") || await fetchSafe(LABOUR_YEAR_PAGES[year], "text", 3, 15000);
  if (!html) { console.warn(`⚠️ Labour page unavailable for ${year}; statutory flags skipped.`); return new Set(); }
  const $ = cheerio.load(html);
  const dates = new Set();
  $("li, p, tr").each((_, el) => {
    const t = normalize($(el).text());
    const mEN = t.match(/((January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2})|(\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December))/i)?.[0] || "";
    const mZH = t.match(/\d{1,2}\s*月\s*\d{1,2}\s*日/);
    const iso = parseISO(mEN || (mZH ? mZH[0] : ""), year);
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) dates.add(iso);
  });
  return dates;
}

// ---------- Merge & Write ----------
function mergeAndMark(generalList, statutoryDates) {
  const byDate = Object.groupBy(generalList, (x) => x.date);
  const out = [];
  Object.keys(byDate).forEach((d) => {
    byDate[d].forEach((item) => {
      const isStat = statutoryDates.has(item.date);
      out.push({ ...item, types: { general_holiday: true, statutory_holiday: isStat } });
    });
  });
  statutoryDates.forEach((d) => {
    if (!byDate[d]) out.push({ date: d, name_en: "", name_zh: "", types: { general_holiday: false, statutory_holiday: true }, sources: [] });
  });
  out.sort((a,b)=>a.date.localeCompare(b.date));
  return out;
}

// ---------- Main ----------
(async () => {
  ensureDir(INPUTS_DIR);
  const all = [];

  // 2017–2023
  for (let y = START_YEAR; y <= Math.min(END_YEAR, 2023); y++) {
    const [gen, stat] = await Promise.all([getGovHKYear(y), getStatutoryDates(y)]);
    all.push(...mergeAndMark(gen, stat));
  }

  // 2024–2026 (1823)
  if (END_YEAR >= 2024) {
    const gen1823 = await get1823All();
    for (let y = 2024; y <= END_YEAR; y++) {
      const gen = gen1823.filter((h) => h.date.startsWith(String(y)));

      // ▲ 補中文名稱：用 GovHK 年頁（TC）對照日期覆蓋 name_zh
      const govList = await getGovHKYear(y);
      const zhMap = new Map(govList.map(h => [h.date, h.name_zh]));
      let filled = 0;
      gen.forEach(h => { if (!h.name_zh && zhMap.get(h.date)) { h.name_zh = zhMap.get(h.date); filled++; } });

      const stat = await getStatutoryDates(y);
      all.push(...mergeAndMark(gen, stat));
      console.log(`• ${y}: merged ${gen.length} (general) + ${stat.size} statutory marks, zh filled: ${filled}`);
    }
  }

  // de-dup
  const seen = new Set();
  const final = all.filter((h) => {
    const k = `${h.date}|${h.name_en}|${h.name_zh}|${h.types.general_holiday}|${h.types.statutory_holiday}`;
    if (seen.has(k)) return false; seen.add(k); return true;
  });

  fs.writeFileSync("hk_holidays_2017_2026.json", JSON.stringify(final, null, 2), "utf8");
  console.log(`✅ Done. ${final.length} records -> hk_holidays_2017_2026.json`);
})();
