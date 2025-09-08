import fs from 'node:fs';
import path from 'node:path';
import { load } from 'cheerio';
import dns from 'node:dns';

// Prefer IPv4 (1823 blocks IPv6 in some environments)
try { dns.setDefaultResultOrder('ipv4first'); } catch {}

const DATA_DIR = path.resolve('data');
const REPORT_DIR = path.resolve('reports');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(REPORT_DIR, { recursive: true });

const START_YEAR = 2017;
const END_YEAR = 2026;
const INCLUDE_STATUTORY = process.argv.includes('--statutory');

const EN_URL = 'https://www.1823.gov.hk/common/ical/en.json';
const ZH_URLS = [
  'https://www.1823.gov.hk/common/ical/zh.json',
  'https://www.1823.gov.hk/common/ical/tc.json'
];

function normalize(s) {
  return (s || '').trim();
}

async function fetchJson(urls) {
  if (!Array.isArray(urls)) urls = [urls];
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn(`⚠️  Failed to fetch ${url}: ${e.message}`);
    }
  }
  return null;
}

async function fetchHtml(urls) {
  if (!Array.isArray(urls)) urls = [urls];
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.text();
    } catch (e) {
      console.warn(`⚠️  Failed to fetch ${url}: ${e.message}`);
    }
  }
  return '';
}

async function get1823List() {
  const enRaw = await fetchJson(EN_URL);
  const zhRaw = await fetchJson(ZH_URLS);

  // The 1823 iCal feed used to return a simple array of events.  In
  // mid-2024 the format changed to a nested object (jCal style).  To
  // remain backwards compatible we extract the actual event list in a
  // more defensive manner.
  const extractEvents = data => {
    if (!data) return [];

    const fromProps = props => {
      const obj = {};
      for (const p of Array.isArray(props) ? props : []) {
        if (!Array.isArray(p)) continue;
        const [name, , , value] = p;
        if (!name) continue;
        obj[name.toLowerCase()] = value;
      }
      return obj;
    };

    // jCal array format: ['vcalendar', [ ...props ], [ components ]]
    if (Array.isArray(data) && data[0] === 'vcalendar') {
      const components = Array.isArray(data[2]) ? data[2] : [];
      return components
        .filter(c => Array.isArray(c) && c[0] === 'vevent')
        .map(c => fromProps(c[1]));
    }

    if (Array.isArray(data)) return data;

    // jCal object format: { vcalendar: [ { vevent: [ ... ] } ] }
    if (data && Array.isArray(data.vcalendar)) {
      const cal = data.vcalendar[0] || {};
      const events = Array.isArray(cal.vevent) ? cal.vevent : [];
      return events.map(ev => {
        if (Array.isArray(ev)) return fromProps(ev[1]);
        const obj = {};
        if (ev && typeof ev === 'object') {
          for (const [name, val] of Object.entries(ev)) {
            const lower = name.toLowerCase();
            if (val && typeof val === 'object') {
              if (Array.isArray(val)) obj[lower] = val[0];
              else if ('value' in val) obj[lower] = val.value;
              else obj[lower] = val;
            } else {
              obj[lower] = val;
            }
          }
        }
        return obj;
      });
    }

    return [];
  };

  const enRawEvents = extractEvents(enRaw);
  const zhRawEvents = extractEvents(zhRaw);
  const en = Array.isArray(enRawEvents) ? enRawEvents : [];
  const zh = Array.isArray(zhRawEvents) ? zhRawEvents : [];

  const getDate = item => {
    const d = item?.date || item?.dtstart || item?.['dtstart;value=date'] || item?.DTSTART || item?.['DTSTART;VALUE=DATE'];
    let v = Array.isArray(d) ? d[0] : d;
    if (!v) return '';
    // Formats like 20240101 or 2024-01-01T00:00:00
    v = String(v).replace(/T.*$/, '');
    if (/^\d{8}$/.test(v)) return `${v.slice(0,4)}-${v.slice(4,6)}-${v.slice(6,8)}`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
    return '';
  };

  const getName = (item, lang) => {
    const key = lang === 'en'
      ? (item.title || item.summary || item.name || item.SUMMARY)
      : (item.title || item.summary || item.name || item.SUMMARY);
    const v = Array.isArray(key) ? key[0] : key;
    return normalize(v);
  };

  const map = new Map();
  for (const item of en) {
    const date = getDate(item);
    if (!date) continue;
    map.set(date, {
      date,
      name_en: getName(item, 'en'),
      name_zh: '',
      statutory: false,
      source: '1823'
    });
  }
  for (const item of zh) {
    const date = getDate(item);
    if (!date) continue;
    const target = map.get(date) || {
      date,
      name_en: '',
      name_zh: '',
      statutory: false,
      source: '1823'
    };
    target.name_zh = getName(item, 'zh');
    map.set(date, target);
  }

  const out = [...map.values()].filter(h => {
    const y = parseInt(h.date.slice(0,4), 10);
    return y >= START_YEAR && y <= END_YEAR;
  });
  out.sort((a,b)=>a.date.localeCompare(b.date));
  return out;
}

