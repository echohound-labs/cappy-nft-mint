const { Connection, PublicKey } = require("@solana/web3.js");
const MPL = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const mint = new PublicKey(process.argv[2]);
(async () => {
  const c = new Connection("https://rpc.mainnet.x1.xyz", "confirmed");
  const [md] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), MPL.toBuffer(), mint.toBuffer()], MPL);
  const ai = await c.getAccountInfo(md);
  const b = ai.data;
  let o = 1 + 32 + 32;
  const rs = () => { const n = b.readUInt32LE(o); o += 4; const s = b.slice(o, o+n).toString().replace(/\0+$/,""); o += n; return s; };
  const name = rs(), symbol = rs(), uri = rs();
  const fee = b.readUInt16LE(o); o += 2;
  const hasCreators = b[o++];
  let creators = [];
  if (hasCreators) { const n = b.readUInt32LE(o); o += 4;
    for (let i=0;i<n;i++){ creators.push({addr:new PublicKey(b.slice(o,o+32)).toBase58(),verified:!!b[o+32],share:b[o+33]}); o+=34; } }
  const primarySale = !!b[o++], isMutable = !!b[o++];
  const hasEditionNonce = b[o++]; if (hasEditionNonce) o++;
  const hasTokenStd = b[o++]; if (hasTokenStd) o++;
  const hasCollection = b[o++];
  let collection = null;
  if (hasCollection) { collection = { verified: !!b[o], key: new PublicKey(b.slice(o+1,o+33)).toBase58() }; }
  console.log("metadata PDA :", md.toBase58());
  console.log("name         :", JSON.stringify(name));
  console.log("symbol       :", JSON.stringify(symbol));
  console.log("uri          :", uri);
  console.log("sellerFeeBps :", fee);
  console.log("creators     :", JSON.stringify(creators));
  console.log("primarySale  :", primarySale, "isMutable:", isMutable);
  console.log("collection   :", JSON.stringify(collection));
})();
