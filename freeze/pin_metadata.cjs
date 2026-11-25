// Pin the 500 Capy Warriors member JSONs and the collection image + JSON to Pinata as bare
// files, verify each through the gateway, and write uri_map.json for sweep_uri.cjs /
// lock_metadata.cjs. Port of rise-phoenix-contract/pin_metadata.cjs (3dbbed3).
//
//   node freeze/pin_metadata.cjs                               DRY RUN: validate the 500 repo files and
//                                                               collection.json, compute every CIDv0 locally.
//                                                               No network, no JWT, writes nothing.
//   node freeze/pin_metadata.cjs --write-expected              same, and (re)write freeze/metadata-cids-v3.json
//                                                               and freeze/uri_map.expected.json
//   node freeze/pin_metadata.cjs --token 4 --execute           pin + verify one member (pilot)
//   node freeze/pin_metadata.cjs --execute                     pin + verify all 500 members (resumable)
//   node freeze/pin_metadata.cjs --collection --execute        pin + verify the collection image, then the
//                                                               collection JSON
//   node freeze/pin_metadata.cjs --set-collection-image <Qm…>  OFFLINE: rewrite the two image URLs in
//                                                               public/metadata/collection.json (only needed if
//                                                               Pinata's image CID is not the predicted one)
//
// What is pinned (K.pinnedMemberBytes / K.pinnedCollectionBytes):
//   member N   = JSON.stringify(public/metadata/N.json with image → <gateway>/ipfs/<same CID>, null, 2)
//   collection = JSON.stringify(public/metadata/collection.json, null, 2)
// The exact bytes are computed once; Pinata's IpfsHash must equal the local CIDv0 of those bytes.
//
// Collection image (public/collection.jpg, 280,653 B = 2 chunks of 256 KiB): its CID depends on the
// chunker (256 KiB → QmULhXwB…dVfb, 1 MiB → QmfW5REh…rVSw). collection.json is committed with the
// 256 KiB CID (kubo's default, which a CIDv0 pinFileToIPFS upload is expected to use). --collection
// --execute uploads the image first and requires Pinata's IpfsHash to be one of the two locally
// computed candidates and the gateway to serve the exact bytes. If it is the CID in collection.json,
// the JSON is pinned next. If it is the other candidate, the run STOPS before pinning the JSON and
// prints the --set-collection-image command; the map and the expected files must then be rebuilt.
//
// Rules carried over (RISE pin_metadata.cjs, cappy rewrite-metadata.cjs):
//   * pinFileToIPFS with pinataOptions {cidVersion: 0, wrapWithDirectory: false}: a bare file, so the
//     uri is …/ipfs/<Qm> with no path. pinataMetadata.name is slash-free ("capy-meta-v3-N.json").
//   * The JWT (~/.config/pinata/jwt) is read only with --execute, right before the first upload, and is
//     never printed: any error text is scrubbed of it.
//   * Every pin is fetched back with GET from <gateway>/ipfs/<Qm>; the served body's sha256 must equal
//     the local bytes'. Only verified entries go into uri_map.json. HTTP 429 → back off and retry.
//   * Resumable state file (default freeze/pin.state.json); re-running only does what is left.
//
// Options: --dir <metadata dir> (default ~/cappy-nft-mint/public/metadata), --image <collection jpg>
//          (default ~/cappy-nft-mint/public/collection.jpg), --gateway <https origin> (default
//          https://ipfs.x1forge.xyz), --out <uri_map.json> (default freeze/uri_map.json), --state <file>

const fs = require("fs"), os = require("os"), path = require("path");
const K = require("./capy_meta_common.cjs");

const UPLOAD_ENDPOINT = "https://api.pinata.cloud/pinning/pinFileToIPFS";
const JWT_PATH = path.join(os.homedir(), ".config", "pinata", "jwt");
const MAX_RETRIES = 4, DELAY_MS = 300, VERIFY_TRIES = 8;
const REPO = path.join(__dirname, "..");

