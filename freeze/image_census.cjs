// Read-only census of the 500 member images and the collection image on the gateway.
// Every image is fetched IN FULL (no Range header) and its body is hashed back to a CIDv0; the
// result must equal the CID in the image URL. A 404 on a Range request is not a missing file
// (follow-up 2: Pinata's gateway answers 404 to Range requests on multi-chunk files it serves in full).
//
//   node freeze/image_census.cjs                      full GET of all 500 + collection image
//   node freeze/image_census.cjs --token 1            one member
//   node freeze/image_census.cjs --collection         the collection image only
//   node freeze/image_census.cjs --range              ALSO a Range GET (bytes=0-15) per image, recorded
//                                                     separately; it never decides "served"
//
// Expected CIDs: the CID at the end of public/metadata/N.json's image (URL = <gateway>/ipfs/<CID>, as in the
// pinned JSON), and collection.json's image. If --cid-map is given
// (or /mnt/c/X1/capy/cid_map.json exists) every member's CID is also checked against "N.png"/"N.jpg".
// Served = HTTP 200, non-empty, image/* content type, and the body's CIDv0 (1 MiB chunks, or 256 KiB
// for a file built that way) equals the URL's CID. The CID is a hash of the whole DAG, so a match
// proves the body is the exact file.
//
// Options: --dir <metadata dir> (default <repo>/public/metadata), --gateway <https origin>,
//          --concurrency <n> (default 4), --timeout <s> (default 180), --out <file>
//          (default freeze/image_census.json, git-ignored), --cid-map <file>
// No Pinata credentials, no keypair, no writes except --out. Exit 0 only if every image in scope is served.

const fs = require("fs"), path = require("path");
const K = require("./capy_meta_common.cjs");
const REPO = path.join(__dirname, "..");
const DEFAULT_CID_MAP = "/mnt/c/X1/capy/cid_map.json";

// Expected images: [{key, url, cid}] from the repo metadata. Pure apart from reading files.
function expectedImages(dir, { members = true, collection = true, token = null, cidMap = null, gateway = K.DEFAULT_GATEWAY } = {}) {
  const out = [], problems = [];
  const ns = token !== null ? [token] : members ? Array.from({ length: K.LAST }, (_, i) => i + 1) : [];
  for (const n of ns) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, `${n}.json`), "utf8"));
    const cid = typeof j.image === "string" ? j.image.split("/").pop() : "";
    if (!K.CID_RE.test(cid)) { problems.push(`#${n}: image ${j.image} does not end in a CIDv0`); continue; }
    if (cidMap) {
      const k = `${n}.${n <= 150 ? "png" : "jpg"}`;
      if (cidMap[k] !== cid) problems.push(`#${n}: cid_map ${k} = ${cidMap[k]}, metadata image = ${cid}`);
    }
    out.push({ key: String(n), url: `${gateway}/ipfs/${cid}`, cid }); // the pinned JSON's image (K.pinnedMemberBytes)
  }
  if (collection && token === null) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, "collection.json"), "utf8"));
    const cid = j.image.split("/").pop();
    if (j.image !== `${gateway}/ipfs/${cid}`) problems.push(`collection image ${j.image} is not on ${gateway}`);
    out.push({ key: "collection", url: j.image, cid });
  }
  return { images: out, problems };
}

async function fullGet(url, timeoutMs) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
    const body = Buffer.from(await res.arrayBuffer());
    return { status: res.status, ct: res.headers.get("content-type") || "", body, ms: Date.now() - t0 };
  } catch (e) { return { status: 0, ct: "", body: Buffer.alloc(0), ms: Date.now() - t0, error: e.message }; }
}
async function rangeGet(url, timeoutMs) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { method: "GET", redirect: "manual", headers: { Range: "bytes=0-15" }, signal: AbortSignal.timeout(timeoutMs) });
    const body = Buffer.from(await res.arrayBuffer());
    return { status: res.status, bytes: body.length, ms: Date.now() - t0, note: res.ok ? undefined : body.toString("utf8").slice(0, 120) };
  } catch (e) { return { status: 0, bytes: 0, ms: Date.now() - t0, note: e.message }; }
}

// Judge one full GET. Pure.
function judge(img, r) {
  const rec = { key: img.key, url: img.url, cid: img.cid, status: r.status, bytes: r.body.length, ms: r.ms, content_type: r.ct };
  if (r.error) rec.error = r.error;
  if (r.status === 200 && r.body.length) {
    rec.sha256 = K.sha256Hex(r.body);
    const m = K.cidMatch(r.body, img.cid);
    rec.chunker = m;
    rec.served = !!m && r.ct.startsWith("image/");
    if (!m) rec.problem = `body (${r.body.length} B) does not hash to ${img.cid} with 1 MiB or 256 KiB chunks`;
    else if (!r.ct.startsWith("image/")) rec.problem = `content-type ${r.ct}`;
  } else {
    rec.served = false;
    rec.problem = r.error || `HTTP ${r.status}${r.body.length && r.body.length < 300 ? `: ${r.body.toString("utf8").trim()}` : ""}`;
  }
  return rec;
}

