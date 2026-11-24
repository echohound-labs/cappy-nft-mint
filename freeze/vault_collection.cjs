// Move the Capy Warriors collection NFT token (mint HC8zqrya…) into the "vault": the associated
// token account OWNED BY THE mint_state PDA. Port of RISE vault_collection.cjs (3dbbed3).
//
//   R="--bps <BPS> --creator <PUBKEY>"     the final royalty the collection must already carry
//   node freeze/vault_collection.cjs --rpc $RPC $R                            dry-run: read-only gates + simulation
//   node freeze/vault_collection.cjs --rpc $RPC $R --send --confirm-mainnet   create the vault ATA if needed + transfer
//   node freeze/vault_collection.cjs --rpc $RPC --verify                      read-only: the token is in the vault
//
// Options: --priority <µLamports/CU>,
//          --holder-keypair <path>  current holder (default ~/.config/solana/capy-mint-authority.json = 2EMb…)
//
// Why: whoever holds the collection token can Metaplex-BurnNft the collection NFT, which WIPES its
// metadata, even when it is locked (contract/tests/svm/tests/vault_collection.rs, on X1's binaries).
// Why the vault and not the incinerator: SPL Token lets ANYONE burn a token held by an
// incinerator- or system-owned account. mint_state 5y1GoGNf… is a PDA (off curve, no key); only the
// Capy program can sign for it and the freeze build has no token-program CPI. Permanent once the
// upgrade authority is renounced; until then the upgrade authority could deploy code that signs.
//
// Gates before --send (all must hold; any failure refuses):
//   * the collection metadata Cx6vNq7… is LOCKED and at the --bps/--creator royalty, and 500/500
//     members are locked (this is the step AFTER lock-all)
//   * mint HC8zqrya…: supply 1, decimals 0, mint + freeze authority = its edition PDA 2D6xtMJk…
//   * exactly one token account holds it: amount 1, not frozen, no delegate, owned by the
//     --holder-keypair's public key, at that key's ATA (today 6PqM7be…, owner 2EMb…)
//   * destination = ATA(mint_state, HC8zqrya…) = HM272gVw… (re-derived and compared with the pinned
//     address; mint_state re-derived from the program id and compared with 5y1GoGNf…).
//     There is no --dest or --program option.
// After sending, the destination and source are read back (retried): destination amount 1,
// owner = mint_state, no delegate, no close authority, not frozen; source 0.

const { Connection, PublicKey, Keypair, Transaction, TransactionInstruction, ComputeBudgetProgram, SystemProgram, sendAndConfirmTransaction } = require("@solana/web3.js");
const fs = require("fs");
const K = require("./capy_meta_common.cjs");

const TOKEN = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const MINT_STATE = K.mintStatePda(new PublicKey(K.DEFAULT_PROGRAM)); // the vault owner
const EXPECTED_MINT_STATE = K.EXPECTED_MINT_STATE;
const EXPECTED_DEST = "HM272gVwG2St7eKfwzxP2fXdn8YUDcWyqRcSmdMcXAZE"; // ATA(mint_state, HC8zqrya…), derived 2026-11-24
const EXPECTED_HOLDER = "2EMbtMasbwBW4MA3pwqNtQguDJLh5k3GuQ3h4nubtktX"; // read 2026-11-24: ATA 6PqM7be444tdwNRhkWtgSakJBms5ZvneeUx55WLKkvve
const EXPECTED_EDITION = "2D6xtMJk65H3uVV6KmWNg488Wk3qCe2deGp8dmPhqkc8";
const MINT = new PublicKey(K.COLLECTION_MINT);

const ata = (owner, mint = MINT) => PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN.toBuffer(), mint.toBuffer()], ATA_PROGRAM)[0];
const editionPda = (mint = MINT) => PublicKey.findProgramAddressSync([Buffer.from("metadata"), K.MPL.toBuffer(), mint.toBuffer(), Buffer.from("edition")], K.MPL)[0];

