import * as anchor from "@coral-xyz/anchor";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // TODO: Update program ID after building
  const programId = new anchor.web3.PublicKey("CAPPYM1NTxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
  console.log("Deploying Cappy Mint to:", programId.toBase58());
}

main().catch(console.error);
