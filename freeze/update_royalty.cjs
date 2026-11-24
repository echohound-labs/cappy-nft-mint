// Set the FINAL royalty on every Capy Warriors member and on the collection NFT. The target is
// an ARGUMENT (owner's decision): --bps <0..10000> --creator <pubkey>, single creator, share 100,
// VERIFIED. Port of RISE update_royalty.cjs (3dbbed3). Supersedes the repo-root update_royalty.cjs
// (fixed 100 bps target, loose argument parsing): do not use that one for the freeze.
//
//   R="--bps <BPS> --creator <PUBKEY>"
//   node freeze/update_royalty.cjs --rpc $RPC $R                              dry-run: 500 members
//   node freeze/update_royalty.cjs --rpc $RPC $R --token 1                    dry-run, one member
//   node freeze/update_royalty.cjs --rpc $RPC $R --collection                 dry-run, the collection NFT
//   node freeze/update_royalty.cjs --rpc $RPC $R --token 1 --send --confirm-mainnet      PILOT
//   node freeze/update_royalty.cjs --rpc $RPC $R --send --confirm-mainnet                all members still to do
//   node freeze/update_royalty.cjs --rpc $RPC $R --collection --send --confirm-mainnet   the collection NFT
//
// Options: --program <id>, --limit <n>, --priority <µLamports/CU>,
//          --authority-keypair <path>  mint_state.authority 2EMb… (default ~/.config/solana/capy-mint-authority.json)
//          --creator-keypair <path>    the --creator key, signs SignMetadata where needed
//                                      (default ~/.config/solana/capy-lp-treasury.json); opened only if a
//                                      pending token needs the signature, and must equal --creator
//
// What each token needs today (proven in contract/tests/svm/tests/royalty_final.rs on X1 mainnet's
// Token Metadata and mainnet bytes), for a target creator of GZuB…:
//   500 members  [GZuB:100 ✓] @ 100 bps        update_royalty only (GZuB keeps its verified flag)
//   collection   [mint_state:100 ✓] @ 500 bps  update_royalty + SignMetadata(GZuB)
// Any other target creator BLOCKS the members (GZuB would have to un-verify itself first: Metaplex 55).
// All steps of one token are ONE transaction, so a token is never left half-done.
//
// Safety:
//   * Members = the shared discovery (K.discover): update authority mint_state AND verified
//     collection HC8zqrya… AND name "Capy Warrior #N", exactly 500, numbered 1..500, each at its
//     mint's metadata PDA. A spoof can never be signed by the creator key.
//   * Strict arguments; --rpc, --bps and --creator are required. Dry-run is the default and never
//     opens a keypair. --send needs --confirm-mainnet. Keypairs must be the expected public keys.
//   * Any token that cannot reach the target (locked, or another verified creator) blocks the run.
//   * Each token is read again and re-planned right before its send (RISE audit L4); if it changed
//     since discovery the run stops (exit 2) without sending.
//   * After each send the account is read back with retries: royalty must be final and every other
//     field (including raw trailing bytes) unchanged. Else exit 2. Re-runs skip tokens already final.

const { Connection, PublicKey, Keypair, Transaction, TransactionInstruction, ComputeBudgetProgram, sendAndConfirmTransaction } = require("@solana/web3.js");
const crypto = require("crypto"), fs = require("fs");
const K = require("./capy_meta_common.cjs");

const HOME = process.env.HOME;
const DEFAULT_KP = {
  authority: HOME + "/.config/solana/capy-mint-authority.json",
  creator: HOME + "/.config/solana/capy-lp-treasury.json",
};
const DISC = crypto.createHash("sha256").update("global:update_royalty").digest().slice(0, 8);

