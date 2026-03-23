#!/usr/bin/env node
// Fetches GitHub traffic data and merges into traffic/stats.json
// Usage: GITHUB_TOKEN=xxx node scripts/snapshot-traffic.js [owner/repo]

const https = require('https');
const fs = require('fs');
const path = require('path');

const REPO = process.argv[2] || 'i-dedova/perplexity-research-plugin';
const STATS_PATH = path.join(__dirname, '..', 'traffic', 'stats.json');
const TOKEN = process.env.GITHUB_TOKEN;

if (!TOKEN) {
  console.error('GITHUB_TOKEN is required');
  process.exit(1);
}

function apiGet(endpoint) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.github.com',
      path: `/repos/${REPO}${endpoint}`,
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'User-Agent': 'traffic-snapshot',
        'Accept': 'application/vnd.github+json'
      }
    };
    https.get(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`${endpoint}: HTTP ${res.statusCode} — ${data}`));
        } else {
          resolve(JSON.parse(data));
        }
      });
    }).on('error', reject);
  });
}

function toDateKey(timestamp) {
  return timestamp.slice(0, 10); // "2026-03-09T00:00:00Z" → "2026-03-09"
}

function computeRange(clonesDates, viewsDates) {
  // Determine the 14-day window from the daily data we received
  const allDates = [...clonesDates, ...viewsDates].sort();
  if (allDates.length === 0) return null;
  return `${allDates[0]}..${allDates[allDates.length - 1]}`;
}

async function main() {
  const [clones, views, referrers, paths] = await Promise.all([
    apiGet('/traffic/clones'),
    apiGet('/traffic/views'),
    apiGet('/traffic/popular/referrers'),
    apiGet('/traffic/popular/paths')
  ]);

  // Load existing stats
  let stats = { clones: {}, views: {}, referrers: {}, paths: {} };
  if (fs.existsSync(STATS_PATH)) {
    stats = JSON.parse(fs.readFileSync(STATS_PATH, 'utf8'));
  }

  // Merge daily clones
  const cloneDates = [];
  for (const entry of clones.clones || []) {
    const key = toDateKey(entry.timestamp);
    cloneDates.push(key);
    stats.clones[key] = { count: entry.count, uniques: entry.uniques };
  }

  // Merge daily views
  const viewDates = [];
  for (const entry of views.views || []) {
    const key = toDateKey(entry.timestamp);
    viewDates.push(key);
    stats.views[key] = { count: entry.count, uniques: entry.uniques };
  }

  // Compute range key for aggregate endpoints
  const range = computeRange(cloneDates, viewDates);
  if (range) {
    // Referrers — snapshot as 14-day aggregate
    if (referrers.length > 0) {
      stats.referrers[range] = referrers.map(r => ({
        referrer: r.referrer,
        count: r.count,
        uniques: r.uniques
      }));
    }

    // Paths — snapshot as 14-day aggregate
    if (paths.length > 0) {
      stats.paths[range] = paths.map(p => ({
        path: p.path,
        count: p.count,
        uniques: p.uniques
      }));
    }
  }

  // Sort keys for readability
  for (const section of ['clones', 'views', 'referrers', 'paths']) {
    const sorted = {};
    for (const key of Object.keys(stats[section]).sort()) {
      sorted[key] = stats[section][key];
    }
    stats[section] = sorted;
  }

  // Write
  fs.mkdirSync(path.dirname(STATS_PATH), { recursive: true });
  fs.writeFileSync(STATS_PATH, JSON.stringify(stats, null, 2) + '\n');

  // Summary
  const newClones = cloneDates.length;
  const newViews = viewDates.length;
  console.log(`Updated ${STATS_PATH}`);
  console.log(`  Clones: ${newClones} days merged (${Object.keys(stats.clones).length} total)`);
  console.log(`  Views: ${newViews} days merged (${Object.keys(stats.views).length} total)`);
  console.log(`  Referrers: ${Object.keys(stats.referrers).length} snapshots`);
  console.log(`  Paths: ${Object.keys(stats.paths).length} snapshots`);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
