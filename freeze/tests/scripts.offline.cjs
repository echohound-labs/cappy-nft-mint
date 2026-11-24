// Offline checks for the Capy freeze scripts (freeze/*.cjs). No network: RPC calls go to fake
// connection objects, and refusal paths are exercised only where they exit before any network
// call. Port of rise-phoenix-contract/tests/scripts.offline.cjs (3dbbed3).
// Prereqs: the freeze build's IDL at contract/idl/capy_warriors.json (committed), and
// `cd contract/tests/svm && cargo test --offline` (writes the metadata dumps used below).
// Run from the repo root: node freeze/tests/scripts.offline.cjs
const assert = require("assert"), fs = require("fs"), path = require("path"), os = require("os"), crypto = require("crypto");
const { spawnSync } = require("child_process");
const repo = path.join(__dirname, "..", "..");
const fz = path.join(repo, "freeze");
const { PublicKey, Keypair } = require(path.join(repo, "node_modules/@solana/web3.js"));
const K = require(path.join(fz, "capy_meta_common.cjs"));
const sweep = require(path.join(fz, "sweep_uri.cjs"));
const lockS = require(path.join(fz, "lock_metadata.cjs"));
const roy = require(path.join(fz, "update_royalty.cjs"));
const vault = require(path.join(fz, "vault_collection.cjs"));
const mk = require(path.join(fz, "make_uri_map.cjs"));
const mainnetFx = path.join(repo, "contract/tests/svm/fixtures/mainnet");
const dumps = path.join(repo, "contract/tests/svm/target/metadata-dumps");
const idl = JSON.parse(fs.readFileSync(path.join(repo, "contract/idl/capy_warriors.json")));
const GZUB = "GZuBHE3fQCQ6eSTLMwWKrK15CjtWfA58BmxdtWwG5mJJ";
const T = { bps: 300, creator: GZUB }; // the example target; the scripts take it as --bps/--creator
let n = 0;
const ok = (msg) => { n++; console.log("ok  " + msg); };

// ── IDL: instructions, discriminators, accounts, errors ──
assert.deepStrictEqual(idl.instructions.map((i) => i.name).sort(), ["close_pending_mint", "lock_metadata", "update_royalty", "update_token_uri"]);
for (const [name, d] of [["update_token_uri", sweep.DISC], ["lock_metadata", lockS.DISC], ["update_royalty", roy.DISC]]) {
  const ix = idl.instructions.find((i) => i.name === name);
  assert.deepStrictEqual([...d], ix.discriminator, name);
  assert.deepStrictEqual(ix.accounts.map((a) => a.name), ["mint_state", "authority", "metadata", "token_metadata_program"]);
}
for (const ix of idl.instructions) assert.deepStrictEqual(ix.discriminator, [...crypto.createHash("sha256").update(`global:${ix.name}`).digest().slice(0, 8)]);
assert.deepStrictEqual(idl.errors.map((e) => `${e.code}:${e.name}`), ["6000:SoldOut", "6001:RandomnessNotReady", "6002:Unauthorized", "6003:InvalidRoyalty", "6004:InvalidCreators"]);
assert.strictEqual(idl.metadata.name, "capy_warriors");
ok("IDL: 4 instructions; discriminators + accounts match the scripts; error codes 6000-6004 unchanged");

// ── instruction encoding ──
const prog = new PublicKey(K.DEFAULT_PROGRAM), ms = K.mintStatePda(prog), auth = Keypair.generate().publicKey, mint = Keypair.generate().publicKey;
assert.strictEqual(ms.toBase58(), "5y1GoGNfruDk9QUszD5UdEn9fjAg6xxDBJfywNu4dGmH");
assert.strictEqual(K.EXPECTED_MINT_STATE, ms.toBase58());
let ix = sweep.updateTokenUriIx(prog, ms, auth, mint, "https://a/b");
assert.strictEqual(ix.data.length, 8 + 4 + 11); assert.strictEqual(ix.data.readUInt32LE(8), 11);
assert.deepStrictEqual(ix.keys.map((k) => [k.isSigner, k.isWritable]), [[false, false], [true, false], [false, true], [false, false]]);
assert.ok(ix.keys[2].pubkey.equals(K.mdPda(mint)));
ix = lockS.lockIx(prog, ms, auth, mint);
assert.strictEqual(ix.data.length, 8);
assert.deepStrictEqual(ix.keys.map((k) => [k.isSigner, k.isWritable]), [[false, false], [true, false], [false, true], [false, false]]);
assert.strictEqual(K.mdPda(K.COLLECTION_MINT).toBase58(), K.COLLECTION_METADATA);
ok("instruction encoding; mint_state PDA = 5y1GoGNf…; collection metadata PDA = Cx6vNq7…");

