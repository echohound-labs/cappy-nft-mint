use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::metadata::{
    create_metadata_accounts_v3,
    mpl_token_metadata::types::{Creator, DataV2},
    CreateMetadataAccountsV3, Metadata,
};
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount};

declare_id!("CAPPYM1NTxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");

// ── Constants ──────────────────────────────────────────────────────────
pub const MAX_SUPPLY: u32 = 1000;
pub const MINT_PRICE: u64 = 10_000_000_000; // 10 XNT (9 decimals)
// Treasury — replace with Cappy treasury wallet before deploy
pub const TREASURY: Pubkey = pubkey!("11111111111111111111111111111111");
// Base URI for metadata JSON files
pub const BASE_URI: &str = "https://cappy-nft-mint.vercel.app/metadata/";

#[program]
pub mod cappy_mint {
    use super::*;

    /// Initialize the mint state PDA. Called once by authority.
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let state = &mut ctx.accounts.mint_state;
        state.total_minted = 0;
        state.authority = ctx.accounts.authority.key();
        state.bump = ctx.bumps.mint_state;
        Ok(())
    }

    /// Mint a Cappy NFT.
    ///
    /// Flow:
    ///   1. Check supply cap
    ///   2. Create NFT mint + ATA (0 decimals, supply 1)
    ///   3. Create Metaplex metadata with name/URI derived from mint_number
    ///   4. Transfer MINT_PRICE XNT from minter to treasury
    ///   5. Increment total_minted
    ///   6. Emit MintEvent with entropy_hash for on-chain provenance
    ///
    /// Tier/trait resolution happens OFF-CHAIN (client-side via Geiger oracle).
    /// The contract only mints — it doesn't assign traits.
    pub fn mint_cappy(ctx: Context<MintCappy>, entropy_hash: [u8; 32]) -> Result<()> {
        let total_minted = ctx.accounts.mint_state.total_minted;
        let bump = ctx.accounts.mint_state.bump;
        require!(total_minted < MAX_SUPPLY, CappyError::SoldOut);

        let mint_number = total_minted;
        let seeds = &[b"mint_state".as_ref(), &[bump]];
        let signer_seeds = &[&seeds[..]];

        // 1. Mint 1 token (0 decimals = NFT) to minter's ATA
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.nft_mint.to_account_info(),
                    to: ctx.accounts.minter_ata.to_account_info(),
                    authority: ctx.accounts.mint_state.to_account_info(),
                },
                signer_seeds,
            ),
            1,
        )?;

        // 2. Create Metaplex metadata
        let uri = format!("{}{}.json", BASE_URI, mint_number);
        let name = format!("Cappy #{}", mint_number + 1);

        create_metadata_accounts_v3(
            CpiContext::new_with_signer(
                ctx.accounts.token_metadata_program.to_account_info(),
                CreateMetadataAccountsV3 {
                    metadata: ctx.accounts.metadata.to_account_info(),
                    mint: ctx.accounts.nft_mint.to_account_info(),
                    mint_authority: ctx.accounts.mint_state.to_account_info(),
                    payer: ctx.accounts.minter.to_account_info(),
                    update_authority: ctx.accounts.mint_state.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                    rent: ctx.accounts.rent.to_account_info(),
                },
                signer_seeds,
            ),
            DataV2 {
                name,
                symbol: "CAPPY".to_string(),
                uri,
                seller_fee_basis_points: 500, // 5%
                creators: Some(vec![Creator {
                    address: ctx.accounts.mint_state.key(),
                    verified: true,
                    share: 100,
                }]),
                collection: None,
                uses: None,
            },
            true,  // is_mutable
            true,  // is_collection
            None,  // collection_details
        )?;

        // 3. Transfer mint price (XNT) from minter to treasury
        let transfer_ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.minter.key(),
            &ctx.accounts.treasury.key(),
            MINT_PRICE,
        );
        anchor_lang::solana_program::program::invoke(
            &transfer_ix,
            &[
                ctx.accounts.minter.to_account_info(),
                ctx.accounts.treasury.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        // 4. Increment supply counter
        ctx.accounts.mint_state.total_minted += 1;

        // 5. Emit event with entropy hash for on-chain provenance
        // Client resolves traits from this hash off-chain
        emit!(MintEvent {
            mint_number,
            entropy_hash,
            minter: ctx.accounts.minter.key(),
        });

        Ok(())
    }

    /// Authority can update the treasury address if needed
    pub fn set_treasury(ctx: Context<SetTreasury>, new_treasury: Pubkey) -> Result<()> {
        require!(
            ctx.accounts.mint_state.authority == ctx.accounts.authority.key(),
            CappyError::Unauthorized
        );
        // Note: TREASURY is a constant. For a mutable treasury,
        // add a treasury field to MintState and use that instead.
        // This instruction is a placeholder for future flexibility.
        Ok(())
    }
}

// ── Accounts ───────────────────────────────────────────────────────────

#[account]
pub struct MintState {
    pub total_minted: u32,   // 4 bytes
    pub authority: Pubkey,    // 32 bytes
    pub bump: u8,            // 1 byte
}
// Total: 8 (discriminator) + 4 + 32 + 1 = 45 bytes

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + 4 + 32 + 1,  // discriminator + MintState fields
        seeds = [b"mint_state"],
        bump
    )]
    pub mint_state: Account<'info, MintState>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MintCappy<'info> {
    /// Mint state PDA — tracks supply and is mint authority
    #[account(
        mut,
        seeds = [b"mint_state"],
        bump = mint_state.bump
    )]
    pub mint_state: Account<'info, MintState>,

    /// The minter — pays for the NFT + gas
    #[account(mut)]
    pub minter: Signer<'info>,

    /// New NFT mint — created per mint, 0 decimals, authority = mint_state PDA
    #[account(
        init,
        payer = minter,
        mint::decimals = 0,
        mint::authority = mint_state,
        mint::freeze_authority = mint_state,
    )]
    pub nft_mint: Account<'info, Mint>,

    /// Minter's associated token account for the new NFT
    #[account(
        init_if_needed,
        payer = minter,
        associated_token::mint = nft_mint,
        associated_token::authority = minter,
    )]
    pub minter_ata: Account<'info, TokenAccount>,

    /// CHECK: Metaplex metadata PDA (derived client-side)
    #[account(mut)]
    pub metadata: UncheckedAccount<'info>,

    /// Treasury wallet — receives XNT mint price
    /// CHECK: Validated by constant TREASURY pubkey
    #[account(mut, address = TREASURY)]
    pub treasury: AccountInfo<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub token_metadata_program: Program<'info, Metadata>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct SetTreasury<'info> {
    #[account(mut)]
    pub mint_state: Account<'info, MintState>,
    pub authority: Signer<'info>,
}

// ── Events ─────────────────────────────────────────────────────────────

#[event]
pub struct MintEvent {
    pub mint_number: u32,
    pub entropy_hash: [u8; 32],
    pub minter: Pubkey,
}

// ── Errors ─────────────────────────────────────────────────────────────

#[error_code]
pub enum CappyError {
    #[msg("All 1,000 Cappys have been minted")]
    SoldOut,
    #[msg("Not authorized")]
    Unauthorized,
}
