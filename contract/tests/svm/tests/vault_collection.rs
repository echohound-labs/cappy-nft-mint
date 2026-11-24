//! The collection NFT token goes into the "vault", the ATA owned by the mint_state PDA,
//! with the same two instructions vault_collection.cjs sends (ATA CreateIdempotent + SPL
//! TransferChecked of 1). Port of RISE tests/svm/tests/vault_collection.rs; every case
//! runs on X1 mainnet's SPL Token binary (upgrade authority none) and X1's Token Metadata.
//!
//! Control first: while a wallet holds the token it can BurnNft the collection NFT and
//! wipe its metadata. After the move into the vault, the former holder, a stranger and
//! every instruction of the freeze program fail to burn, transfer, delegate or close it.
//! Kept from RISE as the record of why the destination is not the incinerator.

mod common;
use common::*;

const INCINERATOR: Pubkey = pubkey!("1nc1nerator11111111111111111111111111111111");
const COLLECTION_MINT: Pubkey = pubkey!("HC8zqrya22MHNR2JsNkmvr2yqPthDDov1ehDSEUATKbC");

fn create_idempotent_ix(payer: Pubkey, owner: Pubkey, mint: Pubkey) -> Instruction {
    Instruction {
        program_id: ATA,
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new(ata(&owner, &mint), false),
            AccountMeta::new_readonly(owner, false),
            AccountMeta::new_readonly(mint, false),
            AccountMeta::new_readonly(system_program::id(), false),
            AccountMeta::new_readonly(TOKEN, false),
        ],
        data: vec![1],
    }
}
fn transfer_checked_ix(source: Pubkey, mint: Pubkey, dest: Pubkey, owner: Pubkey) -> Instruction {
    let mut data = vec![12u8];
    data.extend_from_slice(&1u64.to_le_bytes());
    data.push(0);
    Instruction {
        program_id: TOKEN,
        accounts: vec![
            AccountMeta::new(source, false),
            AccountMeta::new_readonly(mint, false),
            AccountMeta::new(dest, false),
            AccountMeta::new_readonly(owner, true),
        ],
        data,
    }
}
fn spl_burn_ix(account: Pubkey, mint: Pubkey, owner: Pubkey) -> Instruction {
    let mut data = vec![8u8];
    data.extend_from_slice(&1u64.to_le_bytes());
    Instruction {
        program_id: TOKEN,
        accounts: vec![AccountMeta::new(account, false), AccountMeta::new(mint, false), AccountMeta::new_readonly(owner, true)],
        data,
    }
}
fn spl_approve_ix(account: Pubkey, delegate: Pubkey, owner: Pubkey) -> Instruction {
    let mut data = vec![4u8];
    data.extend_from_slice(&1u64.to_le_bytes());
    Instruction {
        program_id: TOKEN,
        accounts: vec![AccountMeta::new(account, false), AccountMeta::new_readonly(delegate, false), AccountMeta::new_readonly(owner, true)],
        data,
    }
}
fn spl_close_ix(account: Pubkey, dest: Pubkey, owner: Pubkey) -> Instruction {
    Instruction {
        program_id: TOKEN,
        accounts: vec![AccountMeta::new(account, false), AccountMeta::new(dest, false), AccountMeta::new_readonly(owner, true)],
        data: vec![9],
    }
}
fn spl_set_owner_ix(account: Pubkey, new_owner: Pubkey, owner: Pubkey) -> Instruction {
    let mut data = vec![6u8, 2, 1]; // SetAuthority, AccountOwner, Some
    data.extend_from_slice(new_owner.as_ref());
    Instruction {
        program_id: TOKEN,
        accounts: vec![AccountMeta::new(account, false), AccountMeta::new_readonly(owner, true)],
        data,
    }
}
/// Metaplex BurnNft (29) of the collection NFT itself (it belongs to no collection).
fn burn_nft_ix(owner: Pubkey, mint: Pubkey, token_account: Pubkey) -> Instruction {
    Instruction {
        program_id: MPL,
        accounts: vec![
            AccountMeta::new(metadata_pda(&mint), false),
            AccountMeta::new(owner, true),
            AccountMeta::new(mint, false),
            AccountMeta::new(token_account, false),
            AccountMeta::new(edition_pda(&mint), false),
            AccountMeta::new_readonly(TOKEN, false),
        ],
        data: vec![29],
    }
}
fn token_amount(env: &Env, acc: &Pubkey) -> Option<u64> {
    env.svm.get_account(acc).filter(|a| a.data.len() == 165).map(|a| u64::from_le_bytes(a.data[64..72].try_into().unwrap()))
}
fn mint_supply(env: &Env, mint: &Pubkey) -> u64 {
    u64::from_le_bytes(env.svm.get_account(mint).unwrap().data[36..44].try_into().unwrap())
}