// update_royalty(seller_fee_basis_points: u16, creators: Vec<CreatorArg{address, share}>)
function updateRoyaltyIx(program, mintState, authority, metadata, bps, creator) {
  if (!Number.isInteger(bps) || bps < 0 || bps > 10000) throw new Error(`bps ${bps}`);
  const b = Buffer.alloc(2); b.writeUInt16LE(bps);
  const len = Buffer.alloc(4); len.writeUInt32LE(1);
  return new TransactionInstruction({
    programId: new PublicKey(program),
    keys: [
      { pubkey: new PublicKey(mintState), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(authority), isSigner: true, isWritable: false },
      { pubkey: new PublicKey(metadata), isSigner: false, isWritable: true },
      { pubkey: K.MPL, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([DISC, b, len, new PublicKey(creator).toBuffer(), Buffer.from([100])]),
  });
}
const signMetadataIx = (metadata, creator) => new TransactionInstruction({
  programId: K.MPL,
  keys: [
    { pubkey: new PublicKey(metadata), isSigner: false, isWritable: true },
    { pubkey: new PublicKey(creator), isSigner: true, isWritable: false },
  ],
  data: Buffer.from([7]),
});

function royaltyIxs(program, mintState, authority, m, plan, target) {
  const ixs = [];
  if (plan.update) ixs.push(updateRoyaltyIx(program, mintState, authority, m.pda, target.bps, target.creator));
  if (plan.sign) ixs.push(signMetadataIx(m.pda, target.creator));
  return ixs;
}

const short = (a) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const fmt = (m) => `${m.fee}bps ` + ((m.creators || []).map((c) => `${short(c.address)}:${c.share}${c.verified ? "✓" : "✗"}`).join(",") || "no-creators");
const steps = (p, t) => [p.update ? "update" : null, p.sign ? `sign ${short(t.creator)}` : null].filter(Boolean).join(" + ");

async function main() {
  let a, target;
  try {
    a = K.parseArgs(process.argv.slice(2), {
      flags: ["--send", "--confirm-mainnet", "--collection"],
      opts: {
        "--rpc": K.V.url, "--bps": K.V.bps, "--creator": K.V.walletPubkey, "--token": K.V.tokenNumber, "--limit": K.V.positiveInt,
        "--program": K.V.pubkey, "--priority": K.V.nonNegInt, "--authority-keypair": K.V.any, "--creator-keypair": K.V.any,
      },
    });
    target = K.royaltyTarget(a.opts);
  } catch (e) { console.error("Refusing:", e.message); process.exit(1); }
  const has = (f) => a.flags.has(f);
  const SEND = has("--send"), COLL = has("--collection");
  const ONLY_TOKEN = a.opts["--token"] !== undefined ? +a.opts["--token"] : null;
  if (COLL && ONLY_TOKEN !== null) { console.error("Refusing: --collection and --token are exclusive."); process.exit(1); }
  if (SEND && !has("--confirm-mainnet")) { console.error("Refusing: --send on mainnet requires --confirm-mainnet as well."); process.exit(1); }
  if (!a.opts["--rpc"]) { console.error("Refusing: --rpc <url> is required (no default cluster)."); process.exit(1); }
  const RPC = a.opts["--rpc"];
  const PROGRAM = new PublicKey(a.opts["--program"] || K.DEFAULT_PROGRAM);
  const PRIORITY = a.opts["--priority"] !== undefined ? +a.opts["--priority"] : 1_000_000;
  const LIMIT = a.opts["--limit"] !== undefined ? +a.opts["--limit"] : 0;
  const KP = { authority: a.opts["--authority-keypair"] || DEFAULT_KP.authority, creator: a.opts["--creator-keypair"] || DEFAULT_KP.creator };
  const MINT_STATE = K.mintStatePda(PROGRAM);
  const MS = MINT_STATE.toBase58();
  const isColl = (m) => m.pda === K.COLLECTION_METADATA;
  const label = (m) => (isColl(m) ? "collection" : `#${K.num(m)}`);

  const c = new Connection(RPC, "confirmed");
  console.log(`rpc       : ${RPC}\nprogram   : ${PROGRAM.toBase58()}\nmint_state: ${MS}`);
  console.log(`target    : ${target.bps} bps, [${target.creator}:100 verified]   (from --bps/--creator)`);
  console.log(`scope     : ${COLL ? "collection NFT only" : ONLY_TOKEN !== null ? `member #${ONLY_TOKEN}` : "all 500 members"}`);
  console.log(`mode      : ${SEND ? "SEND" : "DRY-RUN (nothing is signed or sent; no keypair is opened)"}\n`);

  const ms = await c.getAccountInfo(MINT_STATE);
  if (!ms) throw new Error("mint_state account not found on this cluster");
  const authority = new PublicKey(ms.data.slice(12, 44));
  const { members, collection, ignored } = await K.discover(c, MINT_STATE);
  console.log(`authority : ${authority.toBase58()} (from mint_state)`);
  console.log(`discovered: ${members.length} verified members of ${K.COLLECTION_MINT} + the collection NFT` +
    (ignored.length ? ` (${ignored.length} other account(s) naming mint_state ignored, never touched)` : ""));

  const items = COLL ? [collection] : ONLY_TOKEN !== null ? members.filter((m) => K.num(m) === ONLY_TOKEN) : members;
  const planned = items.map((m) => ({ m, p: K.royaltyPlan(m, MS, target) }));
  const groups = {};
  for (const { m, p } of planned) {
    const g = p.done ? "already final" : p.blocked ? `BLOCKED: ${p.blocked}` : `${fmt(m)} -> ${steps(p, target)}`;
    (groups[g] = groups[g] || []).push(label(m));
  }
  console.log(`\n${items.length} target(s) by current state:`);
  for (const [g, l] of Object.entries(groups)) console.log(`  ${String(l.length).padStart(3)}  ${g}   (${l.slice(0, 6).join(" ")}${l.length > 6 ? " …" : ""})`);
  const blocked = planned.filter((x) => !x.p.done && x.p.blocked);
  if (blocked.length) { console.error(`\nRefusing: ${blocked.length} target(s) cannot reach ${target.bps} bps [${short(target.creator)}:100✓].`); process.exit(1); }
  let pending = planned.filter((x) => !x.p.done);
  console.log(`\n${items.length} target(s): ${items.length - pending.length} already final, ${pending.length} to change, of which ${pending.filter((x) => x.p.sign).length} need the creator's SignMetadata`);
  if (LIMIT && pending.length > LIMIT) { pending = pending.slice(0, LIMIT); console.log(`--limit ${LIMIT}: only processing the first ${LIMIT}`); }
  if (!pending.length) return;

  const buildTx = (auth, m, p) => {
    const tx = new Transaction()
      .add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY }))
      .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 150_000 }));
    for (const ix of royaltyIxs(PROGRAM, MINT_STATE, auth, m, p, target)) tx.add(ix);
    tx.feePayer = auth;
    return tx;
  };

  if (!SEND) {
    const seen = new Set();
    const { blockhash } = await c.getLatestBlockhash();
    for (const { m, p } of pending) {
      const key = steps(p, target);
      if (seen.has(key)) continue;
      seen.add(key);
      const tx = buildTx(authority, m, p);
      tx.recentBlockhash = blockhash;
      const sim = await c.simulateTransaction(tx).catch((e) => ({ value: { err: e.message, logs: [] } }));
      console.log(`simulation of ${label(m)} (${key}): ${sim.value.err ? "FAILS " + JSON.stringify(sim.value.err) : `ok (${sim.value.unitsConsumed} CU)`}`);
      if (sim.value.err) (sim.value.logs || []).slice(-6).forEach((l) => console.log("   " + l));
    }
    console.log("\nDry run. Nothing sent. Add --send --confirm-mainnet to apply.");
    return;
  }

  const load = (f) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(f))));
  const authKp = load(KP.authority);
  if (!authKp.publicKey.equals(authority)) throw new Error(`${KP.authority} is ${authKp.publicKey.toBase58()}, not mint_state.authority ${authority.toBase58()}`);
  let creatorKp = null;
  if (pending.some((x) => x.p.sign)) {
    creatorKp = load(KP.creator);
    if (creatorKp.publicKey.toBase58() !== target.creator) throw new Error(`${KP.creator} is ${creatorKp.publicKey.toBase58()}, not --creator ${target.creator}`);
  }
  console.log(`\nsigning as ${authKp.publicKey.toBase58()} (authority)${creatorKp ? `, ${target.creator} (creator)` : ""}`);
  let sent = 0, failed = 0;
  const failures = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (const { m } of pending) {
    process.stdout.write(`${label(m).padStart(10)} … `);
    // Re-read and re-plan right before sending (RISE audit L4).
    const now = await c.getAccountInfo(new PublicKey(m.pda), "confirmed").catch(() => null);
    const cur = now ? K.parseMetadata(now.data) : null;
    if (!cur || K.fingerprint(cur) !== K.fingerprint(m, "pda")) {
      if (cur && K.royaltyIsFinal(cur, target) && K.fingerprint(cur, "fee", "creators") === K.fingerprint(m, "fee", "creators", "pda")) { console.log("already final (since discovery), skipped"); continue; }
      console.log(`\n\nSTOP: ${label(m)} changed since discovery. Nothing sent for it. Is something else using the authority key?`);
      process.exit(2);
    }
    const p = K.royaltyPlan({ ...cur, pda: m.pda }, MS, target);
    if (p.done) { console.log("already final, skipped"); continue; }
    if (p.blocked) { console.log(`\n\nSTOP: ${label(m)} is now blocked: ${p.blocked}`); process.exit(2); }
    if (p.sign && !creatorKp) { console.log(`\n\nSTOP: ${label(m)} now needs the creator signature; re-run.`); process.exit(2); }
    let sig;
    try {
      const signers = [authKp];
      if (p.sign) signers.push(creatorKp);
      sig = await sendAndConfirmTransaction(c, buildTx(authKp.publicKey, m, p), signers, { commitment: "confirmed" });
    } catch (e) {
      console.log(`FAILED — ${e.message.split("\n")[0].slice(0, 140)}`);
      failed++; failures.push({ tag: label(m), error: e.message });
      await sleep(400);
      continue;
    }
    const rb = await K.readBack(c, m.pda, (x) => K.royaltyIsFinal(x, target), (x) => K.fingerprint(x, "fee", "creators") === K.fingerprint(m, "fee", "creators", "pda"));
    if (!rb.ok) {
      console.log(`${sig}\n\nSTOP: post-send check failed for ${label(m)}${rb.notLanded ? ` (final royalty not visible after ${rb.tries} reads; re-run to re-check)` : " (a field other than royalty/creators changed)"}.`);
      console.log("before:", JSON.stringify(m));
      console.log("after :", JSON.stringify(rb.after));
      process.exit(2);
    }
    console.log(sig);
    sent++;
    await sleep(400);
  }
  console.log(`\nupdated: ${sent}   failed: ${failed}`);
  if (failures.length) {
    console.log("failures (re-run the same command to retry only these):");
    failures.slice(0, 20).forEach((f) => console.log(`  ${f.tag}  ${f.error.split("\n")[0].slice(0, 100)}`));
    process.exit(1);
  }
}

if (require.main === module) main().catch((e) => { console.error("ERR", e.message); process.exit(1); });
module.exports = { updateRoyaltyIx, signMetadataIx, royaltyIxs, DISC };
