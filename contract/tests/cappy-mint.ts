import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { CappyMint } from "../target/types/cappy_mint";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";

const METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt918CN2");

describe("cappy-mint", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.CappyMint as Program<CappyMint>;
  const authority = anchor.getProvider().wallet;

  let mintStatePDA: PublicKey;

  before(() => {
    [mintStatePDA] = PublicKey.findProgramAddressSync(
      Buffer.from("mint_state"),
      program.programId
    );
  });

  it("Initializes mint state", async () => {
    const tx = await program.methods
      .initialize()
      .accounts({
        mintState: mintStatePDA,
        authority: authority.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    console.log("Initialized! Tx:", tx);
  });

  it("Mints a Cappy NFT", async () => {
    const nftMintKeypair = anchor.web3.Keypair.generate();
    const minterAta = getAssociatedTokenAddressSync(
      nftMintKeypair.publicKey,
      authority.publicKey
    );
    const [metadataPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("metadata"), METADATA_PROGRAM_ID.toBuffer(), nftMintKeypair.publicKey.toBuffer()],
      METADATA_PROGRAM_ID
    );

    const entropyHash = Array.from(crypto.getRandomValues(new Uint8Array(32)));

    const tx = await program.methods
      .mintCappy(entropyHash)
      .accounts({
        mintState: mintStatePDA,
        minter: authority.publicKey,
        nftMint: nftMintKeypair.publicKey,
        minterAta,
        metadata: metadataPDA,
        treasury: new PublicKey("11111111111111111111111111111111"), // TODO: update
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenMetadataProgram: METADATA_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([nftMintKeypair])
      .rpc();

    console.log("Minted! Tx:", tx);
  });
});