// ── parser + fingerprints on real Metaplex bytes (LiteSVM on X1 Metaplex, and mainnet) ──
const P = (f) => K.parseMetadata(fs.readFileSync(path.join(dumps, f)));
const before = P("before.bin"), after = P("after.bin"), lb = P("lock_before.bin"), la = P("lock_after.bin");
assert.strictEqual(before.uri, "https://capy-nft-mint.vercel.app/api/metadata/7");
assert.strictEqual(K.num(before), 7); assert.strictEqual(K.num(P("collection.bin")), -1);
assert.strictEqual(K.fingerprint(before, "uri"), K.fingerprint(after, "uri"));
assert.notStrictEqual(K.fingerprint(before, "uri"), K.fingerprint({ ...after, collection: { ...after.collection, verified: false } }, "uri"));
assert.notStrictEqual(K.fingerprint(before, "uri"), K.fingerprint({ ...after, tail: after.tail.replace(/.$/, "f") }, "uri"), "tail bytes are compared");
assert.strictEqual(lb.isMutable, true); assert.strictEqual(la.isMutable, false);
assert.strictEqual(K.fingerprint(lb, "isMutable"), K.fingerprint(la, "isMutable"));
const mm1 = K.parseMetadata(fs.readFileSync(path.join(mainnetFx, "member1_GZuB_100bps.bin")));
const mColl = K.parseMetadata(fs.readFileSync(path.join(mainnetFx, "collection_Cx6vNq7.bin")));
assert.strictEqual(K.num(mm1), 1); assert.strictEqual(mColl.name, K.COLLECTION_NAME); assert.strictEqual(mColl.uri, K.COLLECTION_OLD_URI);
assert.ok(K.isMember(mm1, ms.toBase58())); assert.ok(!K.isMember(mColl, ms.toBase58()));
ok("parser on real bytes (LiteSVM + mainnet); uri-only and is_mutable-only fingerprints, incl. raw tail bytes");

// ── strict args ──
const spec = { flags: ["--send"], opts: { "--token": K.V.tokenNumber, "--limit": K.V.positiveInt, "--bps": K.V.bps, "--creator": K.V.walletPubkey } };
for (const [args, re] of [[["--limit", "abc"], /positive integer/], [["--limit"], /needs a value/], [["--limit", "--send"], /needs a value/], [["--limit", "0"], /positive/],
  [["--token", ""], /1\.\.500/], [["--token", "0"], /1\.\.500/], [["--token", "501"], /1\.\.500/], [["--token", "07"], /1\.\.500/], [["--token", "7a"], /1\.\.500/],
  [["--confirm-mainet"], /unknown/], [["--token", "1", "--token", "2"], /twice/],
  [["--bps", "10001"], /0\.\.10000/], [["--bps", "3.5"], /0\.\.10000/], [["--bps", "0300"], /0\.\.10000/], [["--bps", ""], /0\.\.10000/],
  [["--creator", "xyz"], /not a public key/], [["--creator", ms.toBase58()], /off curve/]])
  assert.throws(() => K.parseArgs(args, spec), re, JSON.stringify(args));
assert.deepStrictEqual(K.parseArgs(["--token", "500", "--limit", "5", "--send", "--bps", "300", "--creator", GZUB], spec).opts, { "--token": "500", "--limit": "5", "--bps": "300", "--creator": GZUB });
assert.throws(() => K.royaltyTarget({}), /--bps.*required.*--creator.*required/s);
assert.throws(() => K.royaltyTarget({ "--bps": "300" }), /--creator/);
assert.deepStrictEqual(K.royaltyTarget({ "--bps": "300", "--creator": GZUB }), T);
ok("strict args: --token 1..500 only, --bps 0..10000 integer, --creator on-curve wallet; royalty target has no default");

// ── map validation ──
const cidsV2 = JSON.parse(fs.readFileSync(path.join(repo, "public/metadata-cids-v2.json")));
const good = Object.fromEntries(Object.entries(cidsV2).map(([k, c]) => [k, `https://ipfs.x1forge.xyz/ipfs/${c}`]));
assert.deepStrictEqual(K.checkMap(good), []);
const QM = "QmS2zXzuR6VTuuPvUkZn18G1Ewm8MBJ1gLTXGon3ZwvVVV";
assert.deepStrictEqual(K.checkMap({ ...good, collection: `https://ipfs.x1forge.xyz/ipfs/${QM}` }), []);
for (const [label, bad] of [["empty", { 1: "" }], ["vercel", { 1: "https://capy-nft-mint.vercel.app/api/metadata/1" }], ["lighthouse", { 1: `https://gateway.lighthouse.storage/ipfs/${QM}` }],
  ["pinata.cloud", { 1: `https://gateway.pinata.cloud/ipfs/${QM}` }], ["dupe", { 1: `https://g.x/ipfs/${QM}`, 2: `https://g.x/ipfs/${QM}` }], ["key 0", { 0: `https://g.x/ipfs/${QM}` }],
  ["key 501", { 501: `https://g.x/ipfs/${QM}` }], ["key 07", { "07": `https://g.x/ipfs/${QM}` }], ["http", { 1: `http://g.x/ipfs/${QM}` }], ["ipfs://", { 1: `ipfs://${QM}` }],
  ["space", { 1: ` https://g.x/ipfs/${QM}` }], ["bafy", { 1: "https://g.x/ipfs/bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku" }], ["two hosts", { 1: `https://a.x/ipfs/${QM}`, 2: "https://b.x/ipfs/QmXPgnFWtbZx5T29nqinLqgfbc7xr13wtGWcEwPceaatPZ" }], ["array", []]])
  assert.ok(K.checkMap(bad).length > 0, label);
ok("map: https://<one gateway>/ipfs/<CIDv0> only, ≤200 B, no Vercel/Lighthouse/pinata.cloud, no dupes, keys 1..500 or \"collection\"");

