const anchor = require("@coral-xyz/anchor");
const { PublicKey, Connection, Keypair } = require("@solana/web3.js");
const fs = require("fs");
const path = require("path");

async function main() {
  const connection = new Connection("https://rpc.mainnet.x1.xyz", "confirmed");

  const walletKeypair = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(
      path.join(process.env.HOME, ".config/solana/capy-mint-authority.json")
    )))
  );

  const wallet = new anchor.Wallet(walletKeypair);
  const provider = new anchor.AnchorProvider(connection, wallet, {});
  anchor.setProvider(provider);

  const programId = new PublicKey("6r9HZKQRhDfNnZM4m6TgkcK82Bt6EA1q2Ck9VNWoTnGm");
  const idl = JSON.parse(fs.readFileSync(
    path.join(__dirname, "../target/idl/capy_warriors.json")
  ));

  const program = new anchor.Program(idl, provider);

  const [mintStatePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("mint_state_v2")],
    programId
  );

  console.log("Mint State PDA:", mintStatePDA.toBase58());

  const tx = await program.methods
    .initialize()
    .accounts({
      mintState: mintStatePDA,
      authority: wallet.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();

  console.log("✅ Initialized! Tx:", tx);
  console.log("Mint State PDA:", mintStatePDA.toBase58());
  console.log("Save this PDA — you need it in the frontend!");
}

main().catch(console.error);
