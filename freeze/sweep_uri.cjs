// Point Capy Warriors on-chain metadata URIs at the final pinned JSONs, via the program's
// authority-gated `update_token_uri`, and verify them. Port of RISE sweep_uri.cjs (3dbbed3).
//
//   node freeze/sweep_uri.cjs --rpc $RPC --map uri_map.json                    dry-run, all 500 members
//   node freeze/sweep_uri.cjs --rpc $RPC --map uri_map.json --token 4          dry-run, one member
//   node freeze/sweep_uri.cjs --rpc $RPC --map uri_map.json --token 4 --send --confirm-mainnet   PILOT
//   node freeze/sweep_uri.cjs --rpc $RPC --map uri_map.json --send --confirm-mainnet             members still off target
//   node freeze/sweep_uri.cjs --rpc $RPC --map uri_map.json --collection [--send --confirm-mainnet]
//   node freeze/sweep_uri.cjs --rpc $RPC --map uri_map.json --verify                              read-only, all 500
//   node freeze/sweep_uri.cjs --rpc $RPC --map uri_map.json --verify --collection
//
// Map file (freeze/pin_metadata.cjs writes it from verified pins; freeze/make_uri_map.cjs rebuilds it offline):
//   {"1": "https://ipfs.x1forge.xyz/ipfs/Qm…", …, "500": "…", "collection": "…"}
// Numbering: on-chain "Capy Warrior #N" = map key "N" = repo file public/metadata/N.json.
//
// After the follow-up-1 content change (external_url, names, #4) every member URI changes: the sweep
// moves all 500 members and the collection NFT to the map that pin_metadata.cjs writes.
// There is no --revert (RISE had one, to its Vercel URIs): the undo before a lock is this same
// script with the previous map (e.g. one rebuilt from metadata-cids-v2.json).
//
// Options: --program <id>, --authority-keypair <path> (default ~/.config/solana/capy-mint-authority.json;
//          it must be mint_state.authority 2EMb…, checked), --limit <n>, --priority <µLamports/CU>,
//          --json-dir <dir> (verify; default ~/cappy-nft-mint/public/metadata; holds N.json and collection.json)
//
// Safety:
//   * --rpc is required. Dry-run is the default and never reads a keypair file.
//   * --send without --confirm-mainnet refuses. Unknown, repeated or malformed arguments refuse.
//   * Members are only those whose collection is VERIFIED = HC8zqrya…; exactly 500, numbered 1..500.
//   * Tokens already on their target URI are skipped. Locked tokens off target refuse the run.
//   * After each send the account is read back (retried): uri must equal the target and every
//     other field (including the raw trailing bytes) must equal its pre-send value. Else exit 2.
//   * --verify, per member (real GET requests):
//       - on-chain uri == map;
//       - the served bytes hash to the CIDv0 in the uri (the gateway served the pinned content);
//       - the served bytes EQUAL K.pinnedMemberBytes(repo file public/metadata/N.json) byte for byte:
//         the repo file with only `image` moved to the map's gateway (same CID), JSON.stringify(x,null,2);
//       - JSON name "Capy Warrior #N", external_url https://x1forge.xyz/collection/capy, no Vercel /
//         Lighthouse / pinata.cloud string; the image downloads in full with an image/* content type.
//     --verify --collection: served bytes EQUAL K.pinnedCollectionBytes(<json-dir>/collection.json) byte
//     for byte (RISE audit L5) and hash to the uri's CID; same host and image checks.
//   * A FULL passing --verify (all 500 members, or --collection) records the map's sha256 in
//     <map>.verified.json; lock_metadata.cjs refuses without it (RISE audit L3).

const { Connection, PublicKey, Keypair, Transaction, TransactionInstruction, ComputeBudgetProgram, sendAndConfirmTransaction } = require("@solana/web3.js");
const crypto = require("crypto"), fs = require("fs"), path = require("path");
const K = require("./capy_meta_common.cjs");