// ── validation (pure) ─────────────────────────────────────────────────
function checkMemberFile(n, repoBytes, gateway = K.DEFAULT_GATEWAY) {
  const p = [];
  let j, pinned;
  try { j = JSON.parse(repoBytes.toString("utf8")); } catch (e) { return [`not JSON: ${e.message}`]; }
  if (j.name !== `Capy Warrior #${n}`) p.push(`name ${JSON.stringify(j.name)}, want "Capy Warrior #${n}"`);
  if (j.external_url !== K.EXTERNAL_URL) p.push(`external_url ${JSON.stringify(j.external_url)}, want ${JSON.stringify(K.EXTERNAL_URL)}`);
  const keys = Object.keys(j).join(",");
  if (keys !== "name,description,image,external_url,attributes,collection") p.push(`keys ${keys}`);
  try { pinned = K.pinnedMemberBytes(repoBytes, gateway); } catch (e) { return [...p, e.message]; }
  const fh = K.forbiddenHost(pinned.toString("utf8"));
  if (fh) p.push(`pinned JSON would mention ${fh}`);
  return p;
}
function checkCollectionFile(repoBytes, imageCandidates, gateway = K.DEFAULT_GATEWAY) {
  const p = [];
  let j;
  try { j = JSON.parse(repoBytes.toString("utf8")); } catch (e) { return [`not JSON: ${e.message}`]; }
  if (j.name !== "Capy Warriors") p.push(`name ${JSON.stringify(j.name)}, want "Capy Warriors"`);
  if (j.external_url !== K.EXTERNAL_URL) p.push(`external_url ${JSON.stringify(j.external_url)}`);
  const cid = typeof j.image === "string" ? j.image.split("/").pop() : "";
  if (j.image !== `${gateway}/ipfs/${cid}`) p.push(`image ${j.image} is not ${gateway}/ipfs/<CID>`);
  if (!imageCandidates.includes(cid)) p.push(`image CID ${cid} is neither candidate CID of the collection image (${imageCandidates.join(", ")})`);
  const files = (j.properties && j.properties.files) || [];
  if (files.length !== 1 || files[0].uri !== j.image || files[0].type !== "image/jpeg") p.push("properties.files must be [{uri: image, type: image/jpeg}]");
  const fh = K.forbiddenHost(K.pinnedCollectionBytes(repoBytes).toString("utf8"));
  if (fh) p.push(`collection JSON mentions ${fh}`);
  return p;
}
const imageCandidates = (img) => [K.cidV0(img, K.CHUNK_256K), K.cidV0(img, K.CHUNK_1M)];
// Rewrite the two image URLs (image, properties.files[0].uri) in the collection file text. Pure.
function setCollectionImage(text, cid, gateway = K.DEFAULT_GATEWAY) {
  if (!K.CID_RE.test(cid)) throw new Error(`${cid} is not a CIDv0`);
  const j = JSON.parse(text), cur = j.image;
  if (text.split(JSON.stringify(cur)).length !== 3) throw new Error("expected the current image URL exactly twice (image, properties.files[0].uri)");
  const out = text.split(JSON.stringify(cur)).join(JSON.stringify(`${gateway}/ipfs/${cid}`));
  const a = JSON.parse(out); j.image = `${gateway}/ipfs/${cid}`; j.properties.files[0].uri = j.image;
  if (JSON.stringify(a) !== JSON.stringify(j)) throw new Error("rewrite changed more than the two image URLs");
  return out;
}
function buildMapText(entries) { // {"1":uri,…,"500":uri,"collection":uri}, same bytes as make_uri_map.cjs
  const o = {};
  for (let n = K.FIRST; n <= K.LAST; n++) if (entries[String(n)]) o[String(n)] = entries[String(n)];
  if (entries.collection) o.collection = entries.collection;
  return JSON.stringify(o, null, 2) + "\n";
}

