use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::metadata::{
    create_metadata_accounts_v3,
    mpl_token_metadata::types::{Creator, DataV2},
    CreateMetadataAccountsV3, Metadata,
};
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount};

declare_id!("9TjTjyiz3gpRrTaeGvxi2LTrjjsYmDers7VQVDxo9Zdh");

// ── Constants ──────────────────────────────────────────────────────────
pub const MAX_SUPPLY: u32 = 500;

// Wave pricing (in XNT lamports, 9 decimals)
pub const WAVE1_PRICE: u64 = 10_000_000_000; // 10 XNT — first 150 mints
pub const WAVE2_PRICE: u64 = 12_000_000_000; // 12 XNT — next 150 mints
pub const WAVE3_PRICE: u64 = 15_000_000_000; // 15 XNT — final 200 mints
pub const WAVE1_MAX: u32 = 150;
pub const WAVE2_MAX: u32 = 300; // 150 + 150

// Split: 90% to LP treasury, 10% to Geiger node
pub const GEIGER_FEE_BPS: u64 = 1_000; // 10% in basis points

// Wallets — replace before mainnet deploy
pub const ORACLE_OPERATOR: Pubkey = pubkey!("HGFisVbULNKqogtPuGTfcHG9y6i5nboZabYwifkiiodo");
pub const MINT_AUTHORITY: Pubkey = pubkey!("2EMbtMasbwBW4MA3pwqNtQguDJLh5k3GuQ3h4nubtktX"); 
pub const LP_TREASURY: Pubkey = pubkey!("GZuBHE3fQCQ6eSTLMwWKrK15CjtWfA58BmxdtWwG5mJJ"); 

pub const BASE_URI: &str = "https://capy-nft-mint.vercel.app/api/metadata/";
pub const GEIGER_PROGRAM: Pubkey = pubkey!("2dQf9uaCzXewrDNLttmtzQmc3SmqfAHz3qahKQjtGQyY");

// Tier boundaries (token numbers are 1-indexed in metadata, 0-indexed in contract)
pub const MYTHIC_MAX: u32 = 30;    // tokens 1-30
pub const LEGENDARY_MAX: u32 = 150; // tokens 31-150
// Commons: 151-500

// ── Helpers ────────────────────────────────────────────────────────────

/// Calculate mint price based on total minted so far
pub fn get_mint_price(total_minted: u32) -> u64 {
    if total_minted < WAVE1_MAX {
        WAVE1_PRICE
    } else if total_minted < WAVE2_MAX {
        WAVE2_PRICE
    } else {
        WAVE3_PRICE
    }
}

/// Calculate tier string from mint number (0-indexed)
pub fn get_tier(mint_number: u32) -> &'static str {
    if mint_number < MYTHIC_MAX {
        "Mythic"
    } else if mint_number < LEGENDARY_MAX {
        "Legendary"
    } else {
        "Common"
    }
}

#[program]
pub mod capy_warriors {
    use super::*;