function loadMap(p) {
  const raw = JSON.parse(fs.readFileSync(p, "utf8"));
  const problems = K.checkMap(raw);
  if (problems.length) {
    console.error(`map ${p} rejected (${problems.length} problems):`);
    problems.slice(0, 40).forEach((x) => console.error("  " + x));
    process.exit(1);
  }
  return raw;
}

const DISC = crypto.createHash("sha256").update("global:update_token_uri").digest().slice(0, 8);
function updateTokenUriIx(program, mintState, authority, mint, uri) {
  const uriBuf = Buffer.from(uri, "utf8");
  const len = Buffer.alloc(4); len.writeUInt32LE(uriBuf.length);
  return new TransactionInstruction({
    programId: new PublicKey(program),
    keys: [
      { pubkey: new PublicKey(mintState), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(authority), isSigner: true, isWritable: false },
      { pubkey: K.mdPda(mint), isSigner: false, isWritable: true },
      { pubkey: K.MPL, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([DISC, len, uriBuf]),
  });
}

// ── HTTP (verify) ──────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url, timeoutMs, tries = 3) {
  let lastErr;
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
      if (res.status >= 300 && res.status < 400) throw new Error(`HTTP ${res.status} redirect -> ${res.headers.get("location")}`);
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (e) { lastErr = e; if (i < tries) await sleep(1000 * i); }
  }
  throw lastErr;
}
async function getBytes(url) {
  const res = await get(url, 30000);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

// Pure check of a served member JSON against the repo file (bytes). Returns a list of problems.
function checkMemberJson(n, servedBytes, uri, repoBytes) {
  const p = [];
  const cid = K.cidOfUri(uri);
  if (K.cidV0(servedBytes) !== cid) p.push(`served bytes hash to ${K.cidV0(servedBytes)}, uri says ${cid}`);
  let meta;
  try { meta = JSON.parse(servedBytes.toString("utf8")); } catch { return [...p, "served bytes are not JSON"]; }
  const fh = K.forbiddenHost(servedBytes.toString("utf8"));
  if (fh) p.push(`JSON mentions ${fh}`);
  if (meta.name !== `Capy Warrior #${n}`) p.push(`JSON name is ${JSON.stringify(meta.name)}, want "Capy Warrior #${n}"`);
  if (meta.external_url !== K.EXTERNAL_URL) p.push(`external_url is ${JSON.stringify(meta.external_url)}, want ${JSON.stringify(K.EXTERNAL_URL)}`);
  if (!repoBytes) { p.push(`no repo file for #${n}`); return p; }
  const host = K.hostOf(uri);
  let want;
  try { want = K.pinnedMemberBytes(repoBytes, `https://${host}`); } catch (e) { return [...p, `repo file: ${e.message}`]; }
  if (!servedBytes.equals(want)) {
    const diffs = K.jsonDiff(JSON.parse(want.toString("utf8")), meta);
    p.push(`served bytes != pinned form of repo public/metadata/${n}.json` + (diffs.length ? `: ${diffs.slice(0, 3).join("; ")}${diffs.length > 3 ? ` (+${diffs.length - 3})` : ""}` : " (formatting differs)"));
  }
  return p;
}
// Pure check of the served collection JSON against the repo collection.json (bytes).
function checkCollectionJson(servedBytes, uri, repoBytes) {
  const p = [];
  if (!repoBytes) return ["no repo collection.json"];
  const want = K.pinnedCollectionBytes(repoBytes);
  if (!servedBytes.equals(want)) p.push(`served bytes (sha256 ${K.sha256Hex(servedBytes)}) != pinned form of repo collection.json (sha256 ${K.sha256Hex(want)})`);
  if (K.cidV0(servedBytes) !== K.cidOfUri(uri)) p.push(`served bytes hash to ${K.cidV0(servedBytes)}, uri says ${K.cidOfUri(uri)}`);
  let meta;
  try { meta = JSON.parse(servedBytes.toString("utf8")); } catch { return [...p, "served bytes are not JSON"]; }
  const fh = K.forbiddenHost(servedBytes.toString("utf8"));
  if (fh) p.push(`collection JSON mentions ${fh}`);
  if (meta.external_url !== K.EXTERNAL_URL) p.push(`collection external_url ${JSON.stringify(meta.external_url)}`);
  const host = K.hostOf(uri);
  if (typeof meta.image !== "string" || !meta.image.startsWith(`https://${host}/ipfs/`)) p.push(`collection image ${JSON.stringify(meta.image)} is not on https://${host}/ipfs/`);
  for (const f of (meta.properties && meta.properties.files) || []) if (f && f.uri !== meta.image) p.push(`properties.files uri ${f.uri} != image`);
  return p;
}
async function checkImage(url) {
  if (typeof url !== "string" || !url.startsWith("https://")) return `image is not https: ${url}`;
  const res = await get(url, 180000);
  if (!res.ok) return `image HTTP ${res.status} ${url}`;
  const body = Buffer.from(await res.arrayBuffer()); // full download, not a HEAD or Range probe
  const ct = res.headers.get("content-type") || "";
  if (!body.length) return "image is empty";
  if (!ct.startsWith("image/")) return `image content-type "${ct}"`;
  return null;
}

async function main() {
  let a;
  try {
    a = K.parseArgs(process.argv.slice(2), {
      flags: ["--send", "--confirm-mainnet", "--verify", "--collection"],
      opts: {
        "--rpc": K.V.url, "--map": K.V.any, "--token": K.V.tokenNumber, "--limit": K.V.positiveInt, "--program": K.V.pubkey,
        "--priority": K.V.nonNegInt, "--authority-keypair": K.V.any, "--json-dir": K.V.any,
      },
    });
  } catch (e) { console.error("Refusing:", e.message); process.exit(1); }
  const has = (f) => a.flags.has(f);
  const SEND = has("--send"), VERIFY = has("--verify"), COLL = has("--collection");
  const ONLY_TOKEN = a.opts["--token"] !== undefined ? +a.opts["--token"] : null;
  const LIMIT = a.opts["--limit"] !== undefined ? +a.opts["--limit"] : 0;
  if (SEND && !has("--confirm-mainnet")) { console.error("Refusing: --send on mainnet requires --confirm-mainnet as well."); process.exit(1); }
  if (!a.opts["--rpc"]) { console.error("Refusing: --rpc <url> is required (no default cluster)."); process.exit(1); }
  if (!a.opts["--map"]) { console.error("Refusing: --map <file> is required."); process.exit(1); }
  if (SEND && VERIFY) { console.error("Refusing: --verify is read-only; it cannot be combined with --send."); process.exit(1); }
  if (COLL && ONLY_TOKEN !== null) { console.error("Refusing: --collection and --token are exclusive."); process.exit(1); }
  const RPC = a.opts["--rpc"], MAP_PATH = a.opts["--map"];
  const PROGRAM = new PublicKey(a.opts["--program"] || K.DEFAULT_PROGRAM);
  const PRIORITY = a.opts["--priority"] !== undefined ? +a.opts["--priority"] : 1_000_000;
  const AUTH_KP = a.opts["--authority-keypair"] || process.env.HOME + "/.config/solana/capy-mint-authority.json";
  const JSON_DIR = a.opts["--json-dir"] || path.join(process.env.HOME, "cappy-nft-mint/public/metadata");

  const map = loadMap(MAP_PATH);
  const MINT_STATE = K.mintStatePda(PROGRAM);
  const label = (m) => (m.pda === K.COLLECTION_METADATA ? "collection" : `#${K.num(m)}`);
  const keyOf = (m) => (m.pda === K.COLLECTION_METADATA ? K.COLLECTION_KEY : String(K.num(m)));

  const c = new Connection(RPC, "confirmed");
  console.log(`rpc       : ${RPC}\nprogram   : ${PROGRAM.toBase58()}\nmint_state: ${MINT_STATE.toBase58()}`);
  console.log(`target    : map ${MAP_PATH} (${Object.keys(map).length} entries, sha256 ${K.sha256File(MAP_PATH)})`);
  console.log(`scope     : ${COLL ? "collection NFT only" : ONLY_TOKEN !== null ? `member #${ONLY_TOKEN}` : "all 500 members"}`);
  console.log(`mode      : ${VERIFY ? "VERIFY (read-only)" : SEND ? "SEND" : "DRY-RUN (nothing is signed or sent)"}\n`);

  const ms = await c.getAccountInfo(MINT_STATE);
  if (!ms) throw new Error("mint_state account not found on this cluster");
  const authority = new PublicKey(ms.data.slice(12, 44));
  console.log(`authority : ${authority.toBase58()} (from mint_state)`);
  const { members, collection, ignored } = await K.discover(c, MINT_STATE);
  console.log(`discovered ${members.length} verified members of ${K.COLLECTION_MINT} + the collection NFT` +
    (ignored.length ? ` (${ignored.length} other account(s) naming mint_state as update authority ignored)` : ""));

  const items = COLL ? [collection] : ONLY_TOKEN !== null ? members.filter((m) => K.num(m) === ONLY_TOKEN) : members;
  const missing = items.filter((m) => !map[keyOf(m)]);
  if (missing.length) { console.error(`no uri in the map for: ${missing.map(label).slice(0, 20).join(",")}`); process.exit(1); }

  if (VERIFY) {
    let ok = 0, wrongUri = 0, bad = 0;
    const problems = [];
    const collFile = path.join(JSON_DIR, "collection.json");
    const localColl = COLL && fs.existsSync(collFile) ? fs.readFileSync(collFile) : null;
    for (const m of items) {
      const k = keyOf(m), want = map[k], tag = label(m);
      if (m.uri !== want) { wrongUri++; problems.push(`${tag} on-chain uri=${m.uri} (want ${want})`); continue; }
      try {
        const served = await getBytes(want);
        let p;
        if (k === K.COLLECTION_KEY) p = checkCollectionJson(served, want, localColl);
        else {
          const f = path.join(JSON_DIR, `${k}.json`);
          const repo = fs.existsSync(f) ? fs.readFileSync(f) : null;
          p = checkMemberJson(+k, served, want, repo);
          if (!m.collection || m.collection.key !== K.COLLECTION_MINT || !m.collection.verified) p.push("collection not verified on-chain");
        }
        if (!p.length) { const ip = await checkImage(JSON.parse(served.toString("utf8")).image); if (ip) p.push(ip); }
        if (p.length) { bad++; problems.push(...p.map((x) => `${tag} ${x}`)); }
        else { ok++; process.stdout.write(`\r${tag} ok  ${m.isMutable ? "mutable" : "LOCKED"}   (${ok}/${items.length})      `); }
      } catch (e) { bad++; problems.push(`${tag} ${e.message}`); }
      await sleep(100);
    }
    console.log(`\n\n${items.length} checked: ${ok} fully ok, ${wrongUri} wrong uri on-chain, ${bad} with problems`);
    if (problems.length) { console.log("\nproblems:"); problems.slice(0, 60).forEach((p) => console.log("  " + p)); process.exit(1); }
    const scope = COLL ? "collection" : ONLY_TOKEN === null && items.length === K.EXPECTED_MEMBERS ? "members" : null;
    if (scope) {
      const extra = COLL ? { collection_json_sha256: K.sha256Hex(localColl), json_dir: JSON_DIR } : { json_dir: JSON_DIR };
      const r = K.writeVerifyRecord(MAP_PATH, scope, { checked: items.length, rpc: RPC, ...extra });
      console.log(`\nrecorded: ${K.recordPath(MAP_PATH)} ${scope} map_sha256 ${r.map_sha256}`);
      console.log(`lock_metadata.cjs needs --map-sha256 ${r.map_sha256}`);
    } else console.log("\n(partial run: nothing recorded for lock_metadata.cjs)");
    return;
  }

  let pending = [];
  const locked = [];
  for (const m of items) {
    const want = map[keyOf(m)];
    const action = m.uri === want ? "ok (skip)" : m.isMutable ? "UPDATE" : "LOCKED";
    if (action !== "ok (skip)" || items.length === 1) console.log(`${label(m).padStart(10)}  ${m.mint.padEnd(44)}  ${m.uri.slice(0, 60).padEnd(60)} -> ${want}  ${action}`);
    if (action === "UPDATE") pending.push({ m, want });
    if (action === "LOCKED") locked.push(m);
  }
  if (locked.length) { console.error(`\nRefusing: ${locked.length} target(s) are locked (is_mutable = false) and not on their target uri: ${locked.map(label).slice(0, 20).join(",")}`); process.exit(1); }
  console.log(`\n${items.length} target(s): ${items.length - pending.length} already on target, ${pending.length} to update`);
  if (LIMIT && pending.length > LIMIT) { pending = pending.slice(0, LIMIT); console.log(`--limit ${LIMIT}: only processing the first ${LIMIT}`); }
  if (!pending.length) return;

  const buildTx = (auth, m, uri) => {
    const tx = new Transaction()
      .add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY }))
      .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 }))
      .add(updateTokenUriIx(PROGRAM, MINT_STATE, auth, m.mint, uri));
    tx.feePayer = auth;
    return tx;
  };

  if (!SEND) {
    const { m, want } = pending[0];
    const tx = buildTx(authority, m, want);
    tx.recentBlockhash = (await c.getLatestBlockhash()).blockhash;
    const sim = await c.simulateTransaction(tx).catch((e) => ({ value: { err: e.message, logs: [] } }));
    console.log(`\nsimulation of ${label(m)}: ${sim.value.err ? "FAILS " + JSON.stringify(sim.value.err) : `ok (${sim.value.unitsConsumed} CU)`}`);
    if (sim.value.err) (sim.value.logs || []).slice(-6).forEach((l) => console.log("   " + l));
    console.log("\nDry run. Nothing sent. Add --send --confirm-mainnet to execute.");
    return;
  }

  const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(AUTH_KP))));
  if (!kp.publicKey.equals(authority)) throw new Error(`${AUTH_KP} is ${kp.publicKey.toBase58()}, not mint_state.authority ${authority.toBase58()}`);
  console.log(`\nsigning as ${kp.publicKey.toBase58()}\nsending ${pending.length} transaction(s) to ${RPC}…\n`);
  let sent = 0, failed = 0;
  const failures = [];
  for (const { m, want } of pending) {
    process.stdout.write(`${label(m).padStart(10)} … `);
    let sig;
    try {
      sig = await sendAndConfirmTransaction(c, buildTx(kp.publicKey, m, want), [kp], { commitment: "confirmed" });
    } catch (e) {
      console.log(`FAILED — ${e.message.split("\n")[0].slice(0, 140)}`);
      failed++; failures.push({ tag: label(m), error: e.message });
      await sleep(400);
      continue;
    }
    const rb = await K.readBack(c, m.pda, (x) => x.uri === want, (x) => K.fingerprint(x, "uri") === K.fingerprint(m, "uri", "pda"));
    if (!rb.ok) {
      console.log(`${sig}\n\nSTOP: post-send check failed for ${label(m)}${rb.notLanded ? ` (new uri not visible after ${rb.tries} reads; re-run to re-check)` : " (a field other than uri changed)"}.`);
      console.log("before:", JSON.stringify(m));
      console.log("after :", JSON.stringify(rb.after));
      process.exit(2);
    }
    console.log(sig);
    sent++;
    await sleep(400);
  }
  console.log(`\nsent: ${sent}   failed: ${failed}`);
  if (failures.length) {
    console.log("failures (re-run the same command to retry only these):");
    failures.slice(0, 20).forEach((f) => console.log(`  ${f.tag}  ${f.error.split("\n")[0].slice(0, 100)}`));
    process.exit(1);
  }
  console.log(`\nAll sent. Next: node freeze/sweep_uri.cjs --rpc $RPC --map ${MAP_PATH} --verify${COLL ? " --collection" : ""}`);
}

if (require.main === module) main().catch((e) => { console.error("ERR", e.message); process.exit(1); });
module.exports = { updateTokenUriIx, loadMap, checkMemberJson, checkCollectionJson, DISC };