#[test]
fn vault_address_is_pinned_and_off_curve() {
    let ms = mint_state_pda().0;
    assert_eq!(ms, MAINNET_MINT_STATE);
    assert!(!ms.is_on_curve(), "a PDA: no secret key exists");
    assert_eq!(mint_state_pda().1, 255, "canonical bump 255 = the stored bump on mainnet");
    assert_eq!(
        ata(&ms, &COLLECTION_MINT),
        pubkey!("HM272gVwG2St7eKfwzxP2fXdn8YUDcWyqRcSmdMcXAZE"),
        "the destination vault_collection.cjs pins"
    );
    assert_eq!(
        ata(&MINT_AUTHORITY, &COLLECTION_MINT),
        pubkey!("6PqM7be444tdwNRhkWtgSakJBms5ZvneeUx55WLKkvve"),
        "the holder token account read from mainnet = ATA(2EMb…, collection mint)"
    );
    assert_eq!(edition_pda(&COLLECTION_MINT), pubkey!("2D6xtMJk65H3uVV6KmWNg488Wk3qCe2deGp8dmPhqkc8"));
}

#[test]
fn control_holder_can_burn_the_collection_nft() {
    // RISE audit M3 / probe D, on X1's binaries: this is the risk the vault removes.
    let mut env = setup();
    let auth = env.authority.insecure_clone();
    let coll = env.collection_mint;
    let held = ata(&auth.pubkey(), &coll);
    assert_eq!(token_amount(&env, &held), Some(1), "setup: the authority's ATA holds the collection token");
    // Even a LOCKED collection NFT can be burned by its holder.
    env.send(&[lock_ix(env.mint_state, auth.pubkey(), metadata_pda(&coll))], &[&auth]).expect("lock");
    env.send(&[burn_nft_ix(auth.pubkey(), coll, held)], &[&auth]).expect("holder burns the (locked) collection NFT");
    assert!(env.svm.get_account(&metadata_pda(&coll)).map_or(true, |a| a.data.iter().all(|b| *b == 0) || a.lamports == 0));
}

/// The script's path: ATA owned by the mint_state PDA.
fn vaulted() -> (Env, Keypair, Pubkey, Pubkey) {
    let mut env = setup();
    let auth = env.authority.insecure_clone();
    let coll = env.collection_mint;
    let ms = env.mint_state;
    let source = ata(&auth.pubkey(), &coll);
    let dest = ata(&ms, &coll);
    let cu = env
        .send(&[create_idempotent_ix(auth.pubkey(), ms, coll), transfer_checked_ix(source, coll, dest, auth.pubkey())], &[&auth])
        .expect("move to ATA(mint_state)");
    println!("vault move: {cu} CU (incl. compute-budget ix)");
    assert_eq!(token_amount(&env, &dest), Some(1));
    assert_eq!(token_amount(&env, &source), Some(0));
    let d = env.svm.get_account(&dest).unwrap();
    assert_eq!(Pubkey::try_from(&d.data[32..64]).unwrap(), ms, "owner");
    assert_eq!(&d.data[72..76], &[0, 0, 0, 0], "no delegate");
    assert_eq!(d.data[108], 1, "initialized, not frozen");
    assert_eq!(&d.data[129..133], &[0, 0, 0, 0], "no close authority");
    // Re-running the script's transaction: create is idempotent, the transfer fails (source empty).
    assert!(env
        .send(&[create_idempotent_ix(auth.pubkey(), ms, coll), transfer_checked_ix(source, coll, dest, auth.pubkey())], &[&auth])
        .is_err());
    (env, auth, coll, dest)
}

