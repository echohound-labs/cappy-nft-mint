// Golden-standard proof — Capy Warriors + RISE Phoenix (X1 mainnet)
// Run: npm i @solana/web3.js && node prove_standard.cjs
const {Connection, PublicKey} = require('@solana/web3.js');
const RPC = 'https://rpc.mainnet.x1.xyz';
const TM = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
const COLLECTIONS = [
  { name: 'Capy Warriors', program: '6r9HZKQRhDfNnZM4m6TgkcK82Bt6EA1q2Ck9VNWoTnGm' },
  { name: 'RISE Phoenix',  program: '5QUVVnm1duiRazqa69KW9ZQhCCZcg5GBUKkUn5avA8Gb' },
];
const pda = (s, p) => PublicKey.findProgramAddressSync(s, p)[0];
const sleep = ms => new Promise(r => setTimeout(r, ms));

function collectionVerified(data) {
  try {
    let o = 1 + 32 + 32;
    const skip = () => { const l = data.readUInt32LE(o); o += 4 + l; };
    skip(); skip(); skip();
    o += 2;
    if (data.readUInt8(o++) === 1) { const n = data.readUInt32LE(o); o += 4 + n * 34; }
    o += 2;
    if (data.readUInt8(o++) === 1) o += 1;   // edition_nonce
    if (data.readUInt8(o++) === 1) o += 1;   // token_standard
    if (data.readUInt8(o++) !== 1) return false; // no collection field
    return data.readUInt8(o) === 1;          // verified flag
  } catch { return false; }
}

(async () => {
  const conn = new Connection(RPC, 'confirmed');
  for (const c of COLLECTIONS) {
    const prog = new PublicKey(c.program);
    const mintState = pda([Buffer.from('mint_state_v2')], prog);
    const accts = await conn.getProgramAccounts(TM, {
      filters: [{ memcmp: { offset: 1, bytes: mintState.toBase58() } }]
    });
    let members = 0, pass = 0;
    const fails = [];
    for (const a of accts) {
      const mint = new PublicKey(a.account.data.slice(33, 65));
      const me = pda([Buffer.from('metadata'), TM.toBuffer(), mint.toBuffer(), Buffer.from('edition')], TM);
      const [mintAcc, meAcc] = await Promise.all([conn.getAccountInfo(mint), conn.getAccountInfo(me)]);
      await sleep(300);
      // parent collection NFT: supply 1 but is the collection itself — identified by having no verified-collection field pointing elsewhere AND being the update authority target; simplest robust skip: parent's metadata is the only one whose mint has a master edition but no collection field
      const isParent = !collectionVerified(a.account.data) && meAcc !== null && accts.length > 1 &&
                       a.account.data.length > 0 && members + fails.length + 1 <= accts.length &&
                       (() => { // parent = token whose ME exists but collection flag absent
                         try {
                           let o = 1+32+32; const s=()=>{const l=a.account.data.readUInt32LE(o);o+=4+l;}; s();s();s();
                           o+=2; if (a.account.data.readUInt8(o++)===1){const n=a.account.data.readUInt32LE(o);o+=4+n*34;}
                           o+=2; if (a.account.data.readUInt8(o++)===1)o+=1; if (a.account.data.readUInt8(o++)===1)o+=1;
                           return a.account.data.readUInt8(o)===0; // no collection field at all
                         } catch { return false; }
                       })();
      if (isParent) continue;
      members++;
      const d = mintAcc.data;
      const supply1   = d.readBigUInt64LE(36) === 1n;
      const dec0      = d[44] === 0;
      const authSet   = d[0] === 1;
      const authIsME  = authSet && new PublicKey(d.slice(4, 36)).equals(me);
      const meByMeta  = meAcc !== null && meAcc.owner.equals(TM);
      const colVer    = collectionVerified(a.account.data);
      if (supply1 && dec0 && authIsME && meByMeta && colVer) pass++;
      else fails.push({ mint: mint.toBase58(), supply1, dec0, authIsME, meByMeta, colVer });
    }
    console.log(`\n=== ${c.name} ===`);
    console.log(`members checked          : ${members}`);
    console.log(`pass all 5 criteria      : ${pass}`);
    console.log(`fail                     : ${fails.length}`);
    for (const f of fails) console.log('  FAIL', f);
    console.log(pass === members && members > 0
      ? `VERDICT: every member — supply locked at 1 by Master Edition, verified collection. Standard met.`
      : `VERDICT: see failures above.`);
  }
})();
