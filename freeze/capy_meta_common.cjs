// Shared helpers for the Capy Warriors freeze scripts (X1 mainnet). Port of
// rise-phoenix-contract/rise_meta_common.cjs (feat/freeze-cleanup 3dbbed3).
// Pure functions plus read-only RPC helpers. Nothing here signs or sends.
//
// Numbering, everywhere in these scripts (Capy is 1-based on chain, unlike RISE):
//   on-chain name "Capy Warrior #N"  (N = 1..500)
//   = repo file ~/cappy-nft-mint/public/metadata/N.json (what Vercel /api/metadata/N serves)
//   = public/metadata-cids-v2.json key "N" = uri_map.json key "N"
// JSON "name" is "Capy Warrior #N" for N = 1..30 only; #31..#500 carry descriptive names
// ("Capy: Beach — Original") in both the repo and the pinned JSONs. Not an offset.

const { PublicKey } = require("@solana/web3.js");
const crypto = require("crypto"), fs = require("fs");

const DEFAULT_PROGRAM = "6r9HZKQRhDfNnZM4m6TgkcK82Bt6EA1q2Ck9VNWoTnGm";
const MPL = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const EXPECTED_MINT_STATE = "5y1GoGNfruDk9QUszD5UdEn9fjAg6xxDBJfywNu4dGmH";
const OLD_HOST = "capy-nft-mint.vercel.app";
const OLD_BASE = "https://capy-nft-mint.vercel.app/api/metadata/"; // BASE_URI of the old program
// Hosts that must never appear in a URI that gets locked, nor in a locked JSON.
const FORBIDDEN_HOSTS = [OLD_HOST, "vercel.app", "lighthouse.storage", "gateway.pinata.cloud", "mypinata.cloud"];
const MAX_URI_LENGTH = 200; // Metaplex limit (Capy's update_token_uri does not check it itself)
const EXPECTED_MEMBERS = 500;
const FIRST = 1, LAST = 500;
// Parent collection NFT. Read from chain 2026-11-24: update authority = mint_state,
// uri = OLD_BASE + "collection", sized collection, size 500, 500 bps [mint_state:100 verified].
const COLLECTION_MINT = "HC8zqrya22MHNR2JsNkmvr2yqPthDDov1ehDSEUATKbC";
const COLLECTION_METADATA = "Cx6vNq7cr9cx8jkvTP8FFcYtY8c777WCQtZqgvVBYvfW";
const COLLECTION_NAME = "CAPY Warriors"; // on-chain name of the collection NFT
const COLLECTION_KEY = "collection"; // uri_map.json key for the collection NFT
const COLLECTION_OLD_URI = OLD_BASE + "collection";
const NAME_RE = /^Capy Warrior #(\d+)$/;

const mdPda = (mint) =>
  PublicKey.findProgramAddressSync([Buffer.from("metadata"), MPL.toBuffer(), new PublicKey(mint).toBuffer()], MPL)[0];
const mintStatePda = (program) => PublicKey.findProgramAddressSync([Buffer.from("mint_state_v2")], new PublicKey(program))[0];

// ── Strict argument parser ─────────────────────────────────────────────
// spec = { flags: ["--send", ...], opts: { "--token": validatorFn, ... } }
// Unknown arguments, a missing value, a value starting with "--", a repeated option or a
// value that fails its validator → throws. So an empty $VAR refuses instead of defaulting.
function parseArgs(argv, spec) {
  const out = { flags: new Set(), opts: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (spec.flags.includes(a)) { out.flags.add(a); continue; }
    if (a in spec.opts) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) throw new Error(`${a} needs a value`);
      const err = spec.opts[a](v);
      if (err) throw new Error(`${a} ${JSON.stringify(v)}: ${err}`);
      if (a in out.opts) throw new Error(`${a} given twice`);
      out.opts[a] = v;
      i++;
      continue;
    }
    throw new Error(`unknown argument ${JSON.stringify(a)}`);
  }
  return out;
}
const V = {
  tokenNumber: (v) => (/^[1-9]\d*$/.test(v) && +v >= FIRST && +v <= LAST ? null : `must be an integer ${FIRST}..${LAST}`),
  positiveInt: (v) => (/^[1-9]\d*$/.test(v) ? null : "must be a positive integer"),
  nonNegInt: (v) => (/^\d+$/.test(v) ? null : "must be a non-negative integer"),
  bps: (v) => (/^\d+$/.test(v) && String(+v) === v && +v <= 10000 ? null : "must be an integer 0..10000 (basis points)"),
  pubkey: (v) => { try { new PublicKey(v); return null; } catch { return "is not a public key"; } },
  // A royalty creator must be able to sign SignMetadata: a wallet, so on the ed25519 curve.
  walletPubkey: (v) => { try { return PublicKey.isOnCurve(new PublicKey(v).toBuffer()) ? null : "is off curve (a PDA cannot sign SignMetadata)"; } catch { return "is not a public key"; } },
  url: (v) => (/^https?:\/\/\S+$/.test(v) ? null : "must be an http(s) URL"),
  sha256: (v) => (/^[0-9a-f]{64}$/.test(v) ? null : "must be 64 lowercase hex characters"),
  any: (v) => (v.length ? null : "must not be empty"),
};