async function main() {
  let a;
  try {
    a = K.parseArgs(process.argv.slice(2), {
      flags: ["--collection", "--range"],
      opts: { "--token": K.V.tokenNumber, "--dir": K.V.any, "--gateway": K.V.url, "--concurrency": K.V.positiveInt, "--timeout": K.V.positiveInt, "--out": K.V.any, "--cid-map": K.V.any },
    });
  } catch (e) { console.error("Refusing:", e.message); process.exit(1); }
  const COLL = a.flags.has("--collection"), RANGE = a.flags.has("--range");
  const TOKEN = a.opts["--token"] !== undefined ? +a.opts["--token"] : null;
  if (COLL && TOKEN !== null) { console.error("Refusing: --collection and --token are exclusive."); process.exit(1); }
  const DIR = a.opts["--dir"] || path.join(REPO, "public", "metadata");
  const GATEWAY = a.opts["--gateway"] || K.DEFAULT_GATEWAY;
  const CONC = +(a.opts["--concurrency"] || 4), TIMEOUT = 1000 * +(a.opts["--timeout"] || 180);
  const OUT = a.opts["--out"] || path.join(__dirname, "image_census.json");
  const mapPath = a.opts["--cid-map"] || (fs.existsSync(DEFAULT_CID_MAP) ? DEFAULT_CID_MAP : null);
  const cidMap = mapPath ? JSON.parse(fs.readFileSync(mapPath, "utf8")) : null;

  const { images, problems } = expectedImages(DIR, { members: !COLL, collection: TOKEN === null, token: TOKEN, cidMap, gateway: GATEWAY });
  if (problems.length) { console.error(`${problems.length} problem(s) with the expected CIDs:\n  ` + problems.slice(0, 20).join("\n  ")); process.exit(1); }
  console.log(`gateway    : ${GATEWAY}\nimages     : ${images.length}${cidMap ? ` (CIDs also equal ${mapPath})` : ""}\nmethod     : full GET, body CIDv0 vs URL CID${RANGE ? "; plus Range bytes=0-15 (informational)" : ""}\nout        : ${OUT}\n`);

  const results = new Array(images.length);
  let next = 0, done = 0;
  const t0 = Date.now();
  async function worker() {
    while (next < images.length) {
      const i = next++, img = images[i];
      const rec = judge(img, await fullGet(img.url, TIMEOUT));
      if (RANGE) rec.range = await rangeGet(img.url, 60000);
      results[i] = rec;
      done++;
      console.log(`${img.key.padStart(10)} ${rec.served ? "SERVED " : "MISSING"} ${String(rec.status).padStart(3)} ${String(rec.bytes).padStart(9)} B ${String(rec.ms).padStart(6)} ms` +
        (rec.chunker ? ` cid ok (${rec.chunker})` : "") + (rec.problem ? `  ${rec.problem.slice(0, 100)}` : "") +
        (rec.range ? `  | range ${rec.range.status} ${rec.range.ms} ms` : "") + `  [${done}/${images.length}]`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONC, images.length) }, worker));

  const served = results.filter((r) => r.served), missing = results.filter((r) => !r.served);
  const summary = {
    gateway: GATEWAY, at: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), method: "full GET",
    total: results.length, served: served.length, missing: missing.length, missing_keys: missing.map((r) => r.key),
    bytes_served: served.reduce((s, r) => s + r.bytes, 0),
  };
  if (RANGE) {
    const by = {};
    for (const r of results) { const k = `${r.key === "collection" ? "collection" : +r.key <= 150 ? "png" : "jpg"} range ${r.range.status}`; by[k] = (by[k] || 0) + 1; }
    summary.range = by;
  }
  fs.writeFileSync(OUT, JSON.stringify({ summary, results }, null, 2) + "\n");
  console.log(`\n${summary.served}/${summary.total} served (full GET, CID verified), ${summary.missing} not: ${summary.missing_keys.slice(0, 40).join(",") || "none"}`);
  if (RANGE) console.log(`range (informational): ${JSON.stringify(summary.range)}`);
  console.log(`${summary.seconds} s, ${(summary.bytes_served / 1e6).toFixed(1)} MB. Written: ${OUT}`);
  if (missing.length) process.exit(1);
}

if (require.main === module) main().catch((e) => { console.error("ERR", e.message); process.exit(1); });
module.exports = { expectedImages, judge };
