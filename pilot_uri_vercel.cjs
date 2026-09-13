const { Connection, PublicKey, Keypair, Transaction, TransactionInstruction, ComputeBudgetProgram, sendAndConfirmTransaction } = require("@solana/web3.js");
const crypto = require("crypto"), fs = require("fs");

const RPC = "https://rpc.mainnet.x1.xyz";
const PROGRAM = new PublicKey("6r9HZKQRhDfNnZM4m6TgkcK82Bt6EA1q2Ck9VNWoTnGm");
const MPL = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const MINT_STATE = new PublicKey("5y1GoGNfruDk9QUszD5UdEn9fjAg6xxDBJfywNu4dGmH");
const CID = "bafybeiffef6y4pknukwq7di27yeux7dx3p27q654d35qp7t23u2up3ngnq";

const mint = new PublicKey(process.argv[2]);
const id   = process.argv[3];
const newUri = `https://capy-nft-mint.vercel.app/api/metadata/${id}`;

const disc = crypto.createHash("sha256").update("global:update_token_uri").digest().slice(0,8);
const uriBuf = Buffer.from(newUri, "utf8");
const lenBuf = Buffer.alloc(4); lenBuf.writeUInt32LE(uriBuf.length);
const data = Buffer.concat([disc, lenBuf, uriBuf]);

(async () => {
  const c = new Connection(RPC, "confirmed");
  const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(
    fs.readFileSync(process.env.HOME + "/.config/solana/capy-mint-authority.json"))));
  const [md] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), MPL.toBuffer(), mint.toBuffer()], MPL);

  console.log("mint    :", mint.toBase58());
  console.log("metadata:", md.toBase58());
  console.log("new uri :", newUri);

  const ix = new TransactionInstruction({
    programId: PROGRAM,
    keys: [
      { pubkey: MINT_STATE, isSigner: false, isWritable: false },
      { pubkey: kp.publicKey, isSigner: true,  isWritable: false },
      { pubkey: md,          isSigner: false, isWritable: true  },
      { pubkey: MPL,         isSigner: false, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction()
    .add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000_000 }))
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }))
    .add(ix);

  const sig = await sendAndConfirmTransaction(c, tx, [kp], { commitment: "confirmed" });
  console.log("SIG     :", sig);
})();
