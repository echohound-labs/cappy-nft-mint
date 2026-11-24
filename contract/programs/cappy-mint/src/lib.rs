use anchor_lang::prelude::*;
use anchor_spl::metadata::{
    mpl_token_metadata::accounts::Metadata as MetadataAccount,
    mpl_token_metadata::types::{Creator, DataV2},
    update_metadata_accounts_v2, Metadata, UpdateMetadataAccountsV2,
};

declare_id!("6r9HZKQRhDfNnZM4m6TgkcK82Bt6EA1q2Ck9VNWoTnGm");

// FREEZE BUILD (port of the audited RISE Phoenix freeze, rise-phoenix-contract
// feat/freeze-cleanup 3dbbed3). The collection is sold out (500/500 in
// mint_state; every member and the collection NFT has a max-supply-0 Master
// Edition). This build keeps only what a finished collection needs:
//   * close_pending_mint  - lets the wallets with an abandoned pending_mint
//                           on mainnet reclaim its rent (unchanged)
//   * update_token_uri    - unchanged
//   * update_royalty      - unchanged
//   * lock_metadata       - one-way: sets is_mutable = false on a metadata
//                           account whose update authority is mint_state
// Removed for good (any call now fails with InstructionFallbackNotFound):
// initialize, close_mint_state, request_mint, fulfill_mint, create_collection,
// verify_collection, create_member_master_edition. Nothing in this program can
// create mint_state, reset it, mint a token or create a collection any more.

#[program]
pub mod capy_warriors {
    use super::*;

    /// Close a stuck pending mint PDA. Returns rent to minter.
    pub fn close_pending_mint(_ctx: Context<ClosePendingMint>) -> Result<()> {
        Ok(())
    }

    /// Authority-gated URI repoint. Reads the CURRENT on-chain metadata and
    /// copies every field forward unchanged except `uri`, so post-mint state
    /// (verified collection, creators, master edition) is preserved exactly.
    pub fn update_token_uri(ctx: Context<UpdateTokenUri>, new_uri: String) -> Result<()> {
        let bump = ctx.accounts.mint_state.bump;
        let seeds = &[b"mint_state_v2".as_ref(), &[bump]];
        let signer = &[&seeds[..]];

        let cur = MetadataAccount::try_from(&ctx.accounts.metadata.to_account_info())?;
        let trim = |s: &str| s.trim_end_matches('\0').to_string();

        update_metadata_accounts_v2(
            CpiContext::new_with_signer(
                ctx.accounts.token_metadata_program.to_account_info(),
                UpdateMetadataAccountsV2 {
                    metadata: ctx.accounts.metadata.to_account_info(),
                    update_authority: ctx.accounts.mint_state.to_account_info(),
                },
                signer,
            ),
            None,
            Some(DataV2 {
                name: trim(&cur.name),
                symbol: trim(&cur.symbol),
                uri: new_uri,
                seller_fee_basis_points: cur.seller_fee_basis_points,
                creators: cur.creators.clone(),
                collection: cur.collection.clone(),
                uses: cur.uses.clone(),
            }),
            None,
            None,
        )?;

        Ok(())
    }

    /// Authority-gated royalty/creator update. Copies every other field forward
    /// unchanged, like `update_token_uri`. `verified` is never taken from args:
    /// a creator already on the metadata keeps its current flag (Metaplex rejects
    /// flipping it here), and a new creator starts unverified and must sign
    /// separately via Metaplex SignMetadata.
    pub fn update_royalty(
        ctx: Context<UpdateRoyalty>,
        seller_fee_basis_points: u16,
        creators: Vec<CreatorArg>,
    ) -> Result<()> {
        require!(seller_fee_basis_points <= 10_000, CapyError::InvalidRoyalty);
        require!(!creators.is_empty() && creators.len() <= 5, CapyError::InvalidCreators);
        let total: u32 = creators.iter().map(|c| c.share as u32).sum();
        require!(total == 100, CapyError::InvalidCreators);

        let bump = ctx.accounts.mint_state.bump;
        let seeds = &[b"mint_state_v2".as_ref(), &[bump]];
        let signer = &[&seeds[..]];

        let cur = MetadataAccount::try_from(&ctx.accounts.metadata.to_account_info())?;
        let trim = |s: &str| s.trim_end_matches('\0').to_string();

        let existing = cur.creators.clone().unwrap_or_default();
        let new_creators: Vec<Creator> = creators
            .iter()
            .map(|c| Creator {
                address: c.address,
                verified: existing.iter().any(|e| e.address == c.address && e.verified),
                share: c.share,
            })
            .collect();

        update_metadata_accounts_v2(
            CpiContext::new_with_signer(
                ctx.accounts.token_metadata_program.to_account_info(),
                UpdateMetadataAccountsV2 {
                    metadata: ctx.accounts.metadata.to_account_info(),
                    update_authority: ctx.accounts.mint_state.to_account_info(),
                },
                signer,
            ),
            None,
            Some(DataV2 {
                name: trim(&cur.name),
                symbol: trim(&cur.symbol),
                uri: trim(&cur.uri),
                seller_fee_basis_points,
                creators: Some(new_creators),
                collection: cur.collection.clone(),
                uses: cur.uses.clone(),
            }),
            None,
            None,
        )?;

        Ok(())
    }

