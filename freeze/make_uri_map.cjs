// Build uri_map.json for sweep_uri.cjs / lock_metadata.cjs from a CID map. Offline: no network,
// no keypair. Writes nothing unless --out is given; refuses to overwrite an existing file.
//
//   node freeze/make_uri_map.cjs --cids public/metadata-cids-v2.json --gateway https://ipfs.x1forge.xyz
//        [--collection-cid Qm…] [--set 4=Qm…] [--out uri_map.json]
//
//   --cids            {"1": "Qm…", …, "500": "Qm…"} (public/metadata-cids-v2.json = what is on chain today)
//   --gateway         https origin written into every uri (owner decision D1: it is locked forever)
//   --collection-cid  CIDv0 of the pinned collection JSON (adds key "collection")
//   --set N=Qm…       replace one member's CID (e.g. a re-pinned #4); one --set per call
// Prints the map's sha256 and every difference from --cids.

const fs = require("fs");
const K = require("./capy_meta_common.cjs");
const CID_RE = /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/;

function build(cids, gateway, { collectionCid = null, set = null } = {}) {
  const p = [];
  if (!/^https:\/\/[a-z0-9.-]+$/.test(gateway)) p.push(`--gateway must be an https origin without a path, got ${gateway}`);
  const keys = Object.keys(cids);
  for (let n = K.FIRST; n <= K.LAST; n++) if (!CID_RE.test(cids[String(n)] || "")) p.push(`cids["${n}"] missing or not a CIDv0`);
  for (const k of keys) if (!/^[1-9]\d*$/.test(k) || +k > K.LAST) p.push(`cids key "${k}" is not 1..500`);
  if (collectionCid !== null && !CID_RE.test(collectionCid)) p.push("--collection-cid is not a CIDv0");
  let setN = null, setCid = null;
  if (set !== null) {
    const m = /^([1-9]\d*)=(Qm[1-9A-HJ-NP-Za-km-z]{44})$/.exec(set);
    if (!m || +m[1] > K.LAST) p.push("--set must be N=Qm… with N in 1..500"); else { setN = m[1]; setCid = m[2]; }
  }
  if (p.length) throw new Error(p.join("\n  "));
  const out = {};
  for (let n = K.FIRST; n <= K.LAST; n++) out[String(n)] = `${gateway}/ipfs/${String(n) === setN ? setCid : cids[String(n)]}`;
  if (collectionCid) out[K.COLLECTION_KEY] = `${gateway}/ipfs/${collectionCid}`;
  const mp = K.checkMap(out);
  if (mp.length) throw new Error(mp.join("\n  "));
  return out;
}

function main() {
  let a;
  try {
    a = K.parseArgs(process.argv.slice(2), { flags: [], opts: { "--cids": K.V.any, "--gateway": K.V.url, "--collection-cid": K.V.any, "--set": K.V.any, "--out": K.V.any } });
    if (!a.opts["--cids"] || !a.opts["--gateway"]) throw new Error("--cids and --gateway are required");
  } catch (e) { console.error("Refusing:", e.message); process.exit(1); }
  let map;
  const cids = JSON.parse(fs.readFileSync(a.opts["--cids"], "utf8"));
  try { map = build(cids, a.opts["--gateway"], { collectionCid: a.opts["--collection-cid"] ?? null, set: a.opts["--set"] ?? null }); }
  catch (e) { console.error("Refusing:\n  " + e.message); process.exit(1); }
  const text = JSON.stringify(map, null, 2) + "\n";
  const changed = Object.keys(map).filter((k) => k === K.COLLECTION_KEY || !map[k].endsWith("/" + cids[k]));
  console.log(`${Object.keys(map).length} entries; differ from --cids: ${changed.length ? changed.join(",") : "none"}`);
  console.log(`sha256 ${K.sha256Hex(Buffer.from(text))}`);
  if (a.opts["--out"]) {
    if (fs.existsSync(a.opts["--out"])) { console.error(`Refusing: ${a.opts["--out"]} exists (move it away first; this script never overwrites).`); process.exit(1); }
    fs.writeFileSync(a.opts["--out"], text);
    console.log(`wrote ${a.opts["--out"]}`);
  }
}

if (require.main === module) main();
module.exports = { build };