#[test]
fn vault_mint_state_owned_ata_resists_burn_transfer_delegate_close() {
    let (mut env, auth, coll, dest) = vaulted();
    let md_before = env.raw_md(&coll);
    let before = env.svm.get_account(&dest).unwrap();
    let stranger = Keypair::new();
    env.svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();
    for who in [&auth, &stranger] {
        let w = who.pubkey();
        let _ = env.send(&[create_idempotent_ix(w, w, coll)], &[who]);
        assert!(env.send(&[spl_burn_ix(dest, coll, w)], &[who]).is_err(), "SPL burn refused (owner is not the incinerator)");
        assert!(env.send(&[transfer_checked_ix(dest, coll, ata(&w, &coll), w)], &[who]).is_err(), "transfer out");
        assert!(env.send(&[burn_nft_ix(w, coll, dest)], &[who]).is_err(), "Metaplex BurnNft");
        assert!(env.send(&[spl_approve_ix(dest, w, w)], &[who]).is_err(), "approve");
        assert!(env.send(&[spl_close_ix(dest, w, w)], &[who]).is_err(), "close");
        assert!(env.send(&[spl_set_owner_ix(dest, w, w)], &[who]).is_err(), "set owner");
    }
    assert_eq!(env.svm.get_account(&dest).unwrap(), before, "vault unchanged");
    assert_eq!(env.raw_md(&coll), md_before, "collection metadata unchanged");
    assert_eq!(mint_supply(&env, &coll), 1);
}

#[test]
fn freeze_program_instructions_cannot_touch_the_vault() {
    let (mut env, auth, _coll, vault) = vaulted();
    let ms = env.mint_state;
    let before = env.svm.get_account(&vault).unwrap();
    let with_vault = |data: Vec<u8>| Instruction {
        program_id: PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(ms, false),
            AccountMeta::new_readonly(auth.pubkey(), true),
            AccountMeta::new(vault, false),
            AccountMeta::new_readonly(MPL, false),
        ],
        data,
    };
    let mut uri = disc("global", "update_token_uri").to_vec();
    borsh_str(&mut uri, NEW_URI);
    let mut roy = disc("global", "update_royalty").to_vec();
    roy.extend_from_slice(&300u16.to_le_bytes());
    roy.extend_from_slice(&1u32.to_le_bytes());
    roy.extend_from_slice(auth.pubkey().as_ref());
    roy.push(100);
    for (what, ix) in [
        ("lock_metadata", with_vault(disc("global", "lock_metadata").to_vec())),
        ("update_token_uri", with_vault(uri)),
        ("update_royalty", with_vault(roy)),
        (
            "close_pending_mint",
            Instruction {
                program_id: PROGRAM_ID,
                accounts: vec![AccountMeta::new(vault, false), AccountMeta::new(auth.pubkey(), true)],
                data: disc("global", "close_pending_mint").to_vec(),
            },
        ),
    ] {
        assert!(env.send(&[ix], &[&auth]).is_err(), "{what} with the vault must fail");
        assert_eq!(env.svm.get_account(&vault).unwrap(), before, "{what}: vault unchanged");
    }
    assert_eq!(token_amount(&env, &vault), Some(1));
}

/// Kept from RISE: why NOT the incinerator. SPL Token lets ANYONE burn a token held by an
/// incinerator-owned account (no owner signature), on X1's Token binary too.
#[test]
fn finding_anyone_can_spl_burn_a_token_held_by_the_incinerator() {
    let mut env = setup();
    let auth = env.authority.insecure_clone();
    let coll = env.collection_mint;
    let source = ata(&auth.pubkey(), &coll);
    let dest = ata(&INCINERATOR, &coll);
    env.send(&[create_idempotent_ix(auth.pubkey(), INCINERATOR, coll), transfer_checked_ix(source, coll, dest, auth.pubkey())], &[&auth])
        .expect("move to the incinerator ATA");
    let stranger = Keypair::new();
    env.svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();
    env.send(&[spl_burn_ix(dest, coll, stranger.pubkey())], &[&stranger]).expect("stranger SPL-burns the incinerator's token");
    assert_eq!(mint_supply(&env, &coll), 0, "collection NFT supply is now 0");
}