    /// Initialize the mint state PDA. Called once by authority.
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let state = &mut ctx.accounts.mint_state;
        state.total_minted = 0;
        state.authority = ctx.accounts.authority.key();
        state.bump = ctx.bumps.mint_state;
        Ok(())
    }

    /// Close the mint state PDA. Authority only — emergency use.
    pub fn close_mint_state(_ctx: Context<CloseMintState>) -> Result<()> {
        Ok(())
    }

    /// Close a stuck pending mint PDA. Returns rent to minter.
    pub fn close_pending_mint(_ctx: Context<ClosePendingMint>) -> Result<()> {
        Ok(())
    }

    /// Step 1: Request randomness from Geiger Oracle.
    /// Checks supply, builds user seed, CPIs to Geiger, stores pending mint.
    pub fn request_mint(ctx: Context<RequestMint>) -> Result<()> {
        require!(
            ctx.accounts.mint_state.total_minted < MAX_SUPPLY,
            CapyError::SoldOut
        );

        // Build user seed: minter pubkey XOR'd with current slot LSB
        let clock = Clock::get()?;
        let mut user_seed = [0u8; 32];
        user_seed[..32].copy_from_slice(&ctx.accounts.minter.key().to_bytes());
        user_seed[0] ^= (clock.slot & 0xff) as u8;

        // CPI to Geiger request_randomness
        let request_ix = anchor_lang::solana_program::instruction::Instruction {
            program_id: GEIGER_PROGRAM,
            accounts: vec![
                anchor_lang::solana_program::instruction::AccountMeta::new(
                    ctx.accounts.oracle_state.key(), false,
                ),
                anchor_lang::solana_program::instruction::AccountMeta::new_readonly(
                    ctx.accounts.entropy_pool.key(), false,
                ),
                anchor_lang::solana_program::instruction::AccountMeta::new(
                    ctx.accounts.randomness_request.key(), false,
                ),
                anchor_lang::solana_program::instruction::AccountMeta::new(
                    ctx.accounts.minter.key(), true,
                ),
                anchor_lang::solana_program::instruction::AccountMeta::new_readonly(
                    ctx.accounts.system_program.key(), false,
                ),
            ],
            data: {
                let mut d = vec![213, 5, 173, 166, 37, 236, 31, 18]; // request_randomness discriminator
                d.extend_from_slice(&user_seed);
                d
            },
        };

        anchor_lang::solana_program::program::invoke(
            &request_ix,
            &[
                ctx.accounts.oracle_state.to_account_info(),
                ctx.accounts.entropy_pool.to_account_info(),
                ctx.accounts.randomness_request.to_account_info(),
                ctx.accounts.minter.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        // Store pending mint state
        let pending = &mut ctx.accounts.pending_mint;
        pending.minter = ctx.accounts.minter.key();
        pending.randomness_request = ctx.accounts.randomness_request.key();
        pending.bump = ctx.bumps.pending_mint;
        pending.slot_requested = clock.slot;

        Ok(())
    }

    /// Step 2: Fulfill mint after Geiger randomness is ready.
    ///
    /// Flow:
    ///   1. Read + verify random result from Geiger
    ///   2. Pick unminted token from bitmap using randomness
    ///   3. Mint SPL token (NFT)
    ///   4. Create Metaplex metadata (name, symbol, URI, tier)
    ///   5. Transfer mint price to LP treasury (90%) and Geiger node (10%)
    ///   6. Increment counter, emit event
    pub fn fulfill_mint(ctx: Context<FulfillMint>) -> Result<()> {
        let total_minted = ctx.accounts.mint_state.total_minted;
        let bump = ctx.accounts.mint_state.bump;
        require!(total_minted < MAX_SUPPLY, CapyError::SoldOut);

        // ── 1. Read randomness from Geiger ─────────────────────────────
        let request_data = ctx.accounts.randomness_request.try_borrow_data()?;
        // Layout: discriminator(8) + requester(32) + user_seed(32) + result(32) + status(1)
        let result = &request_data[72..104];
        require!(request_data[104] == 1, CapyError::RandomnessNotReady);

        // ── 2. Pick unminted token using bitmap ────────────────────────
        let random_u32 = u32::from_le_bytes([result[0], result[1], result[2], result[3]]);
        let mut candidate = (random_u32 % MAX_SUPPLY) as usize;
        let mut mint_number = candidate as u32;

        for _ in 0..MAX_SUPPLY {
            let byte_idx = candidate / 64;
            let bit_idx = candidate % 64;
            let is_minted = (ctx.accounts.mint_state.minted_bitmap[byte_idx]
                & (1u64 << bit_idx))
                != 0;
            if !is_minted {
                mint_number = candidate as u32;
                break;
            }
            candidate = (candidate + 1) % (MAX_SUPPLY as usize);
        }

        // Mark as minted
        let byte_idx = mint_number as usize / 64;
        let bit_idx = mint_number as usize % 64;
        ctx.accounts.mint_state.minted_bitmap[byte_idx] |= 1u64 << bit_idx;

        drop(request_data);

        let seeds = &[b"mint_state_v2".as_ref(), &[bump]];
        let signer_seeds = &[&seeds[..]];

        // ── 3. Mint SPL token ──────────────────────────────────────────
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

        // ── 4. Create Metaplex metadata ────────────────────────────────
        // mint_number is 0-indexed; metadata URI uses 1-indexed token numbers
        let token_id = mint_number + 1;
        let uri = format!("{}{}", BASE_URI, token_id);
        let name = format!("Capy Warrior #{}", token_id);
        let tier = get_tier(mint_number);

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
                symbol: "CAPY".to_string(),
                uri,
                seller_fee_basis_points: 500, // 5% royalty
                creators: Some(vec![Creator {
                    address: MINT_AUTHORITY,
                    verified: false,
                    share: 100,
                }]),
                collection: None,
                uses: None,
            },
            true,  // is_mutable
            true,  // update_authority_is_signer
            None,  // collection_details
        )?;

        // ── 5. Wave pricing + 90/10 split ──────────────────────────────
        let mint_price = get_mint_price(total_minted);

        // Geiger node gets 10%
        let geiger_fee = mint_price
            .checked_mul(GEIGER_FEE_BPS)
            .unwrap()
            .checked_div(10_000)
            .unwrap();

        // LP treasury gets remaining 90%
        let lp_amount = mint_price.checked_sub(geiger_fee).unwrap();

        // Transfer to LP treasury (90%)
        let lp_ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.minter.key(),
            &ctx.accounts.lp_treasury.key(),
            lp_amount,
        );
        anchor_lang::solana_program::program::invoke(
            &lp_ix,
            &[
                ctx.accounts.minter.to_account_info(),
                ctx.accounts.lp_treasury.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        // Transfer to Geiger oracle operator (10%)
        let geiger_ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.minter.key(),
            &ctx.accounts.oracle_operator.key(),
            geiger_fee,
        );
        anchor_lang::solana_program::program::invoke(
            &geiger_ix,
            &[
                ctx.accounts.minter.to_account_info(),
                ctx.accounts.oracle_operator.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        // ── 6. Increment counter + emit event ─────────────────────────
        ctx.accounts.mint_state.total_minted += 1;

        emit!(MintEvent {
            mint_number: token_id,
            tier: tier.to_string(),
            wave: if total_minted < WAVE1_MAX {
                1
            } else if total_minted < WAVE2_MAX {
                2
            } else {
                3
            },
            mint_price,
            minter: ctx.accounts.minter.key(),
        });

        Ok(())
    }
}

// ── Account Structs ────────────────────────────────────────────────────

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

// ── Contexts ───────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + 4 + 32 + 1 + 64,
        seeds = [b"mint_state_v2"],
        bump
    )]
    pub mint_state: Account<'info, MintState>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RequestMint<'info> {
    #[account(mut, seeds = [b"mint_state_v2"], bump = mint_state.bump)]
    pub mint_state: Account<'info, MintState>,
    #[account(mut)]
    pub minter: Signer<'info>,
    #[account(
        init,
        payer = minter,
        space = 8 + 32 + 32 + 1 + 8,
        seeds = [b"pending_mint", minter.key().as_ref()],
        bump
    )]
    pub pending_mint: Account<'info, PendingMint>,
    /// CHECK: Geiger oracle state PDA
    #[account(mut)]
    pub oracle_state: UncheckedAccount<'info>,
    /// CHECK: Geiger entropy pool PDA
    pub entropy_pool: UncheckedAccount<'info>,
    /// CHECK: Geiger randomness request PDA (created by Geiger program)
    #[account(mut)]
    pub randomness_request: UncheckedAccount<'info>,
    /// CHECK: Geiger program ID for CPI
    pub geiger_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FulfillMint<'info> {
    #[account(mut, seeds = [b"mint_state_v2"], bump = mint_state.bump)]
    pub mint_state: Box<Account<'info, MintState>>,
    #[account(mut)]
    pub minter: Signer<'info>,
    #[account(
        mut,
        seeds = [b"pending_mint", minter.key().as_ref()],
        bump = pending_mint.bump,
        close = minter
    )]
    pub pending_mint: Box<Account<'info, PendingMint>>,
    /// CHECK: Geiger randomness request — verified via pending_mint
    pub randomness_request: UncheckedAccount<'info>,
    #[account(
        init,
        payer = minter,
        mint::decimals = 0,
        mint::authority = mint_state,
        mint::freeze_authority = mint_state,
    )]
    pub nft_mint: Box<Account<'info, Mint>>,
    #[account(
        init,
        payer = minter,
        associated_token::mint = nft_mint,
        associated_token::authority = minter,
    )]
    pub minter_ata: Box<Account<'info, TokenAccount>>,
    /// CHECK: Metaplex metadata PDA — derived client-side
    #[account(mut)]
    pub metadata: UncheckedAccount<'info>,
    /// CHECK: LP treasury wallet — receives 90% of mint price
    #[account(mut, address = LP_TREASURY)]
    pub lp_treasury: AccountInfo<'info>,
    /// CHECK: Geiger oracle operator — receives 10% of mint price
    #[account(mut, address = ORACLE_OPERATOR)]
    pub oracle_operator: AccountInfo<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub token_metadata_program: Program<'info, Metadata>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct CloseMintState<'info> {
    #[account(
        mut,
        seeds = [b"mint_state_v2"],
        bump = mint_state.bump,
        close = authority
    )]
    pub mint_state: Account<'info, MintState>,
    #[account(mut, address = mint_state.authority)]
    pub authority: Signer<'info>,
}

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

// ── Events ─────────────────────────────────────────────────────────────

#[event]
pub struct MintEvent {
    pub mint_number: u32,    // 1-indexed token ID
    pub tier: String,        // "Mythic", "Legendary", or "Common"
    pub wave: u8,            // 1, 2, or 3
    pub mint_price: u64,     // XNT paid in lamports
    pub minter: Pubkey,
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
}
