#!/usr/bin/env node

import { loadEnvFile, CHROME_UA, runSeed } from './_seed-utils.mjs';

loadEnvFile(import.meta.url);

const KEY = 'market:earnings-calendar:v1';
const TTL = 129600; // 36h — 3× a 12h cron interval

function toDateStr(d) {
  return d.toISOString().slice(0, 10);
}

async function fetchAll() {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) {
    console.warn('  FINNHUB_API_KEY not set — skipping');
    return { earnings: [], unavailable: true };
  }

  const from = new Date();
  // #4922/#4929 review: include the past week so brief consumers can show
  // recent beats/misses — a today-forward window can only ever contain
  // same-day morning reporters.
  from.setDate(from.getDate() - 7);
  const to = new Date();
  to.setDate(to.getDate() + 14);

  const url = `https://finnhub.io/api/v1/calendar/earnings?from=${toDateStr(from)}&to=${toDateStr(to)}`;

  const resp = await fetch(url, {
    headers: { 'User-Agent': CHROME_UA, 'X-Finnhub-Token': apiKey },
    signal: AbortSignal.timeout(15_000),
  });

  if (!resp.ok) {
    throw new Error(`Finnhub earnings calendar HTTP ${resp.status}`);
  }

  const data = await resp.json();
  const raw = Array.isArray(data?.earningsCalendar) ? data.earningsCalendar : [];

  const ranked = raw
    .filter(e => e.symbol)
    .map(e => {
      const epsEst = e.epsEstimate != null ? Number(e.epsEstimate) : null;
      const epsAct = e.epsActual != null ? Number(e.epsActual) : null;
      const revEst = e.revenueEstimate != null ? Number(e.revenueEstimate) : null;
      const revAct = e.revenueActual != null ? Number(e.revenueActual) : null;
      const hasActuals = epsAct != null;
      let surpriseDirection = '';
      if (hasActuals && epsEst != null) {
        if (epsAct > epsEst) surpriseDirection = 'beat';
        else if (epsAct < epsEst) surpriseDirection = 'miss';
      }
      return {
        symbol: String(e.symbol),
        company: e.name ? String(e.name) : String(e.symbol),
        date: e.date ? String(e.date) : '',
        hour: e.hour ? String(e.hour) : '',
        epsEstimate: epsEst,
        revenueEstimate: revEst,
        epsActual: epsAct,
        revenueActual: revAct,
        hasActuals,
        surpriseDirection,
      };
    })
    // Keep companies with meaningful analyst coverage:
    // - revenue estimate > 0 && >= $10M → large/mid-cap (primary filter)
    // - revenue estimate === 0 OR null → pre-revenue (biotech, SPACs) or financial/REIT
    //   with no revenue line — use |EPS| >= $0.05 as proxy for analyst coverage depth
    //   ($0.05 keeps well-covered loss-making companies; $0.10 was too aggressive)
    // - revenue estimate > 0 && < $10M → small-cap / micro-cap → always drop
    .filter(e => {
      if (e.revenueEstimate != null && e.revenueEstimate > 0) return e.revenueEstimate >= 10_000_000;
      if (e.epsEstimate != null) return Math.abs(e.epsEstimate) >= 0.05;
      return false;
    })
    // Within same date, largest companies first; across dates, chronological
    .sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return (b.revenueEstimate ?? 0) - (a.revenueEstimate ?? 0);
    });

  // A CHRONOLOGICAL SORT FOLLOWED BY slice(0, 100) KEEPS THE OLDEST 100.
  // The request window is from-7d to +14d, so the API does return upcoming
  // earnings — and every one of them was being discarded by the cap. The stored
  // calendar held 100 events dated entirely in the PAST WEEK, which is the half
  // that cannot be traded. An earnings calendar that only knows what already
  // happened is not a calendar.
  //
  // Forward events are taken FIRST and only then is the remainder backfilled
  // with recent history, so the cap can no longer silently drop the future.
  const todayET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))
    .toISOString().slice(0, 10);   // ET, not UTC — after 8pm ET a UTC date is tomorrow
  const upcoming = ranked.filter(e => e.date >= todayET);
  const recent = ranked.filter(e => e.date < todayET).reverse();  // most recent first
  const earnings = [...upcoming, ...recent].slice(0, 100);
  console.log(`  ${upcoming.length} upcoming, ${recent.length} recent; kept ${earnings.length}`);

  console.log(`  Fetched ${earnings.length} earnings entries (from ${raw.length} total)`);
  return { earnings, unavailable: false };
}

function validate(data) {
  // >= 3 distinguishes a healthy result from an over-aggressive filter or a near-empty API response
  // Row count alone passed a calendar made entirely of the past. The point of
  // this feed is what is COMING, so at least one forward-dated event is required.
  if (!Array.isArray(data?.earnings) || data.earnings.length < 3) return false;
  const todayET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))
    .toISOString().slice(0, 10);
  return data.earnings.some(e => e.date >= todayET);
}

export function declareRecords(data) {
  return Array.isArray(data?.earnings) ? data.earnings.length : 0;
}

if (process.argv[1]?.endsWith('seed-earnings-calendar.mjs')) {
  runSeed('market', 'earnings-calendar', KEY, fetchAll, {
    validateFn: validate,
    ttlSeconds: TTL,
    sourceVersion: 'finnhub-v1',
  
    declareRecords,
    schemaVersion: 1,
    maxStaleMin: 1440,
  }).catch(err => { console.error('FATAL:', err.message || err); process.exit(1); });
}