// ── the pinned JSONs reproduce offline from the repo files (CIDv0) ──
// rewrite-metadata.cjs pinned JSON.stringify(repo file with image → ipfs.x1forge.xyz/ipfs/<same CID>, null, 2).
const rebuilt = (k) => { const r = JSON.parse(fs.readFileSync(path.join(repo, `public/metadata/${k}.json`), "utf8")); const o = {}; for (const [a, v] of Object.entries(r)) o[a] = a === "image" ? "https://ipfs.x1forge.xyz/ipfs/" + v.split("/").pop() : v; return Buffer.from(JSON.stringify(o, null, 2)); };
const mism = [];
for (let k = 1; k <= 500; k++) if (K.cidV0(rebuilt(k)) !== cidsV2[k]) mism.push(k);
assert.deepStrictEqual(mism, [4], "499/500 reproduce; #4's repo fix (fee4581, Energy Sword) was never pinned");
assert.strictEqual(K.cidV0(rebuilt(4)), "QmTYE7JJBTnu9juAb4FcBCG56SxFotsJ4Ryw41NgQPHSSW", "CID a corrected #4 would have");
assert.throws(() => K.cidV0(Buffer.alloc(0)), /empty/); assert.throws(() => K.cidV0(Buffer.alloc(262145)), /chunk/);
ok("CIDv0: 499/500 pinned member JSONs reproduce byte for byte from public/metadata/N.json; #4 does not (unpinned fix)");

// ── verify checks (pure): member JSON vs repo file, collection JSON vs local file ──
const repo1 = JSON.parse(fs.readFileSync(path.join(repo, "public/metadata/1.json"), "utf8"));
const repo4 = JSON.parse(fs.readFileSync(path.join(repo, "public/metadata/4.json"), "utf8"));
const u = (k) => good[k];
assert.deepStrictEqual(sweep.checkMemberJson(1, rebuilt(1), u(1), repo1), []);
assert.deepStrictEqual(sweep.checkMemberJson(200, rebuilt(200), u(200), JSON.parse(fs.readFileSync(path.join(repo, "public/metadata/200.json"), "utf8"))), []);
const pinned4 = Buffer.from(JSON.stringify({ ...JSON.parse(rebuilt(4)), description: "x", attributes: repo4.attributes.map((a) => (/Weapon/.test(a.trait_type) ? { ...a, value: "Rail Gun" } : a)) }, null, 2));
assert.ok(sweep.checkMemberJson(4, pinned4, `https://ipfs.x1forge.xyz/ipfs/${K.cidV0(pinned4)}`, repo4).some((x) => /differs from repo/.test(x)), "#4 Rail Gun vs repo Energy Sword");
assert.ok(sweep.checkMemberJson(1, rebuilt(1), u(2), repo1).some((x) => /hash to/.test(x)), "bytes do not match the uri's CID");
const imgOther = Buffer.from(JSON.stringify({ ...JSON.parse(rebuilt(1)), image: "https://gateway.lighthouse.storage/ipfs/" + repo1.image.split("/").pop() }, null, 2));
assert.ok(sweep.checkMemberJson(1, imgOther, `https://ipfs.x1forge.xyz/ipfs/${K.cidV0(imgOther)}`, repo1).some((x) => /lighthouse|gateway/.test(x)), "image on another gateway");
const imgCid = Buffer.from(JSON.stringify({ ...JSON.parse(rebuilt(1)), image: "https://ipfs.x1forge.xyz/ipfs/QmS2zXzuR6VTuuPvUkZn18G1Ewm8MBJ1gLTXGon3ZwvVVV" }, null, 2));
assert.ok(sweep.checkMemberJson(1, imgCid, `https://ipfs.x1forge.xyz/ipfs/${K.cidV0(imgCid)}`, repo1).some((x) => /image CID/.test(x)), "different image CID");
const extUrl = Buffer.from(JSON.stringify({ ...JSON.parse(rebuilt(1)), external_url: "https://x1forge.xyz/collection/capy" }, null, 2));
assert.ok(sweep.checkMemberJson(1, extUrl, `https://ipfs.x1forge.xyz/ipfs/${K.cidV0(extUrl)}`, repo1).some((x) => /external_url/.test(x)), "a field the repo file lacks");
const named = Buffer.from(JSON.stringify({ ...JSON.parse(rebuilt(1)), name: "Capy Warrior #2" }, null, 2));
assert.ok(sweep.checkMemberJson(1, named, `https://ipfs.x1forge.xyz/ipfs/${K.cidV0(named)}`, { ...repo1, name: "Capy Warrior #2" }).some((x) => /JSON name/.test(x)), "#1..#30 must be named Capy Warrior #N");
const cj = Buffer.from(JSON.stringify({ name: "Capy Warriors", image: `https://ipfs.x1forge.xyz/ipfs/${QM}`, properties: { files: [{ uri: `https://ipfs.x1forge.xyz/ipfs/${QM}`, type: "image/jpeg" }] } }, null, 2));
const cu = `https://ipfs.x1forge.xyz/ipfs/${K.cidV0(cj)}`;
assert.deepStrictEqual(sweep.checkCollectionJson(cj, cu, cj), []);
assert.ok(sweep.checkCollectionJson(cj, cu, Buffer.concat([cj, Buffer.from(" ")])).some((x) => /local file/.test(x)), "L5: byte compare with the local file");
assert.ok(sweep.checkCollectionJson(cj, cu, null).some((x) => /--collection-json/.test(x)));
const repoColl = fs.readFileSync(path.join(repo, "public/metadata/collection.json"));
assert.ok(sweep.checkCollectionJson(repoColl, `https://ipfs.x1forge.xyz/ipfs/${K.cidV0(repoColl)}`, repoColl).some((x) => /vercel/.test(x)), "today's collection.json (image on Vercel) is refused");
ok("verify: member = repo file except image (same CID, map's gateway), bytes hash to the uri CID; collection = local file byte for byte, no Vercel");