// ── Royalty target (an ARGUMENT, never a constant: owner's decision) ───
// Every script that checks or sets the royalty takes --bps and --creator, both required.
function royaltyTarget(opts) {
  const p = [];
  if (opts["--bps"] === undefined) p.push("--bps <0..10000> is required (the final royalty is the owner's decision)");
  if (opts["--creator"] === undefined) p.push("--creator <pubkey> is required (the single verified creator, share 100)");
  if (p.length) throw new Error(p.join("; "));
  if (opts["--creator"] === EXPECTED_MINT_STATE) throw new Error("--creator must not be mint_state");
  return { bps: +opts["--bps"], creator: new PublicKey(opts["--creator"]).toBase58() };
}

// ── Metaplex metadata parsing (full layout) ─────────────────────────────
function parseMetadata(d) {
  let o = 0;
  const u8 = () => d[o++];
  const pk = () => { const v = new PublicKey(d.slice(o, o + 32)); o += 32; return v.toBase58(); };
  const str = () => { const n = d.readUInt32LE(o); o += 4; const s = d.slice(o, o + n).toString("utf8").replace(/\0+$/, ""); o += n; return s; };
  const key = u8();
  const ua = pk(), mint = pk();
  const name = str(), symbol = str(), uri = str();
  const fee = d.readUInt16LE(o); o += 2;
  let creators = null;
  if (u8() === 1) {
    const n = d.readUInt32LE(o); o += 4;
    creators = [];
    for (let i = 0; i < n; i++) creators.push({ address: pk(), verified: u8() === 1, share: u8() });
  }
  const primarySaleHappened = u8() === 1;
  const isMutable = u8() === 1;
  const editionNonce = u8() === 1 ? u8() : null;
  const tokenStandard = u8() === 1 ? u8() : null;
  const collection = u8() === 1 ? { verified: u8() === 1, key: pk() } : null;
  let uses = null;
  if (u8() === 1) { uses = { method: u8(), remaining: d.readBigUInt64LE(o).toString(), total: d.readBigUInt64LE(o + 8).toString() }; o += 16; }
  // collection_details + programmable_config + padding: compared as raw bytes
  const tail = d.slice(o).toString("hex");
  return { key, ua, mint, name, symbol, uri, fee, creators, primarySaleHappened, isMutable, editionNonce, tokenStandard, collection, uses, tail };
}
const num = (m) => { const x = NAME_RE.exec(m.name); return x ? +x[1] : -1; };
const fingerprint = (m, ...ignore) => { const c = { ...m }; for (const k of ignore) delete c[k]; return JSON.stringify(c); };
const isMember = (m, mintState) =>
  m.ua === mintState && num(m) >= FIRST && num(m) <= LAST && !!m.collection && m.collection.verified && m.collection.key === COLLECTION_MINT;