// ── Pinata (send path only) ───────────────────────────────────────────
let jwt = null;
const scrub = (s) => (jwt ? String(s).split(jwt).join("<redacted>") : String(s));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function upload(bytes, name, type, keyvalues) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const body = new FormData();
      body.append("file", new Blob([bytes], { type }), name);
      body.append("pinataMetadata", JSON.stringify({ name, keyvalues }));
      body.append("pinataOptions", JSON.stringify({ cidVersion: 0, wrapWithDirectory: false }));
      const res = await fetch(UPLOAD_ENDPOINT, { method: "POST", headers: { Authorization: `Bearer ${jwt}` }, body, signal: AbortSignal.timeout(120000) });
      const text = await res.text();
      if (res.ok) return JSON.parse(text).IpfsHash;
      if (res.status === 429) { await sleep(2000 * attempt); continue; }
      throw new Error(`HTTP ${res.status}: ${scrub(text.slice(0, 200))}`);
    } catch (e) {
      if (attempt === MAX_RETRIES) throw new Error(scrub(e.message));
      await sleep(1000 * attempt);
    }
  }
  throw new Error(`gave up after ${MAX_RETRIES} retries`);
}
async function verifyOnGateway(gateway, cid, wantSha) {
  let last = "";
  for (let i = 1; i <= VERIFY_TRIES; i++) {
    try {
      const res = await fetch(`${gateway}/ipfs/${cid}`, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(60000) });
      if (res.ok) {
        const body = Buffer.from(await res.arrayBuffer());
        if (K.sha256Hex(body) === wantSha) return true;
        last = `body sha256 ${K.sha256Hex(body).slice(0, 12)}… != local ${wantSha.slice(0, 12)}…`;
      } else last = `HTTP ${res.status}`;
    } catch (e) { last = e.message; }
    await sleep(2000 * i); // a fresh pin can take ~1 min to appear (RISE audit I3): ~72 s in total
  }
  throw new Error(`gateway verify failed for ${cid}: ${last} (re-run: the state file resumes)`);
}
// One pin = upload (unless the state says verified) + gateway verify. `accept` = allowed CIDs.
async function pinOne(key, bytes, name, type, state, gateway, accept) {
  const wantSha = K.sha256Hex(bytes);
  if (state[key] && state[key].verified && accept.includes(state[key].cid) && state[key].sha256 === wantSha) return state[key].cid;
  const cid = await upload(bytes, name, type, { collection: "capy-warriors", item: String(key) });
  if (!accept.includes(cid)) throw new Error(`Pinata returned ${cid}, local CIDv0 is ${accept.join(" or ")} (cidVersion/wrapping/chunker wrong?)`);
  state[key] = { cid, sha256: wantSha, uploaded: new Date().toISOString(), verified: false };
  await verifyOnGateway(gateway, cid, wantSha);
  state[key].verified = true;
  return cid;
}

