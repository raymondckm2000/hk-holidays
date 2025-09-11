import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dns from 'node:dns';

// Prefer IPv4 (1823 blocks IPv6 in some environments)
try { dns.setDefaultResultOrder('ipv4first'); } catch {}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const REPORT_DIR = path.join(ROOT_DIR, 'reports');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(REPORT_DIR, { recursive: true });

const START_YEAR = 2017;
const END_YEAR = 2026;
const INCLUDE_STATUTORY = process.argv.includes('--statutory');

// The 1823 API previously provided the holiday data.  Network access can be
// unreliable in some environments, so the script now reads pre-downloaded
// files from the data directory instead.
const EN_FILE = path.join(DATA_DIR, 'en.json');
const ZH_FILE = path.join(DATA_DIR, 'zh.json');

function normalize(s) {
  return (s || '').trim();
}

const WEEKDAYS = ['SU','MO','TU','WE','TH','FR','SA'];

function parseRRule(str) {
  const out = {};
  String(str).split(';').forEach(p => {
    const [k, v] = p.split('=');
    if (k && v) out[k.toUpperCase()] = v;
  });
  return out;
}

function parseRuleDate(v) {
  if (!v) return '';
  v = String(v).replace(/T.*$/, '');
  if (/^\d{8}$/.test(v)) return `${v.slice(0,4)}-${v.slice(4,6)}-${v.slice(6,8)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  return '';
}

function nthWeekday(year, month, weekday, n) {
  if (!n) return null;
  if (n > 0) {
    const first = new Date(Date.UTC(year, month - 1, 1));
    const offset = (weekday - first.getUTCDay() + 7) % 7;
    const day = 1 + offset + 7 * (n - 1);
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return day <= last ? day : null;
  }
  const last = new Date(Date.UTC(year, month, 0));
  const offset = (last.getUTCDay() - weekday + 7) % 7;
  const day = last.getUTCDate() - offset + 7 * (n + 1);
  return day >= 1 ? day : null;
}

function allWeekdays(year, month, weekday) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  const days = [];
  let day = 1 + offset;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  while (day <= last) {
    days.push(day);
    day += 7;
  }
  return days;
}

function expandRRule(ruleStr, base) {
  const rule = parseRRule(ruleStr);
  if (rule.FREQ !== 'YEARLY') return [];

  const baseDate = new Date(`${base}T00:00:00`);
  const months = rule.BYMONTH ? rule.BYMONTH.split(',').map(Number) : [baseDate.getUTCMonth() + 1];
  const until = parseRuleDate(rule.UNTIL);
  const byMonthDay = rule.BYMONTHDAY ? rule.BYMONTHDAY.split(',').map(Number) : null;
  const byDay = rule.BYDAY ? rule.BYDAY.split(',') : null;
  const bySetPos = rule.BYSETPOS ? rule.BYSETPOS.split(',').map(Number) : null;

  const out = [];
  for (let y = START_YEAR; y <= END_YEAR; y++) {
    for (const m of months) {
      let days = [];
      if (byMonthDay) {
        days = byMonthDay;
      } else if (byDay) {
        let tmp = [];
        for (const entry of byDay) {
          const match = entry.match(/(-?\d+)?([A-Z]{2})/);
          if (!match) continue;
          const n = match[1] ? parseInt(match[1], 10) : null;
          const w = WEEKDAYS.indexOf(match[2]);
          if (w === -1) continue;
          if (n) {
            const d = nthWeekday(y, m, w, n);
            if (d) tmp.push(d);
          } else {
            tmp = tmp.concat(allWeekdays(y, m, w));
          }
        }
        tmp.sort((a, b) => a - b);
        if (bySetPos && tmp.length) {
          const selected = [];
          for (const pos of bySetPos) {
            const idx = pos > 0 ? pos - 1 : tmp.length + pos;
            if (idx >= 0 && idx < tmp.length) selected.push(tmp[idx]);
          }
          days = selected;
        } else {
          days = tmp;
        }
      } else {
        days = [baseDate.getUTCDate()];
      }

      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      for (const d of days) {
        if (d < 1 || d > last) continue;
        const iso = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        if (!until || iso <= until) out.push(iso);
      }
    }
  }
  return out;
}

async function fetchHtml(urls) {
  if (!Array.isArray(urls)) urls = [urls];
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.text();
    } catch (e) {
      console.warn(`Failed to fetch ${url}: ${e.message}`);
    }
  }
  return '';
}

async function get1823List() {
  let enRaw = null;
  let zhRaw = null;

  try {
    enRaw = JSON.parse(fs.readFileSync(EN_FILE, 'utf8'));
  } catch (e) {
    console.warn(`Failed to read ${EN_FILE}: ${e.message}`);
  }

  if (fs.existsSync(ZH_FILE)) {
    try {
      zhRaw = JSON.parse(fs.readFileSync(ZH_FILE, 'utf8'));
    } catch (e) {
      console.warn(`Failed to read ${ZH_FILE}: ${e.message}`);
    }
  }

  // The 1823 iCal feed used to return a simple array of events.  In
  // mid-2024 the format changed to a nested object (jCal style).  To
  // remain backwards compatible we extract the actual event list in a
  // more defensive manner.
  const extractEvents = data => {
    if (!data) return [];

    // jCal array format: ['vcalendar', [ ...props ], [ components ]]
    if (Array.isArray(data) && data[0] === 'vcalendar') {
      const components = Array.isArray(data[2]) ? data[2] : [];
      return components
        .filter(c => Array.isArray(c) && c[0] === 'vevent')
        .map(c => {
          const props = Array.isArray(c[1]) ? c[1] : [];
          const obj = {};
          for (const p of props) {
            if (!Array.isArray(p)) continue;
            const [name, , , value] = p;
            if (!name) continue;
            obj[name.toLowerCase()] = value;
          }
          return obj;
        });
    }

    if (Array.isArray(data)) return data;

    // jCal object format: { vcalendar: [ { vevent: [ ... ] } ] }
    if (Array.isArray(data.vcalendar)) {
      const cal = data.vcalendar[0] || {};
      if (Array.isArray(cal.vevent)) return cal.vevent;
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

  const expandDates = item => {
    const base = getDate(item);
    if (!base) return [];
    const dates = new Set([base]);

    const addDates = (val, remove) => {
      if (!val) return;
      const arr = Array.isArray(val) ? val : [val];
      for (const d of arr) {
        const iso = getDate({ date: Array.isArray(d) ? d[0] : d });
        if (!iso) continue;
        if (remove) dates.delete(iso); else dates.add(iso);
      }
    };

    const ruleStr = item.rrule || item.RRULE;
    if (ruleStr) {
      try {
        expandRRule(ruleStr, base).forEach(d => dates.add(d));
      } catch (e) {
        console.warn(`Failed to parse rrule ${ruleStr}: ${e.message}`);
      }
    }

    addDates(item.rdate || item.RDATE, false);
    addDates(item.exdate || item.EXDATE, true);

    return [...dates];
  };

  const map = new Map();
  for (const item of en) {
    const dates = expandDates(item);
    for (const date of dates) {
      const target = map.get(date) || {
        date,
        name_en: '',
        name_zh: '',
        statutory: false,
        source: '1823'
      };
      target.name_en = getName(item, 'en');
      map.set(date, target);
    }
  }
  for (const item of zh) {
    const dates = expandDates(item);
    for (const date of dates) {
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
  let load;
  try {
    ({ load } = await import('cheerio'));
  } catch (e) {
    console.warn(`cheerio not available: ${e.message}`);
    return new Set();
  }
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