// ── Discovery (RISE finding S2) ─────────────────────────────────────────
// Keep only metadata whose collection is VERIFIED and equals COLLECTION_MINT (verifying
// needs mint_state's signature, so a stranger cannot fake one). Then require exactly 500,
// numbered 1..500 with no gaps or duplicates, each at its mint's metadata PDA.
// A holder burning one NFT makes this refuse (RISE audit L1 / D4): stop and ask, by design.
async function discover(c, mintState) {
  const ms = mintState.toBase58();
  const accs = await c.getProgramAccounts(MPL, { filters: [{ memcmp: { offset: 1, bytes: ms } }] });
  const all = accs.map((a) => ({ pda: a.pubkey.toBase58(), ...parseMetadata(a.account.data) }));
  const members = all.filter((m) => isMember(m, ms)).sort((a, b) => num(a) - num(b));
  const ignored = all.filter((m) => !isMember(m, ms) && m.pda !== COLLECTION_METADATA);
  const nums = members.map(num);
  const problems = [];
  if (members.length !== EXPECTED_MEMBERS) problems.push(`found ${members.length} verified members of ${COLLECTION_MINT}, expected exactly ${EXPECTED_MEMBERS}`);
  const dupes = nums.filter((n, i) => nums.indexOf(n) !== i);
  if (dupes.length) problems.push(`duplicate verified token numbers: ${[...new Set(dupes)].join(",")}`);
  const missing = [];
  for (let n = FIRST; n <= LAST; n++) if (!nums.includes(n)) missing.push(n);
  if (missing.length) problems.push(`missing token numbers: ${missing.slice(0, 20).join(",")}`);
  for (const m of members) if (m.pda !== mdPda(m.mint).toBase58()) problems.push(`#${num(m)} metadata ${m.pda} is not the PDA of mint ${m.mint}`);
  const collAcc = await c.getAccountInfo(new PublicKey(COLLECTION_METADATA));
  let collection = null;
  if (!collAcc) problems.push(`collection metadata ${COLLECTION_METADATA} not found`);
  else {
    collection = { pda: COLLECTION_METADATA, ...parseMetadata(collAcc.data) };
    if (collection.mint !== COLLECTION_MINT) problems.push(`collection metadata mint is ${collection.mint}`);
    if (collection.ua !== ms) problems.push(`collection update authority is ${collection.ua}, not mint_state`);
    if (collection.name !== COLLECTION_NAME) problems.push(`collection name is ${JSON.stringify(collection.name)}`);
    if (mdPda(COLLECTION_MINT).toBase58() !== COLLECTION_METADATA) problems.push("COLLECTION_METADATA is not the PDA of COLLECTION_MINT");
  }
  if (problems.length) throw new Error("discovery failed:\n  " + problems.join("\n  "));
  return { members, collection, ignored };
}

// ── Read-back with retries (RISE finding S6) ────────────────────────────
async function readBack(c, pda, landed, same, { tries = 6, delayMs = 1500 } = {}) {
  let last = null;
  for (let i = 1; i <= tries; i++) {
    const acc = await c.getAccountInfo(new PublicKey(pda), "confirmed").catch(() => null);
    if (acc) {
      last = parseMetadata(acc.data);
      if (landed(last)) return { ok: same(last), after: last, tries: i };
    }
    if (i < tries) await new Promise((r) => setTimeout(r, delayMs * i));
  }
  return { ok: false, after: last, tries, notLanded: true };
}

// ── Royalty (target state + what a token still needs) ──────────────────
const royaltyIsFinal = (m, t) =>
  m.fee === t.bps && Array.isArray(m.creators) && m.creators.length === 1 &&
  m.creators[0].address === t.creator && m.creators[0].share === 100 && m.creators[0].verified === true;

// One transaction per token: update_royalty → [SignMetadata(target)].
//   update: bps or creator list differ from [target:100].
//   sign:   the target is not verified after the update (a new creator starts unverified;
//           an already-verified target keeps its flag through update_royalty).
//   A verified creator other than the target and mint_state would have to un-verify itself
//   first (Metaplex 55). Capy has no such creator today and no keypair is supported for one,
//   so such a token is BLOCKED (the RISE Gowv5 path is not needed and not ported).
function royaltyPlan(m, mintState, t) {
  const c = m.creators || [];
  if (royaltyIsFinal(m, t)) return { done: true, update: false, sign: false, blocked: null };
  const listOk = c.length === 1 && c[0].address === t.creator && c[0].share === 100;
  const update = m.fee !== t.bps || !listOk;
  const others = update ? c.filter((x) => x.verified && x.address !== t.creator && x.address !== mintState).map((x) => x.address) : [];
  const sign = !c.some((x) => x.address === t.creator && x.verified);
  let blocked = null;
  if (!m.isMutable) blocked = "locked (is_mutable false) and not at the target royalty: can never be fixed";
  else if (others.length) blocked = `verified creator(s) ${others.join(",")} would have to un-verify themselves first (Metaplex 55); not supported`;
  return { done: false, update, sign, blocked };
}