async function main() {
  let a;
  try {
    a = K.parseArgs(process.argv.slice(2), {
      flags: ["--execute", "--collection", "--write-expected"],
      opts: { "--token": K.V.tokenNumber, "--dir": K.V.any, "--image": K.V.any, "--gateway": K.V.url, "--out": K.V.any, "--state": K.V.any, "--set-collection-image": K.V.any },
    });
  } catch (e) { console.error("Refusing:", e.message); process.exit(1); }
  const has = (f) => a.flags.has(f);
  const EXECUTE = has("--execute"), COLL = has("--collection"), TOKEN = a.opts["--token"] !== undefined ? +a.opts["--token"] : null;
  const SET_IMG = a.opts["--set-collection-image"];
  if (COLL && TOKEN !== null) { console.error("Refusing: --collection and --token are exclusive."); process.exit(1); }
  if (has("--write-expected") && (EXECUTE || TOKEN !== null || COLL)) { console.error("Refusing: --write-expected is a dry-run option for all 500 + collection."); process.exit(1); }
  if (SET_IMG !== undefined && (EXECUTE || TOKEN !== null || COLL || has("--write-expected"))) { console.error("Refusing: --set-collection-image runs alone."); process.exit(1); }
  const DIR = a.opts["--dir"] || path.join(REPO, "public", "metadata");
  const IMG = a.opts["--image"] || path.join(REPO, "public", "collection.jpg");
  const GATEWAY = a.opts["--gateway"] || K.DEFAULT_GATEWAY;
  if (!/^https:\/\/[a-z0-9.-]+$/.test(GATEWAY)) { console.error("Refusing: --gateway must be an https origin without a path, e.g. https://ipfs.x1forge.xyz"); process.exit(1); }
  const OUT = a.opts["--out"] || path.join(__dirname, "uri_map.json");
  const STATE = a.opts["--state"] || path.join(__dirname, "pin.state.json");
  const collPath = path.join(DIR, "collection.json");

  if (SET_IMG !== undefined) {
    const out = setCollectionImage(fs.readFileSync(collPath, "utf8"), SET_IMG, GATEWAY);
    const cands = imageCandidates(fs.readFileSync(IMG));
    if (!cands.includes(SET_IMG)) { console.error(`Refusing: ${SET_IMG} is not a CID of ${IMG} (${cands.join(", ")})`); process.exit(1); }
    fs.writeFileSync(collPath, out);
    console.log(`rewrote ${collPath}: image + properties.files[0].uri = ${GATEWAY}/ipfs/${SET_IMG}`);
    console.log("Next: node freeze/pin_metadata.cjs --write-expected, review + commit, then --collection --execute again.");
    return;
  }

  console.log(`dir     : ${DIR}\ngateway : ${GATEWAY}\nout     : ${OUT}\nstate   : ${STATE}`);
  console.log(`mode    : ${EXECUTE ? "EXECUTE — uploads to Pinata" : "DRY RUN — no network, no JWT"}`);
  console.log(`scope   : ${COLL ? "collection image + JSON" : TOKEN !== null ? `member #${TOKEN}` : "members 1..500"}\n`);

  // ── validate everything first (members always all 500, so the expected map is complete) ──
  const problems = [], members = {}, seen = new Map();
  for (let n = K.FIRST; n <= K.LAST; n++) {
    const f = path.join(DIR, `${n}.json`);
    if (!fs.existsSync(f)) { problems.push(`${n}.json missing`); continue; }
    const repo = fs.readFileSync(f);
    const p = checkMemberFile(n, repo, GATEWAY);
    if (p.length) { problems.push(...p.map((x) => `${n}.json: ${x}`)); continue; }
    const bytes = K.pinnedMemberBytes(repo, GATEWAY), cid = K.cidV0(bytes);
    if (seen.has(cid)) problems.push(`${n}.json: same CID as ${seen.get(cid)}.json`);
    seen.set(cid, n);
    members[n] = { bytes, cid };
  }
  if (!fs.existsSync(IMG)) problems.push(`${IMG} missing`);
  if (!fs.existsSync(collPath)) problems.push(`${collPath} missing`);
  if (problems.length) { console.error(`${problems.length} problem(s):\n  ` + problems.slice(0, 40).join("\n  ")); process.exit(1); }
  const img = fs.readFileSync(IMG), cands = imageCandidates(img);
  const collRepo = fs.readFileSync(collPath);
  problems.push(...checkCollectionFile(collRepo, cands, GATEWAY).map((x) => `collection.json: ${x}`));
  if (problems.length) { console.error(`${problems.length} problem(s):\n  ` + problems.slice(0, 40).join("\n  ")); process.exit(1); }
  const collBytes = K.pinnedCollectionBytes(collRepo), collCid = K.cidV0(collBytes);
  const imgCid = JSON.parse(collRepo.toString("utf8")).image.split("/").pop();
  const expected = {};
  for (let n = K.FIRST; n <= K.LAST; n++) expected[String(n)] = `${GATEWAY}/ipfs/${members[n].cid}`;
  expected.collection = `${GATEWAY}/ipfs/${collCid}`;
  const mapText = buildMapText(expected);
  console.log(`500 member files valid: name "Capy Warrior #N", external_url ${K.EXTERNAL_URL}, distinct CIDs`);
  console.log(`collection image ${IMG}: ${img.length} B, sha256 ${K.sha256Hex(img)}`);
  console.log(`  CID 256 KiB chunks ${cands[0]}${cands[0] === imgCid ? "  <- in collection.json" : ""}`);
  console.log(`  CID 1 MiB chunks   ${cands[1]}${cands[1] === imgCid ? "  <- in collection.json" : ""}`);
  console.log(`collection JSON ${collCid} (${collBytes.length} B)`);
  for (const n of [1, 4, 500]) console.log(`  #${n} ${members[n].cid} (${members[n].bytes.length} B)`);
  console.log(`expected uri_map sha256 ${K.sha256Hex(Buffer.from(mapText))}`);

  if (!EXECUTE) {
    if (has("--write-expected")) {
      const cids = {};
      for (let n = K.FIRST; n <= K.LAST; n++) cids[String(n)] = members[n].cid;
      fs.writeFileSync(path.join(__dirname, "metadata-cids-v3.json"), JSON.stringify(cids, null, 2) + "\n");
      fs.writeFileSync(path.join(__dirname, "uri_map.expected.json"), mapText);
      console.log(`\nwrote freeze/metadata-cids-v3.json and freeze/uri_map.expected.json`);
    }
    console.log("\nDry run. Nothing uploaded. Add --execute (pilot: --token 4 --execute).");
    return;
  }

  try {
    jwt = fs.readFileSync(JWT_PATH, "utf8").trim();
  } catch {
    console.error(`Could not read the JWT file ${JWT_PATH}`);
    process.exit(1);
  }
  if (!jwt) { console.error("JWT file is empty"); process.exit(1); }
  const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : {};
  const save = () => fs.writeFileSync(STATE, JSON.stringify(state, null, 2) + "\n");
  // uri_map.json is rebuilt from the state on every write: only entries whose verified CID equals
  // the CID of today's bytes. A stale entry from an earlier content can never survive.
  const map = {};
  const writeMap = () => {
    for (const k of Object.keys(map)) delete map[k];
    for (let n = K.FIRST; n <= K.LAST; n++) { const s = state[String(n)]; if (s && s.verified && s.cid === members[n].cid) map[String(n)] = `${GATEWAY}/ipfs/${s.cid}`; }
    const c = state.collection;
    if (c && c.verified && c.cid === collCid) map.collection = `${GATEWAY}/ipfs/${c.cid}`;
    fs.writeFileSync(OUT, buildMapText(map));
  };

  if (COLL) {
    try {
      process.stdout.write(`collection image … `);
      const got = await pinOne("collection-image", img, "capy-collection.jpg", "image/jpeg", state, GATEWAY, cands);
      save();
      console.log(`${got} pinned + verified (${got === cands[0] ? "256 KiB" : "1 MiB"} chunks)`);
      if (got !== imgCid) {
        console.error(`\nSTOP: Pinata's image CID ${got} is not the one in collection.json (${imgCid}). The collection JSON was NOT pinned.`);
        console.error(`Run: node freeze/pin_metadata.cjs --set-collection-image ${got}`);
        console.error("then --write-expected, review and commit, and --collection --execute again (the image is already pinned; it is skipped).");
        process.exit(2);
      }
      process.stdout.write(`collection JSON ${collCid} … `);
      const cid = await pinOne("collection", collBytes, "capy-collection-v3.json", "application/json", state, GATEWAY, [collCid]);
      save();
      writeMap();
      console.log(`pinned + verified\n${OUT}: "collection": "${map.collection}"`);
    } catch (e) { save(); console.error("\nFAILED:", scrub(e.message)); process.exit(1); }
    return;
  }

  const tokens = TOKEN !== null ? [TOKEN] : Object.keys(members).map(Number);
  let done = 0, failed = 0;
  const failures = [];
  for (const n of tokens) {
    process.stdout.write(`#${String(n).padStart(3)} ${members[n].cid} … `);
    try {
      await pinOne(String(n), members[n].bytes, `capy-meta-v3-${n}.json`, "application/json", state, GATEWAY, [members[n].cid]);
      console.log("pinned + verified");
      done++;
    } catch (e) {
      console.log(`FAILED — ${scrub(e.message)}`);
      failed++; failures.push({ n, error: scrub(e.message) });
    }
    if ((done + failed) % 10 === 0) { save(); writeMap(); }
    await sleep(DELAY_MS);
  }
  save(); writeMap();
  const have = Object.keys(map).filter((k) => k !== "collection").length;
  console.log(`\npinned + verified this run: ${done}, failed: ${failed}. ${OUT} now has ${have}/500 members${map.collection ? " + collection" : ""}.`);
  if (have === 500 && map.collection) console.log(`map sha256 ${K.sha256File(OUT)} (expected ${K.sha256Hex(Buffer.from(mapText))})`);
  if (failures.length) { failures.slice(0, 20).forEach((f) => console.log(`  #${f.n}: ${f.error}`)); console.log("Re-run to retry only these."); process.exit(1); }
}

if (require.main === module) main().catch((e) => { console.error("ERR", scrub(e.message)); process.exit(1); });
module.exports = { checkMemberFile, checkCollectionFile, imageCandidates, setCollectionImage, buildMapText };
