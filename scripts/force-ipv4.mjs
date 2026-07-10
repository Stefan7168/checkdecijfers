// IPv4-force preload for owner-run CBS fetches (lessons-learned sessions 25 +
// 29 + 31: datasets.cbs.nl's IPv6 address black-holes from some local
// networks; node/undici's Happy-Eyeballs fallback does not recover, while
// curl connects over IPv4 in ~1.5s). Prefix any CBS-fetching CLI with
//
//   node --import ./scripts/force-ipv4.mjs <cli> [...args]
//
// (catalog:refresh, ingest sync, fixtures capture, measurefit record). The
// deploy host is unaffected — this is a local-network shim only; it changes
// no committed runtime code.
import net from 'node:net';
import dns from 'node:dns';

net.setDefaultAutoSelectFamily(false);

const originalLookup = dns.lookup;
dns.lookup = function lookup(hostname, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = { family: 4 };
  } else if (typeof options === 'number' || options === undefined || options === null) {
    options = { family: 4 };
  } else {
    options = { ...options, family: 4 };
  }
  return originalLookup.call(this, hostname, options, callback);
};