function parseISODate(text, year) {
  if (!text) return '';
  const months = {
    January:1, February:2, March:3, April:4, May:5, June:6,
    July:7, August:8, September:9, October:10, November:11, December:12
  };
  let m = text.match(/(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s*(\d{4})?/i);
  if (m) {
    const day = m[1].padStart(2,'0');
    const month = String(months[m[2]]).padStart(2,'0');
    const y = m[3] || year;
    return `${y}-${month}-${day}`;
  }
  m = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = text.match(/(\d{1,2})月(\d{1,2})日/);
  if (m) {
    const month = m[1].padStart(2,'0');
    const day = m[2].padStart(2,'0');
    return `${year}-${month}-${day}`;
  }
  return '';
}

async function getStatutoryDates(year) {
  const urls = [
    `https://www.labour.gov.hk/eng/news/latest_holidays${year}.htm`,
    'https://www.labour.gov.hk/eng/news/holidays_list.htm'
  ];
  const html = await fetchHtml(urls);
  if (!html) return new Set();
  const $ = load(html);
  const dates = new Set();
  $('li, td, tr, p').each((_, el) => {
    const t = $(el).text().replace(/\s+/g, ' ').trim();
    const iso = parseISODate(t, year);
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) dates.add(iso);
  });
  return dates;
}

function writeJSON(name, data) {
  fs.writeFileSync(path.join(DATA_DIR, name), JSON.stringify(data, null, 2), 'utf8');
}

function validate(year, list) {
  const missingZh = list.filter(h => !h.name_zh).length;
  const missingEn = list.filter(h => !h.name_en).length;
  const statCount = list.filter(h => h.statutory).length;
  const dates = list.map(h => h.date);
  const dupCount = dates.length - new Set(dates).size;
  return { year, total: list.length, missingZh, missingEn, dupCount, statCount };
}

async function main() {
  const all = await get1823List();
  const byYear = {};
  all.forEach(h => {
    const y = h.date.slice(0,4);
    (byYear[y] = byYear[y] || []).push(h);
  });

  const years = Object.keys(byYear).sort();
  const reportLines = ['# Validation Report', '', '| Year | Records | Missing ZH | Missing EN | Duplicate Dates | Statutory Marked |', '| ---- | ------- | ---------- | ---------- | --------------- | ---------------- |'];
  let total = 0;

  for (const y of years) {
    const list = byYear[y];
    if (INCLUDE_STATUTORY) {
      const stats = await getStatutoryDates(Number(y));
      list.forEach(h => { h.statutory = stats.has(h.date); });
    }
    list.sort((a,b)=>a.date.localeCompare(b.date));
    writeJSON(`company_holidays_${y}.json`, list);
    const v = validate(y, list);
    total += v.total;
    reportLines.push(`| ${y} | ${v.total} | ${v.missingZh} | ${v.missingEn} | ${v.dupCount} | ${v.statCount} |`);
  }

  writeJSON('company_holidays_ALL.json', years.flatMap(y => byYear[y]));
  reportLines.push('', `Total records: ${total}`);
  fs.writeFileSync(path.join(REPORT_DIR, 'validation.md'), reportLines.join('\n'), 'utf8');
  console.log(`Done. ${total} records.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