// ── Map sha256 record (RISE audit L3) ───────────────────────────────────
const sha256Hex = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const sha256File = (p) => sha256Hex(fs.readFileSync(p));
const recordPath = (mapPath) => mapPath + ".verified.json";
function writeVerifyRecord(mapPath, scope, info) {
  const rp = recordPath(mapPath);
  const rec = fs.existsSync(rp) ? JSON.parse(fs.readFileSync(rp, "utf8")) : {};
  rec[scope] = { map_sha256: sha256File(mapPath), verified_at: new Date().toISOString(), ...info };
  fs.writeFileSync(rp, JSON.stringify(rec, null, 2) + "\n");
  return rec[scope];
}
function checkVerifyRecord(mapPath, scopes, wantSha) {
  const p = [];
  const have = sha256File(mapPath);
  if (!/^[0-9a-f]{64}$/.test(wantSha || "")) p.push("--map-sha256 must be the 64-hex sha256 recorded after the passing --verify (sha256sum uri_map.json)");
  else if (have !== wantSha) p.push(`map file sha256 is ${have}, --map-sha256 says ${wantSha}: the map changed since it was recorded`);
  const rp = recordPath(mapPath);
  const rec = fs.existsSync(rp) ? JSON.parse(fs.readFileSync(rp, "utf8")) : {};
  for (const s of scopes) {
    if (!rec[s]) p.push(`no passing sweep_uri.cjs --verify recorded for ${s} in ${rp}`);
    else if (rec[s].map_sha256 !== have) p.push(`${s} was verified against map sha256 ${rec[s].map_sha256}, the map is now ${have}: run --verify again`);
  }
  return p;
}

// ── uri map ─────────────────────────────────────────────────────────────
// {"1": uri, ..., "500": uri, "collection": uri}. Key "collection" optional.
const hostOf = (u) => { try { return new URL(u).host; } catch { return ""; } };
const forbiddenHost = (s) => FORBIDDEN_HOSTS.find((h) => String(s).includes(h)) || null;
function checkMap(raw) {
  const problems = [];
  if (typeof raw !== "object" || Array.isArray(raw) || raw === null) return ['expected a JSON object {"N": "uri"}'];
  const seen = new Map();
  for (const [k, v] of Object.entries(raw)) {
    if (k !== COLLECTION_KEY && (!/^[1-9]\d*$/.test(k) || +k < FIRST || +k > LAST)) problems.push(`key "${k}": not a token number ${FIRST}..${LAST} or "${COLLECTION_KEY}"`);
    if (typeof v !== "string" || v.length === 0) { problems.push(`${k}: empty or non-string uri`); continue; }
    const bytes = Buffer.byteLength(v, "utf8");
    if (bytes > MAX_URI_LENGTH) problems.push(`${k}: uri is ${bytes} bytes, Metaplex limit is ${MAX_URI_LENGTH}`);
    if (v !== v.trim()) problems.push(`${k}: uri has leading/trailing whitespace`);
    const fh = forbiddenHost(v);
    if (fh) problems.push(`${k}: uri points at ${fh}`);
    if (!/^https:\/\/[^/]+\/ipfs\/Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(v)) problems.push(`${k}: uri must be https://<gateway>/ipfs/<CIDv0> (got ${v})`);
    if (seen.has(v)) problems.push(`${k}: same uri as ${seen.get(v)}`);
    seen.set(v, k);
  }
  const hosts = new Set(Object.values(raw).filter((v) => typeof v === "string").map(hostOf));
  if (hosts.size > 1) problems.push(`more than one gateway host in the map: ${[...hosts].join(", ")}`);
  return problems;
}
const cidOfUri = (u) => { const m = /\/ipfs\/(Qm[1-9A-HJ-NP-Za-km-z]{44})$/.exec(u); return m ? m[1] : null; };