function parseTokenAccount(d) {
  const opt = (o, n) => (d.readUInt32LE(o) === 1 ? d.slice(o + 4, o + 4 + n) : null);
  const del = opt(72, 32), close = opt(129, 32);
  return {
    mint: new PublicKey(d.slice(0, 32)).toBase58(),
    owner: new PublicKey(d.slice(32, 64)).toBase58(),
    amount: d.readBigUInt64LE(64),
    delegate: del ? new PublicKey(del).toBase58() : null,
    state: d[108], // 0 uninitialized, 1 initialized, 2 frozen
    closeAuthority: close ? new PublicKey(close).toBase58() : null,
  };
}
function parseMint(d) {
  return {
    mintAuthority: d.readUInt32LE(0) === 1 ? new PublicKey(d.slice(4, 36)).toBase58() : null,
    supply: d.readBigUInt64LE(36),
    decimals: d[44],
    freezeAuthority: d.readUInt32LE(46) === 1 ? new PublicKey(d.slice(50, 82)).toBase58() : null,
  };
}

// ATA CreateIdempotent (1) for owner mint_state + SPL TransferChecked (12) of exactly 1, decimals 0.
function vaultIxs(holder, source) {
  const dest = ata(MINT_STATE);
  const create = new TransactionInstruction({
    programId: ATA_PROGRAM,
    keys: [
      { pubkey: holder, isSigner: true, isWritable: true },
      { pubkey: dest, isSigner: false, isWritable: true },
      { pubkey: MINT_STATE, isSigner: false, isWritable: false },
      { pubkey: MINT, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
  const amt = Buffer.alloc(8); amt.writeBigUInt64LE(1n);
  const transfer = new TransactionInstruction({
    programId: TOKEN,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: MINT, isSigner: false, isWritable: false },
      { pubkey: dest, isSigner: false, isWritable: true },
      { pubkey: holder, isSigner: true, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from([12]), amt, Buffer.from([0])]),
  });
  return [create, transfer];
}

function gate({ mint, holders, collection, lockedMembers, holder, target }) {
  const p = [];
  const ed = editionPda().toBase58();
  if (MINT_STATE.toBase58() !== EXPECTED_MINT_STATE) p.push(`mint_state derives to ${MINT_STATE.toBase58()}, expected ${EXPECTED_MINT_STATE}`);
  if (ata(MINT_STATE).toBase58() !== EXPECTED_DEST) p.push(`vault ATA derives to ${ata(MINT_STATE).toBase58()}, expected ${EXPECTED_DEST}`);
  if (ed !== EXPECTED_EDITION) p.push(`edition PDA derives to ${ed}, expected ${EXPECTED_EDITION}`);
  if (mint.supply !== 1n || mint.decimals !== 0) p.push(`mint supply ${mint.supply} decimals ${mint.decimals}, expected 1 / 0`);
  if (mint.mintAuthority !== ed) p.push(`mint authority ${mint.mintAuthority}, expected the edition PDA ${ed}`);
  if (mint.freezeAuthority !== ed) p.push(`freeze authority ${mint.freezeAuthority}, expected the edition PDA ${ed}`);
  if (!collection) p.push("collection metadata not found");
  else {
    if (collection.isMutable) p.push("collection metadata is not LOCKED yet (run lock_metadata.cjs --all first)");
    if (!target || !K.royaltyIsFinal(collection, target)) p.push("collection royalty is not at the --bps/--creator target");
  }
  if (lockedMembers !== K.EXPECTED_MEMBERS) p.push(`${lockedMembers}/500 members locked; this step comes after lock-all`);
  const held = holders.filter((h) => h.info.amount > 0n);
  if (held.length !== 1) p.push(`${held.length} token accounts hold the collection token, expected exactly 1`);
  else {
    const h = held[0];
    if (h.address === EXPECTED_DEST) p.push("already in the vault: nothing to do (run --verify)");
    else {
      if (h.info.amount !== 1n) p.push(`holder amount ${h.info.amount}`);
      if (h.info.state !== 1) p.push(`holder token account state ${h.info.state} (2 = frozen)`);
      if (h.info.delegate) p.push(`holder token account has a delegate ${h.info.delegate}`);
      if (holder && h.info.owner !== holder) p.push(`token is owned by ${h.info.owner}, the holder keypair is ${holder}`);
      if (h.address !== ata(new PublicKey(h.info.owner)).toBase58()) p.push(`holding account ${h.address} is not the owner's ATA`);
    }
  }
  return p;
}

function checkVaulted(dest, source) {
  const p = [];
  if (!dest) return ["vault ATA does not exist"];
  if (dest.mint !== K.COLLECTION_MINT) p.push(`vault mint ${dest.mint}`);
  if (dest.owner !== EXPECTED_MINT_STATE) p.push(`vault owner ${dest.owner}, expected mint_state ${EXPECTED_MINT_STATE}`);
  if (dest.amount !== 1n) p.push(`vault amount ${dest.amount}`);
  if (dest.delegate) p.push(`vault delegate ${dest.delegate}`);
  if (dest.closeAuthority) p.push(`vault close authority ${dest.closeAuthority}`);
  if (dest.state !== 1) p.push(`vault state ${dest.state}`);
  if (source && source.amount !== 0n) p.push(`source still holds ${source.amount}`);
  return p;
}

async function readState(c) {
  const mi = await c.getAccountInfo(MINT);
  if (!mi || !mi.owner.equals(TOKEN)) throw new Error("collection mint not found / not an SPL Token mint");
  const mint = parseMint(mi.data);
  const largest = await c.getTokenLargestAccounts(MINT);
  const holders = [];
  for (const t of largest.value) {
    const a = await c.getAccountInfo(t.address);
    if (a && a.owner.equals(TOKEN)) holders.push({ address: t.address.toBase58(), info: parseTokenAccount(a.data) });
  }
  const { members, collection } = await K.discover(c, MINT_STATE);
  return { mint, holders, collection, lockedMembers: members.filter((m) => !m.isMutable).length };
}

async function main() {
  let a, target = null;
  try {
    a = K.parseArgs(process.argv.slice(2), {
      flags: ["--send", "--confirm-mainnet", "--verify"],
      opts: { "--rpc": K.V.url, "--priority": K.V.nonNegInt, "--holder-keypair": K.V.any, "--bps": K.V.bps, "--creator": K.V.walletPubkey },
    });
    if (!a.flags.has("--verify")) target = K.royaltyTarget(a.opts);
  } catch (e) { console.error("Refusing:", e.message); process.exit(1); }
  const has = (f) => a.flags.has(f);
  const SEND = has("--send"), VERIFY = has("--verify");
  if (SEND && !has("--confirm-mainnet")) { console.error("Refusing: --send on mainnet requires --confirm-mainnet as well."); process.exit(1); }
  if (SEND && VERIFY) { console.error("Refusing: --verify is read-only."); process.exit(1); }
  if (!a.opts["--rpc"]) { console.error("Refusing: --rpc <url> is required (no default cluster)."); process.exit(1); }
  const RPC = a.opts["--rpc"];
  const PRIORITY = a.opts["--priority"] !== undefined ? +a.opts["--priority"] : 1_000_000;
  const HOLDER_KP = a.opts["--holder-keypair"] || process.env.HOME + "/.config/solana/capy-mint-authority.json";
  const dest = ata(MINT_STATE);

  const c = new Connection(RPC, "confirmed");
  console.log(`rpc        : ${RPC}\nmint       : ${MINT.toBase58()} (CAPY Warriors collection NFT)`);
  console.log(`destination: ${dest.toBase58()} = ATA(mint_state ${MINT_STATE.toBase58()}) — off curve: ${!PublicKey.isOnCurve(MINT_STATE.toBuffer())}`);
  console.log(`mode       : ${VERIFY ? "VERIFY (read-only)" : SEND ? "SEND — IRREVERSIBLE" : "DRY-RUN (nothing is signed or sent; no keypair is opened)"}\n`);

  const readDest = async () => {
    const d = await c.getAccountInfo(dest, "confirmed").catch(() => null);
    return d ? parseTokenAccount(d.data) : null;
  };
  if (VERIFY) {
    const p = checkVaulted(await readDest(), null);
    const st = await readState(c);
    const others = st.holders.filter((h) => h.address !== dest.toBase58() && h.info.amount > 0n);
    if (others.length) p.push(`also held by ${others.map((h) => h.address).join(",")}`);
    if (p.length) { console.log("NOT in the vault:\n  " + p.join("\n  ")); process.exit(1); }
    console.log(`OK: ${dest.toBase58()} holds the collection token, owner mint_state ${MINT_STATE.toBase58()}, no delegate, no close authority, not frozen.`);
    console.log(`collection metadata ${st.collection.isMutable ? "MUTABLE" : "LOCKED"}, ${st.lockedMembers}/500 members locked`);
    return;
  }

  const st = await readState(c);
  const cur = st.holders.find((h) => h.info.amount > 0n);
  console.log(`mint       : supply ${st.mint.supply}, decimals ${st.mint.decimals}, mint/freeze authority ${st.mint.mintAuthority} / ${st.mint.freezeAuthority}`);
  console.log(`holder     : ${cur ? `${cur.address} owner ${cur.info.owner} amount ${cur.info.amount} state ${cur.info.state}` : "none"}`);
  console.log(`state      : collection ${st.collection.isMutable ? "MUTABLE" : "LOCKED"}, ${st.lockedMembers}/500 members locked`);
  console.log(`dest exists: ${!!(await readDest())} (created by the same transaction if not)\n`);

  let holderKey = null, kp = null;
  if (SEND) {
    kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(HOLDER_KP))));
    holderKey = kp.publicKey.toBase58();
  }
  const problems = gate({ ...st, holder: holderKey, target });
  console.log(problems.length ? "gates:\n  " + problems.join("\n  ") : "gates: all pass");

  const holder = new PublicKey(cur ? cur.info.owner : EXPECTED_HOLDER);
  const source = new PublicKey(cur ? cur.address : ata(holder).toBase58());
  const buildTx = () => {
    const tx = new Transaction()
      .add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY }))
      .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 60_000 }));
    for (const ix of vaultIxs(holder, source)) tx.add(ix);
    tx.feePayer = holder;
    return tx;
  };

  if (!SEND) {
    if (cur && cur.address !== dest.toBase58()) {
      const tx = buildTx();
      tx.recentBlockhash = (await c.getLatestBlockhash()).blockhash;
      const sim = await c.simulateTransaction(tx).catch((e) => ({ value: { err: e.message, logs: [] } }));
      console.log(`\nsimulation (${holder.toBase58()} → ${dest.toBase58()}): ${sim.value.err ? "FAILS " + JSON.stringify(sim.value.err) : `ok (${sim.value.unitsConsumed} CU)`}`);
      if (sim.value.err) (sim.value.logs || []).slice(-6).forEach((l) => console.log("   " + l));
    }
    console.log(`\nDry run. Nothing sent.${problems.length ? " --send would REFUSE (gates above)." : " --send --confirm-mainnet would move the token into the vault for good."}`);
    return;
  }

  if (problems.length) { console.error("\nRefusing: gates failed. Nothing sent."); process.exit(1); }
  console.log(`\nsigning as ${holderKey}; transferring the collection token to the vault ${dest.toBase58()} …`);
  const sig = await sendAndConfirmTransaction(c, buildTx(), [kp], { commitment: "confirmed" });
  console.log(`sent: ${sig}`);
  let p = [];
  for (let i = 1; i <= 6; i++) {
    const s = await c.getAccountInfo(source, "confirmed").catch(() => null);
    p = checkVaulted(await readDest(), s ? parseTokenAccount(s.data) : null);
    if (!p.length) break;
    await new Promise((r) => setTimeout(r, 1500 * i));
  }
  if (p.length) { console.log("\nSTOP: post-send check failed:\n  " + p.join("\n  ")); process.exit(2); }
  console.log(`\nOK: ${dest.toBase58()} holds the collection token (owner mint_state ${MINT_STATE.toBase58()}); ${source.toBase58()} is empty.`);
  console.log(`Optional (RISE audit L6): reclaim the empty account's rent:\n  spl-token close --address ${source.toBase58()} --owner <holder keypair> --fee-payer <holder keypair> --url <rpc>`);
}

if (require.main === module) main().catch((e) => { console.error("ERR", e.message); process.exit(1); });
module.exports = { vaultIxs, gate, checkVaulted, parseTokenAccount, parseMint, ata, editionPda, MINT_STATE, EXPECTED_MINT_STATE, EXPECTED_DEST, EXPECTED_HOLDER, EXPECTED_EDITION };
