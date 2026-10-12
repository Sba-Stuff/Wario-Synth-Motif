// One-off: copy share:<code> keys from Redis (Vercel) into the Workers KV
// namespace, keeping each key's remaining TTL. Safe to run more than once.
// Usage (from server/): REDIS_URL=... node scripts/copy-shares-to-kv.mjs out.json
//   then: npx wrangler kv bulk put out.json --binding SHARES --remote
import { createClient } from 'redis';
import { writeFileSync } from 'node:fs';

const out = process.argv[2];
if (!process.env.REDIS_URL || !out) {
  console.error('Usage: REDIS_URL=... node scripts/copy-shares-to-kv.mjs out.json');
  process.exit(1);
}

const client = createClient({ url: process.env.REDIS_URL });
await client.connect();

const entries = [];
for await (const batch of client.scanIterator({ MATCH: 'share:*', COUNT: 500 })) {
  for (const key of [].concat(batch)) {
    const [value, ttl] = await Promise.all([client.get(key), client.ttl(key)]);
    if (value == null || ttl === -2) continue;
    const entry = { key, value };
    // KV needs a TTL of at least 60 seconds; -1 means no expiry.
    if (ttl > 0) entry.expiration_ttl = Math.max(60, ttl);
    entries.push(entry);
  }
}
await client.quit();

writeFileSync(out, JSON.stringify(entries, null, 2));
console.log(`Wrote ${entries.length} share keys to ${out}`);