// Recursive field-for-field diff. Returns a list of "path: a != b".
function jsonDiff(a, b, path = "") {
  if (a === b) return [];
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object" || Array.isArray(a) !== Array.isArray(b))
    return [`${path || "."}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out = [];
  for (const k of keys) out.push(...jsonDiff(a[k], b[k], path ? `${path}.${k}` : k));
  return out;
}

// ── CIDv0, as `ipfs add --cid-version 0 [--chunker=size-N]` (kubo defaults: balanced layout,
// dag-pb leaves, no raw leaves). Single chunk: one dag-pb node; up to 174 chunks: one root with
// links (checked against the ipfs CLI for 256 KiB and 1 MiB chunks in the offline tests).
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58(buf) {
  let n = BigInt("0x" + (buf.toString("hex") || "0")), s = "";
  while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const b of buf) { if (b !== 0) break; s = "1" + s; }
  return s;
}
function varint(n) { const o = []; while (n >= 0x80) { o.push((n & 0x7f) | 0x80); n = Math.floor(n / 128); } o.push(n); return Buffer.from(o); }
const pbField = (tag, b) => Buffer.concat([Buffer.from([tag]), varint(b.length), b]);
const multihash = (node) => Buffer.concat([Buffer.from([0x12, 0x20]), crypto.createHash("sha256").update(node).digest()]);
const leafNode = (chunk) => pbField(0x0a, Buffer.concat([Buffer.from([0x08, 0x02]), pbField(0x12, chunk), Buffer.from([0x18]), varint(chunk.length)]));
const CHUNK_256K = 262144, CHUNK_1M = 1048576;
function cidV0(bytes, chunk = CHUNK_256K) {
  if (!bytes.length) throw new Error("empty file");
  if (bytes.length <= chunk) return b58(multihash(leafNode(bytes)));
  const links = [], sizes = [];
  for (let o = 0; o < bytes.length; o += chunk) {
    const c = bytes.slice(o, o + chunk), node = leafNode(c);
    links.push(pbField(0x12, Buffer.concat([pbField(0x0a, multihash(node)), Buffer.from([0x12, 0x00, 0x18]), varint(node.length)])));
    sizes.push(Buffer.concat([Buffer.from([0x20]), varint(c.length)]));
  }
  if (links.length > 174) throw new Error(`${links.length} chunks: more than one tree level, not supported`);
  const unixfs = Buffer.concat([Buffer.from([0x08, 0x02, 0x18]), varint(bytes.length), ...sizes]);
  return b58(multihash(Buffer.concat([...links, pbField(0x0a, unixfs)])));
}
// Does `bytes` hash to `cid`? The member art was added with 1 MiB chunks (MANIFEST.md); the
// collection image may be either. A CID is a hash of the whole DAG, so a match proves the bytes are
// exactly the file. Returns "1MiB" / "256KiB" or null.
function cidMatch(bytes, cid) {
  if (!bytes || !bytes.length || !CID_RE.test(cid || "")) return null;
  if (cidV0(bytes, CHUNK_1M) === cid) return "1MiB";
  if (bytes.length > CHUNK_256K && cidV0(bytes, CHUNK_256K) === cid) return "256KiB";
  return null;
}

// ── What gets pinned (owner decision 2026-11-24, follow-up 1) ───────────
// Members: the repo file public/metadata/N.json, parsed, with only `image` moved to
// <gateway>/ipfs/<same CID>, serialised as JSON.stringify(x, null, 2) (no trailing newline).
// This is exactly how the 500 JSONs on chain today were made (rewrite-metadata.cjs): 499/500
// of them rebuild byte for byte from main's files (all but #4, whose fix was never pinned).
// Collection: public/metadata/collection.json (its image is already on the gateway), parsed and
// serialised the same way. So pinned bytes and repo file differ only in the image host and in
// JSON formatting (e.g. "\u2014" escapes in #4, #398 and collection.json become "—").
const EXTERNAL_URL = "https://x1forge.xyz/collection/capy";
const DEFAULT_GATEWAY = "https://ipfs.x1forge.xyz";
const CID_RE = /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/;
function pinnedMemberBytes(repoBytes, gateway = DEFAULT_GATEWAY) {
  const r = JSON.parse(Buffer.isBuffer(repoBytes) ? repoBytes.toString("utf8") : repoBytes);
  const cid = typeof r.image === "string" ? r.image.split("/").pop() : "";
  if (!CID_RE.test(cid)) throw new Error(`image ${JSON.stringify(r.image)} does not end in a CIDv0`);
  const o = {};
  for (const [k, v] of Object.entries(r)) o[k] = k === "image" ? `${gateway}/ipfs/${cid}` : v;
  return Buffer.from(JSON.stringify(o, null, 2));
}
function pinnedCollectionBytes(repoBytes) {
  return Buffer.from(JSON.stringify(JSON.parse(Buffer.isBuffer(repoBytes) ? repoBytes.toString("utf8") : repoBytes), null, 2));
}

module.exports = {
  DEFAULT_PROGRAM, MPL, EXPECTED_MINT_STATE, OLD_HOST, OLD_BASE, FORBIDDEN_HOSTS, MAX_URI_LENGTH, EXPECTED_MEMBERS, FIRST, LAST,
  COLLECTION_MINT, COLLECTION_METADATA, COLLECTION_NAME, COLLECTION_KEY, COLLECTION_OLD_URI, NAME_RE,
  royaltyTarget, royaltyIsFinal, royaltyPlan, sha256Hex, sha256File, recordPath, writeVerifyRecord, checkVerifyRecord,
  mdPda, mintStatePda, parseArgs, V, parseMetadata, num, fingerprint, isMember, discover, readBack,
  checkMap, cidOfUri, hostOf, forbiddenHost, jsonDiff, cidV0, cidMatch, CHUNK_256K, CHUNK_1M, CID_RE,
  EXTERNAL_URL, DEFAULT_GATEWAY, pinnedMemberBytes, pinnedCollectionBytes,
};
