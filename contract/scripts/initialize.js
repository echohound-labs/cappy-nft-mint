const anchor = require("@coral-xyz/anchor");
const { PublicKey, Connection, Keypair } = require("@solana/web3.js");
const fs = require("fs");
const path = require("path");

async function main() {
  const connection = new Connection("https://rpc.testnet.x1.xyz", "confirmed");

  // TODO: Create ~/.config/solana/cappy-mint-authority.json before running
  const walletKeypair = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(
      path.join(process.env.HOME, ".config/solana/cappy-mint-authority.json")
    )))
  );

  const wallet = new anchor.Wallet(walletKeypair);
  const provider = new anchor.AnchorProvider(connection, wallet, {});
  anchor.setProvider(provider);

  // TODO: Update program ID after deploy
  const programId = new PublicKey("CAPPYM1NTxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
  const idl = JSON.parse(fs.readFileSync(
    path.join(__dirname, "../target/idl/cappy_mint.json")
  ));
  const program = new anchor.Program(idl, programId, provider);

  const [mintStatePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("mint_state")],
    programId
  );

  console.log("Cappy Mint State PDA:", mintStatePDA.toBase58());

  const tx = await program.methods
    .initialize()
    .accounts({
      mintState: mintStatePDA,
      authority: wallet.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();

  console.log("✅ Cappy mint initialized! Tx:", tx);
  console.log("Mint State PDA:", mintStatePDA.toBase58());
  console.log("Save this PDA — you need it in the frontend!");
}

main().catch(console.error);