    /// ── FREEZE: one-way metadata lock (same as RISE Phoenix) ──
    /// Calls Metaplex UpdateMetadataAccountsV2 with new_update_authority = None,
    /// data = None, primary_sale_happened = None and is_mutable = Some(false).
    /// With data = None every field (name, symbol, uri, royalty, creators and
    /// their verified flags, collection and its verified flag, uses) stays
    /// exactly as it is in the live metadata account; Metaplex then refuses any
    /// later data update (update_token_uri, update_royalty) on this account, from
    /// anyone, forever: is_mutable can only ever go from true to false.
    /// Same gate as update_token_uri; works on members and the collection NFT.
    /// Calling it on an already-locked account succeeds and changes nothing.
    pub fn lock_metadata(ctx: Context<LockMetadata>) -> Result<()> {
        let bump = ctx.accounts.mint_state.bump;
        let seeds = &[b"mint_state_v2".as_ref(), &[bump]];
        let signer = &[&seeds[..]];

        update_metadata_accounts_v2(
            CpiContext::new_with_signer(
                ctx.accounts.token_metadata_program.to_account_info(),
                UpdateMetadataAccountsV2 {
                    metadata: ctx.accounts.metadata.to_account_info(),
                    update_authority: ctx.accounts.mint_state.to_account_info(),
                },
                signer,
            ),
            None,
            None,
            None,
            Some(false),
        )?;

        Ok(())
    }
}

// ── Account Structs ────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct UpdateTokenUri<'info> {
    #[account(seeds = [b"mint_state_v2"], bump = mint_state.bump, has_one = authority)]
    pub mint_state: Account<'info, MintState>,
    pub authority: Signer<'info>,
    /// CHECK: metadata PDA, validated by the Metaplex CPI
    #[account(mut)]
    pub metadata: UncheckedAccount<'info>,
    pub token_metadata_program: Program<'info, Metadata>,
}

#[derive(Accounts)]
pub struct UpdateRoyalty<'info> {
    #[account(seeds = [b"mint_state_v2"], bump = mint_state.bump, has_one = authority)]
    pub mint_state: Account<'info, MintState>,
    pub authority: Signer<'info>,
    /// CHECK: metadata PDA, validated by the Metaplex CPI
    #[account(mut)]
    pub metadata: UncheckedAccount<'info>,
    pub token_metadata_program: Program<'info, Metadata>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreatorArg {
    pub address: Pubkey,
    pub share: u8,
}

#[derive(Accounts)]
pub struct LockMetadata<'info> {
    #[account(seeds = [b"mint_state_v2"], bump = mint_state.bump, has_one = authority)]
    pub mint_state: Account<'info, MintState>,
    pub authority: Signer<'info>,
    /// CHECK: metadata PDA, validated by the Metaplex CPI
    #[account(mut)]
    pub metadata: UncheckedAccount<'info>,
    pub token_metadata_program: Program<'info, Metadata>,
}

#[account]
pub struct MintState {
    pub total_minted: u32,          // 4 bytes
    pub authority: Pubkey,           // 32 bytes
    pub bump: u8,                    // 1 byte
    pub minted_bitmap: [u64; 8],    // 64 bytes — 512 bits, enough for 500 NFTs
}
// Total: 8 (discriminator) + 4 + 32 + 1 + 64 = 109 bytes

#[account]
pub struct PendingMint {
    pub minter: Pubkey,              // 32 bytes
    pub randomness_request: Pubkey, // 32 bytes
    pub bump: u8,                    // 1 byte
    pub slot_requested: u64,        // 8 bytes
}
// Total: 8 (discriminator) + 32 + 32 + 1 + 8 = 81 bytes

#[derive(Accounts)]
pub struct ClosePendingMint<'info> {
    #[account(
        mut,
        seeds = [b"pending_mint", minter.key().as_ref()],
        bump = pending_mint.bump,
        close = minter
    )]
    pub pending_mint: Account<'info, PendingMint>,
    #[account(mut)]
    pub minter: Signer<'info>,
}

// ── Errors ─────────────────────────────────────────────────────────────

#[error_code]
pub enum CapyError {
    #[msg("All 500 Capy Warriors have been minted")]
    SoldOut,
    #[msg("Randomness not yet fulfilled by Geiger Oracle")]
    RandomnessNotReady,
    #[msg("Not authorized")]
    Unauthorized,
    #[msg("Royalty must be <= 10000 bps")]
    InvalidRoyalty,
    #[msg("Creators must be 1-5 entries with shares summing to 100")]
    InvalidCreators,
}