// ── S2: discovery keeps only verified members of HC8zqrya…, exactly 500, numbered 1..500 ──
function encMd({ ua, mint, name, uri, fee = 100, creators, coll, isMutable = true }) {
  const s = (x, pad) => { const b = Buffer.alloc(4 + pad); const t = Buffer.from(x); b.writeUInt32LE(pad); t.copy(b, 4); return b; };
  const parts = [Buffer.from([4]), new PublicKey(ua).toBuffer(), new PublicKey(mint).toBuffer(), s(name, 32), s("CAPY", 10), s(uri, 200)];
  const f = Buffer.alloc(2); f.writeUInt16LE(fee); parts.push(f);
  const cr = creators || [{ address: GZUB, verified: true, share: 100 }];
  const l = Buffer.alloc(4); l.writeUInt32LE(cr.length); parts.push(Buffer.from([1]), l);
  for (const c of cr) parts.push(new PublicKey(c.address).toBuffer(), Buffer.from([c.verified ? 1 : 0, c.share]));
  parts.push(Buffer.from([0, isMutable ? 1 : 0, 1, 255, 1, 0]));
  parts.push(coll ? Buffer.concat([Buffer.from([1, coll.verified ? 1 : 0]), new PublicKey(coll.key).toBuffer()]) : Buffer.from([0]));
  parts.push(Buffer.from([0, 0, 0]));
  return Buffer.concat(parts);
}
const MS = ms.toBase58();
const members = [...Array(500).keys()].map((i) => { const m = Keypair.generate().publicKey.toBase58(); return { pubkey: K.mdPda(m), account: { data: encMd({ ua: MS, mint: m, name: `Capy Warrior #${i + 1}`, uri: good[i + 1], coll: { verified: true, key: K.COLLECTION_MINT } }) } }; });
const collAcc = { data: encMd({ ua: MS, mint: K.COLLECTION_MINT, name: K.COLLECTION_NAME, uri: K.COLLECTION_OLD_URI, fee: 500, creators: [{ address: MS, verified: true, share: 100 }], coll: null }) };
const spoof = (name, coll) => { const m = Keypair.generate().publicKey.toBase58(); return { pubkey: K.mdPda(m), account: { data: encMd({ ua: MS, mint: m, name, uri: "https://evil/x", coll }) } }; };
const spoofs = [spoof("Capy Warrior #7", null), spoof("Capy Warrior #7", { verified: false, key: K.COLLECTION_MINT }), spoof("Capy Warrior #8", { verified: true, key: Keypair.generate().publicKey.toBase58() }), spoof("Capy Warrior #0", { verified: true, key: K.COLLECTION_MINT })];
const fakeConn = (list) => ({ getProgramAccounts: async () => list, getAccountInfo: async (k) => (k.toBase58() === K.COLLECTION_METADATA ? collAcc : null) });
(async () => {
  const r = await K.discover(fakeConn([...members, ...spoofs]), ms);
  assert.strictEqual(r.members.length, 500); assert.strictEqual(r.ignored.length, 4);
  assert.deepStrictEqual(r.members.map(K.num), [...Array(500).keys()].map((i) => i + 1));
  assert.strictEqual(r.collection.name, "CAPY Warriors");
  await assert.rejects(K.discover(fakeConn(members.slice(1)), ms), /found 499.*\n.*missing token numbers: 1/s);
  await assert.rejects(K.discover(fakeConn([...members, members[7]]), ms), /found 501/);
  const fakePda = { ...members[3], pubkey: Keypair.generate().publicKey };
  await assert.rejects(K.discover(fakeConn([...members.filter((_, i) => i !== 3), fakePda]), ms), /is not the PDA/);
  ok("S2: 4 spoofed accounts (no / unverified / foreign collection / #0) ignored; 499, 501 or a non-PDA refused (a burn stops the scripts: D4)");

  // ── S6: read-back retries until the change is visible ──
  const seq = (arr) => { let i = 0; return { getAccountInfo: async () => arr[Math.min(i++, arr.length - 1)] }; };
  const m7 = K.parseMetadata(members[6].account.data);
  const NEWU = `https://ipfs.x1forge.xyz/ipfs/${QM}`;
  const newData = encMd({ ua: MS, mint: m7.mint, name: "Capy Warrior #7", uri: NEWU, coll: { verified: true, key: K.COLLECTION_MINT } });
  const landed = (x) => x.uri === NEWU, same = (x) => K.fingerprint(x, "uri") === K.fingerprint(m7, "uri");
  let rb = await K.readBack(seq([null, members[6].account, { data: newData }]), K.mdPda(m7.mint), landed, same, { tries: 5, delayMs: 1 });
  assert.deepStrictEqual([rb.ok, rb.tries], [true, 3]);
  rb = await K.readBack(seq([null, members[6].account]), K.mdPda(m7.mint), landed, same, { tries: 3, delayMs: 1 });
  assert.deepStrictEqual([rb.ok, rb.notLanded], [false, true]);
  rb = await K.readBack(seq([{ data: encMd({ ua: MS, mint: m7.mint, name: "Capy Warrior #7", uri: NEWU, fee: 500, coll: { verified: true, key: K.COLLECTION_MINT } }) }]), K.mdPda(m7.mint), landed, same, { tries: 3, delayMs: 1 });
  assert.deepStrictEqual([rb.ok, rb.tries, rb.notLanded], [false, 1, undefined]);
  ok("S6: read-back retries past null/stale reads; stops at once if another field changed");

  // ── lock gates (target = --bps/--creator) ──
  const FIN = [{ address: GZUB, verified: true, share: 100 }];
  const mmk = (o) => K.parseMetadata(encMd({ ua: MS, mint: m7.mint, name: "Capy Warrior #7", uri: NEWU, fee: 300, creators: FIN, coll: { verified: true, key: K.COLLECTION_MINT }, ...o }));
  const G = (m, wantUri = NEWU, isCollection = false, target = T) => lockS.gate(m, { isCollection, wantUri, target });
  assert.deepStrictEqual(G(mmk({})), []);
  assert.ok(G(mmk({}), good[8]).length === 1, "uri != map");
  assert.ok(G(mmk({ uri: K.OLD_BASE + 7 }), K.OLD_BASE + 7).some((x) => /vercel/.test(x)), "still on Vercel");
  assert.ok(G(mmk({ fee: 100 })).length === 1, "today's members (100 bps) are refused");
  assert.ok(G(mmk({ creators: [{ address: GZUB, verified: false, share: 100 }] })).length === 1, "unverified creator");
  assert.ok(G(mmk({}), NEWU, false, { bps: 250, creator: GZUB }).length === 1, "a different --bps is refused");
  assert.ok(G(mmk({}), NEWU, false, { bps: 300, creator: Keypair.generate().publicKey.toBase58() }).length === 1, "a different --creator is refused");
  assert.ok(G(mmk({ coll: { verified: false, key: K.COLLECTION_MINT } })).some((x) => /collection not verified/.test(x)));
  assert.ok(G(mColl, mColl.uri, true).length >= 3, "today's collection: Vercel uri, 500 bps, mint_state creator");
  ok("lock gates: uri == map, off Vercel; members AND collection need exactly --bps with [--creator:100 verified]");

  // ── royalty plan on REAL bytes: mainnet accounts (before) and LiteSVM on X1 Metaplex (after) ──
  const strip = (p) => ({ update: p.update, sign: p.sign, blocked: p.blocked });
  assert.deepStrictEqual(strip(K.royaltyPlan(mm1, MS, T)), { update: true, sign: false, blocked: null }, "member: update only");
  assert.deepStrictEqual(strip(K.royaltyPlan(mColl, MS, T)), { update: true, sign: true, blocked: null }, "collection: update + sign");
  assert.ok(K.royaltyPlan(mm1, MS, { bps: 300, creator: Keypair.generate().publicKey.toBase58() }).blocked.includes(GZUB), "other creator: GZuB would have to un-verify (55)");
  assert.ok(K.royaltyPlan({ ...mm1, isMutable: false }, MS, T).blocked.includes("locked"));
  assert.ok(K.royaltyPlan({ ...mm1, fee: 300 }, MS, T).done, "already final");
  for (const f of ["royalty_member_after.bin", "royalty_collection_after.bin", "royalty_member_locked.bin"]) {
    const a = P(f);
    assert.ok(K.royaltyIsFinal(a, T) && K.royaltyPlan(a, MS, T).done, f);
    assert.ok(!lockS.gate(a, { isCollection: f.includes("collection"), wantUri: a.uri, target: T }).some((x) => /royalty|creators/.test(x)), f + " passes the lock royalty gate");
  }
  assert.strictEqual(K.fingerprint(mm1, "fee", "creators"), K.fingerprint(P("royalty_member_after.bin"), "fee", "creators"), "read-back comparator: only fee/creators differ");
  assert.strictEqual(K.fingerprint(mColl, "fee", "creators"), K.fingerprint(P("royalty_collection_after.bin"), "fee", "creators"));
  ok("royalty plan on real bytes: members → update only, collection → update + sign; LiteSVM results are final; other creator → blocked");

  // ── update_royalty.cjs instruction bytes (same as royalty_final.rs) ──
  const pc = { ...mColl, pda: K.COLLECTION_METADATA };
  const ixs = roy.royaltyIxs(prog, ms, auth, pc, K.royaltyPlan(mColl, MS, T), T);
  assert.deepStrictEqual(ixs.map((x) => x.programId.toBase58()), [prog.toBase58(), K.MPL.toBase58()]);
  assert.strictEqual(ixs[0].data.toString("hex"), roy.DISC.toString("hex") + "2c01" + "01000000" + new PublicKey(GZUB).toBuffer().toString("hex") + "64");
  assert.deepStrictEqual(ixs[0].keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]), [[MS, false, false], [auth.toBase58(), true, false], [K.COLLECTION_METADATA, false, true], [K.MPL.toBase58(), false, false]]);
  assert.deepStrictEqual([...ixs[1].data], [7]);
  assert.deepStrictEqual(ixs[1].keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]), [[K.COLLECTION_METADATA, false, true], [GZUB, true, false]]);
  assert.strictEqual(roy.royaltyIxs(prog, ms, auth, { ...mm1, pda: K.mdPda(mm1.mint).toBase58() }, K.royaltyPlan(mm1, MS, T), T).length, 1);
  assert.strictEqual(roy.updateRoyaltyIx(prog, ms, auth, K.COLLECTION_METADATA, 250, GZUB).data.readUInt16LE(8), 250, "bps comes from the argument");
  assert.throws(() => roy.updateRoyaltyIx(prog, ms, auth, K.COLLECTION_METADATA, 10001, GZUB));
  ok("update_royalty.cjs: update_royalty(bps,[creator:100]) [+ SignMetadata(creator)], IDL discriminator, bps from the argument");

  // ── map sha256 record (RISE audit L3) ──
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "capy-map-"));
  const mp = path.join(tmp, "uri_map.json");
  fs.writeFileSync(mp, JSON.stringify({ ...good, collection: `https://ipfs.x1forge.xyz/ipfs/${QM}` }));
  const sh = K.sha256File(mp);
  assert.ok(K.checkVerifyRecord(mp, ["members"], sh).some((x) => /no passing/.test(x)), "no record yet");
  K.writeVerifyRecord(mp, "members", { checked: 500 });
  assert.deepStrictEqual(K.checkVerifyRecord(mp, ["members"], sh), []);
  assert.ok(K.checkVerifyRecord(mp, ["members", "collection"], sh).some((x) => /collection/.test(x)), "collection scope missing");
  assert.ok(K.checkVerifyRecord(mp, ["members"], "0".repeat(64)).some((x) => /--map-sha256 says/.test(x)), "wrong hand-recorded sha");
  fs.writeFileSync(mp, JSON.stringify({ ...good, 7: `https://ipfs.x1forge.xyz/ipfs/${QM}` }));
  const sh2 = K.sha256File(mp);
  assert.ok(K.checkVerifyRecord(mp, ["members"], sh2).some((x) => /verified against map sha256/.test(x)), "map edited after verify");
  ok("map record: lock needs --map-sha256 == file == the sha256 a full --verify recorded, per scope");

  // ── make_uri_map.cjs ──
  const built = mk.build(cidsV2, "https://ipfs.x1forge.xyz");
  assert.deepStrictEqual(built, good);
  const exp = path.join(fz, "uri_map.expected.json");
  assert.strictEqual(fs.readFileSync(exp, "utf8"), JSON.stringify(good, null, 2) + "\n", "committed uri_map.expected.json = metadata-cids-v2.json on ipfs.x1forge.xyz");
  assert.strictEqual(K.sha256File(exp), "2c0201cf0c622a3f861ed8c36f7cc4708f06327967dee97a54b7266cf170adb3");
  const b2 = mk.build(cidsV2, "https://ipfs.x1forge.xyz", { collectionCid: QM, set: "4=QmTYE7JJBTnu9juAb4FcBCG56SxFotsJ4Ryw41NgQPHSSW" });
  assert.strictEqual(b2[4], "https://ipfs.x1forge.xyz/ipfs/QmTYE7JJBTnu9juAb4FcBCG56SxFotsJ4Ryw41NgQPHSSW"); assert.strictEqual(b2.collection, `https://ipfs.x1forge.xyz/ipfs/${QM}`);
  for (const [g, o] of [["https://ipfs.x1forge.xyz/", {}], ["http://ipfs.x1forge.xyz", {}], ["https://ipfs.x1forge.xyz", { set: "0=" + QM }], ["https://ipfs.x1forge.xyz", { collectionCid: "bafy" }]])
    assert.throws(() => mk.build(cidsV2, g, o));
  assert.throws(() => mk.build({ ...cidsV2, 3: undefined }, "https://ipfs.x1forge.xyz"), /cids\["3"\]/);
  ok("make_uri_map.cjs: rebuilds the committed expected map (sha256 2c0201cf…); --set / --collection-cid validated");

  // ── vault_collection.cjs ──
  assert.strictEqual(vault.MINT_STATE.toBase58(), vault.EXPECTED_MINT_STATE);
  assert.strictEqual(vault.ata(vault.MINT_STATE).toBase58(), vault.EXPECTED_DEST);
  assert.strictEqual(vault.EXPECTED_DEST, "HM272gVwG2St7eKfwzxP2fXdn8YUDcWyqRcSmdMcXAZE");
  assert.strictEqual(PublicKey.isOnCurve(vault.MINT_STATE.toBuffer()), false, "PDA: no key");
  const holderPk = new PublicKey(vault.EXPECTED_HOLDER), src = vault.ata(holderPk);
  assert.strictEqual(src.toBase58(), "6PqM7be444tdwNRhkWtgSakJBms5ZvneeUx55WLKkvve", "the holder ATA read from mainnet");
  const [cr, tr] = vault.vaultIxs(holderPk, src);
  assert.deepStrictEqual([...cr.data], [1]); assert.strictEqual(cr.keys[1].pubkey.toBase58(), vault.EXPECTED_DEST); assert.strictEqual(cr.keys[2].pubkey.toBase58(), vault.EXPECTED_MINT_STATE);
  assert.deepStrictEqual(cr.keys.map((k) => [k.isSigner, k.isWritable]), [[true, true], [false, true], [false, false], [false, false], [false, false], [false, false]]);
  assert.strictEqual(tr.data.toString("hex"), "0c" + "0100000000000000" + "00", "TransferChecked 1, decimals 0");
  assert.deepStrictEqual(tr.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]), [[src.toBase58(), false, true], [K.COLLECTION_MINT, false, false], [vault.EXPECTED_DEST, false, true], [holderPk.toBase58(), true, false]]);
  const ed = vault.editionPda().toBase58();
  assert.strictEqual(ed, vault.EXPECTED_EDITION);
  const collFinal = { ...mColl, fee: 300, creators: FIN, isMutable: false };
  const st = (o = {}) => ({ mint: { supply: 1n, decimals: 0, mintAuthority: ed, freezeAuthority: ed }, holders: [{ address: src.toBase58(), info: { owner: holderPk.toBase58(), amount: 1n, state: 1, delegate: null } }],
    collection: collFinal, lockedMembers: 500, holder: holderPk.toBase58(), target: T, ...o });
  assert.deepStrictEqual(vault.gate(st()), []);
  assert.ok(vault.gate(st({ collection: { ...collFinal, isMutable: true } })).some((x) => /not LOCKED/.test(x)));
  assert.ok(vault.gate(st({ collection: { ...mColl, isMutable: false } })).some((x) => /royalty/.test(x)));
  assert.ok(vault.gate(st({ target: { bps: 250, creator: GZUB } })).some((x) => /royalty/.test(x)));
  assert.ok(vault.gate(st({ lockedMembers: 499 })).some((x) => /499\/500/.test(x)));
  assert.ok(vault.gate(st({ holder: Keypair.generate().publicKey.toBase58() })).some((x) => /holder keypair/.test(x)));
  assert.ok(vault.gate(st({ holders: [{ address: src.toBase58(), info: { owner: holderPk.toBase58(), amount: 1n, state: 2, delegate: null } }] })).some((x) => /frozen/.test(x)));
  assert.ok(vault.gate(st({ holders: [{ address: vault.EXPECTED_DEST, info: { owner: vault.EXPECTED_MINT_STATE, amount: 1n, state: 1, delegate: null } }] })).some((x) => /already in the vault/.test(x)));
  assert.ok(vault.gate(st({ holders: [] })).some((x) => /0 token accounts/.test(x)));
  assert.ok(vault.gate(st({ mint: { supply: 1n, decimals: 0, mintAuthority: holderPk.toBase58(), freezeAuthority: ed } })).some((x) => /mint authority/.test(x)));
  const vgood = { mint: K.COLLECTION_MINT, owner: vault.EXPECTED_MINT_STATE, amount: 1n, delegate: null, closeAuthority: null, state: 1 };
  assert.deepStrictEqual(vault.checkVaulted(vgood, { amount: 0n }), []);
  assert.ok(vault.checkVaulted({ ...vgood, owner: "1nc1nerator11111111111111111111111111111111" }, { amount: 0n }).some((x) => /owner/.test(x)), "incinerator-owned refused");
  assert.ok(vault.checkVaulted(vgood, { amount: 1n }).some((x) => /source/.test(x)));
  assert.ok(fs.readFileSync(path.join(fz, "vault_collection.cjs"), "utf8").includes("--fee-payer"), "L6: the printed spl-token close has --fee-payer");
  ok("vault_collection.cjs: destination HM272gVw… = ATA(mint_state PDA) pinned, CreateIdempotent + TransferChecked(1), gates incl. royalty target, post-check");

  // ── refusal paths (exit before any network call) ──
  const run = (script, args) => spawnSync(process.execPath, [path.join(fz, script), ...args], { encoding: "utf8" });
  const refuse = (script, args, re) => { const r = run(script, args); assert.strictEqual(r.status, 1, `${script} ${args.join(" ")}: ${r.stdout}${r.stderr}`); assert.match(r.stderr, re, `${script} ${args.join(" ")}`); };
  const RPC = ["--rpc", "http://127.0.0.1:9"], R = ["--bps", "300", "--creator", GZUB];
  let cnt = 0;
  const X = (s, a, re) => { refuse(s, a, re); cnt++; };
  X("sweep_uri.cjs", [...RPC, "--map", "x.json", "--send"], /confirm-mainnet/);
  X("sweep_uri.cjs", [...RPC], /--map/);
  X("sweep_uri.cjs", ["--map", "x.json"], /--rpc/);
  X("sweep_uri.cjs", [...RPC, "--map", "x.json", "--limit", "abc"], /positive integer/);
  X("sweep_uri.cjs", [...RPC, "--map", "x.json", "--token", "0"], /1\.\.500/);
  X("sweep_uri.cjs", [...RPC, "--map", "x.json", "--collection", "--token", "1"], /exclusive/);
  X("sweep_uri.cjs", [...RPC, "--map", "x.json", "--verify", "--send", "--confirm-mainnet"], /read-only/);
  X("sweep_uri.cjs", [...RPC, "--map", "x.json", "--verify", "--collection"], /--collection-json/);
  X("sweep_uri.cjs", [...RPC, "--map", "x.json", "--collection-json", "c.json"], /only applies/);
  X("sweep_uri.cjs", [...RPC, "--map", "x.json", "--revert"], /unknown argument/);
  X("sweep_uri.cjs", [...RPC, "--map", "x.json", "--verify", "--allow-vercel-diff", "image"], /unknown argument/);
  X("sweep_uri.cjs", [...RPC, "--map", "x.json", "--verify", "--skip-vercel-compare"], /unknown argument/);
  X("lock_metadata.cjs", [...RPC, "--map", "x.json"], /exactly one/);
  X("lock_metadata.cjs", [...RPC, "--map", "x.json", "--all", "--token", "1"], /exactly one/);
  X("lock_metadata.cjs", [...RPC, "--map", "x.json", "--all", "--send"], /confirm-mainnet/);
  X("lock_metadata.cjs", [...RPC, "--all"], /--map/);
  X("lock_metadata.cjs", ["--status"], /--rpc/);
  X("lock_metadata.cjs", [...RPC, "--status", "--send", "--confirm-mainnet"], /read-only/);
  X("lock_metadata.cjs", [...RPC, "--status", ...R], /--status takes only/);
  X("lock_metadata.cjs", [...RPC, "--map", "x.json", "--token", "7", ...R], /--map-sha256/);
  X("lock_metadata.cjs", [...RPC, "--map", "x.json", "--token", "7", "--map-sha256", "0".repeat(64)], /--bps.*required/);
  X("lock_metadata.cjs", [...RPC, "--map", "x.json", "--token", "7", "--map-sha256", "0".repeat(64), "--bps", "300"], /--creator.*required/);
  X("lock_metadata.cjs", [...RPC, "--map", "x.json", "--token", "7", "--map-sha256", "abc", ...R], /64 lowercase hex/);
  X("lock_metadata.cjs", [...RPC, "--map", "x.json", "--token", "7", "--map-sha256", "0".repeat(64), ...R, "--expect-bps", "100"], /unknown argument/);
  X("lock_metadata.cjs", [...RPC, "--map", mp, "--all", "--map-sha256", sh2, ...R], /no passing sweep_uri.cjs --verify recorded for collection|verified against map sha256/);
  X("lock_metadata.cjs", [...RPC, "--map", mp, "--token", "7", "--map-sha256", sh, ...R], /--map-sha256 says|verified against/);
  X("update_royalty.cjs", [...RPC, ...R, "--send"], /confirm-mainnet/);
  X("update_royalty.cjs", [...RPC], /--bps.*required/);
  X("update_royalty.cjs", [...RPC, "--bps", "300"], /--creator.*required/);
  X("update_royalty.cjs", [...RPC, "--creator", GZUB], /--bps.*required/);
  X("update_royalty.cjs", [...R], /--rpc/);
  X("update_royalty.cjs", [...RPC, ...R, "--limit", "abc"], /positive integer/);
  X("update_royalty.cjs", [...RPC, ...R, "--mint", "x"], /unknown argument/);
  X("update_royalty.cjs", [...RPC, ...R, "--token", "500a"], /1\.\.500/);
  X("update_royalty.cjs", [...RPC, ...R, "--cluster", "testnet"], /unknown argument/);
  X("update_royalty.cjs", [...RPC, ...R, "--collection", "--token", "1"], /exclusive/);
  X("update_royalty.cjs", [...RPC, "--bps", "300", "--creator", K.EXPECTED_MINT_STATE], /off curve/);
  X("update_royalty.cjs", [...RPC, "--bps", "300", "--creator", GZUB, "--creator", GZUB], /twice/);
  X("update_royalty.cjs", [...RPC, "--bps", "", "--creator", GZUB], /0\.\.10000/);
  X("update_royalty.cjs", [...RPC, "--bps", "--creator", GZUB], /needs a value/);
  X("vault_collection.cjs", [...RPC, ...R, "--send"], /confirm-mainnet/);
  X("vault_collection.cjs", [...RPC, "--verify", "--send", "--confirm-mainnet"], /read-only/);
  X("vault_collection.cjs", [...RPC], /--bps.*required/);
  X("vault_collection.cjs", [...RPC, ...R, "--dest", "x"], /unknown argument/);
  X("vault_collection.cjs", [...RPC, ...R, "--program", K.DEFAULT_PROGRAM], /unknown argument/);
  X("readonly_checks.cjs", ["update-sim", ...RPC], /exactly one/);
  X("readonly_checks.cjs", ["editions"], /--rpc/);
  X("readonly_checks.cjs", ["send"], /editions or update-sim/);
  X("make_uri_map.cjs", ["--cids", "public/metadata-cids-v2.json"], /--gateway/);
  X("make_uri_map.cjs", ["--cids", path.join(repo, "public/metadata-cids-v2.json"), "--gateway", "https://ipfs.x1forge.xyz", "--out", exp], /exists/);
  ok(`refusal paths: ${cnt} bad invocations exit 1 before any network call (no default RPC, no default royalty, no override flags)`);
  for (const f of fs.readdirSync(fz).filter((x) => x.endsWith(".cjs"))) assert.strictEqual(spawnSync(process.execPath, ["--check", path.join(fz, f)]).status, 0, f);
  ok("node --check on every freeze/*.cjs");
  // keypair paths: no script opens a keypair before --send (static check of the source)
  for (const f of ["sweep_uri.cjs", "lock_metadata.cjs", "update_royalty.cjs", "vault_collection.cjs"]) {
    const src = fs.readFileSync(path.join(fz, f), "utf8");
    const firstRead = src.indexOf("Keypair.fromSecretKey");
    assert.ok(firstRead > 0, f);
    const before = src.slice(0, firstRead);
    assert.ok(/if \(!SEND\)[\s\S]*return;[\s\S]*$/.test(before) || /if \(SEND\) \{\s*$/.test(before.trimEnd().slice(-40)) || /if \(SEND\) \{[^}]*$/.test(before.slice(-120)), `${f}: keypair read only on the send path`);
  }
  for (const f of fs.readdirSync(fz).filter((x) => x.endsWith(".cjs"))) assert.ok(!/pinata\/jwt|\.config\/pinata/.test(fs.readFileSync(path.join(fz, f), "utf8")), `${f} never touches the Pinata JWT`);
  ok("static: keypairs are read only on the --send path; no script references the Pinata JWT");
  // (the temporary map directory is left in os.tmpdir(); nothing is deleted)
  console.log(`\nALL ${n} OFFLINE CHECK GROUPS PASSED`);
})().catch((e) => { console.error("FAILED:", e); process.exit(1); });
