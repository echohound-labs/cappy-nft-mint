//! Offline tests for the Capy freeze build: removed instructions, lock_metadata,
//! and what stays possible (close_pending_mint). Port of RISE tests/svm/tests/freeze.rs.
//!
//! setup() builds the member + collection with the LIVE binary (19d455a, byte-identical
//! to mainnet) on X1's own Token Metadata, then upgrades in place to the freeze build,
//! so every assertion here is about the freeze build acting on state the live program
//! created.

mod common;
use common::*;

const ORACLE_OPERATOR: Pubkey = pubkey!("HGFisVbULNKqogtPuGTfcHG9y6i5nboZabYwifkiiodo");
const LP_TREASURY: Pubkey = pubkey!("GZuBHE3fQCQ6eSTLMwWKrK15CjtWfA58BmxdtWwG5mJJ");
const GEIGER: Pubkey = pubkey!("BxUNg2yo5371BQMZPkfcxdCptFRDHkhvEXNM1QNPBRYU");

const REMOVED: [&str; 7] = [
    "initialize",
    "close_mint_state",
    "request_mint",
    "fulfill_mint",
    "create_collection",
    "verify_collection",
    "create_member_master_edition",
];

fn lock(env: &mut Env, signer: &Keypair, mint: &Pubkey) -> Result<u64, TransactionError> {
    let ix = lock_ix(env.mint_state, signer.pubkey(), metadata_pda(mint));
    env.send(&[ix], &[signer])
}
fn lock_member(env: &mut Env, signer: &Keypair) -> Result<u64, TransactionError> {
    let m = env.member_mint;
    lock(env, signer, &m)
}

/// A realistic account list for each removed instruction, as the live program's
/// accounts struct declared it (lib.rs at 19d455a). `who` is the signer/payer.
fn removed_ix(ms: Pubkey, collection_mint: Pubkey, member_mint: Pubkey, name: &str, who: Pubkey) -> Instruction {
    let new_mint = Pubkey::new_unique();
    let pending = Pubkey::find_program_address(&[b"pending_mint", who.as_ref()], &PROGRAM_ID).0;
    let accounts = match name {
        "initialize" => vec![
            AccountMeta::new(ms, false),
            AccountMeta::new(who, true),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        "close_mint_state" => vec![AccountMeta::new(ms, false), AccountMeta::new(who, true)],
        "request_mint" => vec![
            AccountMeta::new(ms, false),
            AccountMeta::new(who, true),
            AccountMeta::new(pending, false),
            AccountMeta::new(Pubkey::new_unique(), false),
            AccountMeta::new_readonly(Pubkey::new_unique(), false),
            AccountMeta::new(Pubkey::new_unique(), false),
            AccountMeta::new_readonly(GEIGER, false),
            AccountMeta::new(ORACLE_OPERATOR, false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        "fulfill_mint" => vec![
            AccountMeta::new(ms, false),
            AccountMeta::new(who, true),
            AccountMeta::new(pending, false),
            AccountMeta::new_readonly(Pubkey::new_unique(), false),
            AccountMeta::new(new_mint, true),
            AccountMeta::new(ata(&who, &new_mint), false),
            AccountMeta::new(metadata_pda(&new_mint), false),
            AccountMeta::new(LP_TREASURY, false),
            AccountMeta::new(ORACLE_OPERATOR, false),
            AccountMeta::new_readonly(TOKEN, false),
            AccountMeta::new_readonly(ATA, false),
            AccountMeta::new_readonly(system_program::id(), false),
            AccountMeta::new_readonly(MPL, false),
            AccountMeta::new_readonly(sysvar::rent::id(), false),
            AccountMeta::new_readonly(collection_mint, false),
            AccountMeta::new(metadata_pda(&collection_mint), false),
            AccountMeta::new_readonly(edition_pda(&collection_mint), false),
            AccountMeta::new(edition_pda(&new_mint), false),
        ],
        "create_collection" => vec![
            AccountMeta::new_readonly(ms, false),
            AccountMeta::new(who, true),
            AccountMeta::new(new_mint, true),
            AccountMeta::new(ata(&who, &new_mint), false),
            AccountMeta::new(metadata_pda(&new_mint), false),
            AccountMeta::new(edition_pda(&new_mint), false),
            AccountMeta::new_readonly(TOKEN, false),
            AccountMeta::new_readonly(ATA, false),
            AccountMeta::new_readonly(MPL, false),
            AccountMeta::new_readonly(system_program::id(), false),
            AccountMeta::new_readonly(sysvar::rent::id(), false),
        ],
        "verify_collection" => vec![
            AccountMeta::new_readonly(ms, false),
            AccountMeta::new(who, true),
            AccountMeta::new(metadata_pda(&member_mint), false),
            AccountMeta::new_readonly(collection_mint, false),
            AccountMeta::new(metadata_pda(&collection_mint), false),
            AccountMeta::new_readonly(edition_pda(&collection_mint), false),
            AccountMeta::new_readonly(MPL, false),
        ],
        "create_member_master_edition" => vec![
            AccountMeta::new_readonly(ms, false),
            AccountMeta::new(who, true),
            AccountMeta::new(metadata_pda(&member_mint), false),
            AccountMeta::new(member_mint, false),
            AccountMeta::new(edition_pda(&member_mint), false),
            AccountMeta::new_readonly(MPL, false),
            AccountMeta::new_readonly(TOKEN, false),
            AccountMeta::new_readonly(system_program::id(), false),
            AccountMeta::new_readonly(sysvar::rent::id(), false),
        ],
        _ => unreachable!(),
    };
    let mut data = disc("global", name).to_vec();
    if name == "create_collection" {
        borsh_str(&mut data, "https://evil.example/collection.json");
    }
    Instruction { program_id: PROGRAM_ID, accounts, data }
}

/// A bare SVM (X1 programs) holding mainnet's mint_state exactly, sigverify off.
fn mainnet_mint_state_svm(so: &str) -> (LiteSVM, Pubkey) {
    let mut svm = x1_svm().with_sigverify(false);
    svm.add_program_from_file(PROGRAM_ID, so).unwrap();
    svm.airdrop(&MINT_AUTHORITY, 10_000_000_000).unwrap();
    let (ms, _) = mint_state_pda();
    assert_eq!(ms, MAINNET_MINT_STATE);
    let d = mint_state_data(&MINT_AUTHORITY);
    let lamports = svm.minimum_balance_for_rent_exemption(d.len());
    assert_eq!(lamports, 1_649_520, "same rent as the mainnet account");
    svm.set_account(ms, Account { lamports, data: d, owner: PROGRAM_ID, executable: false, rent_epoch: 0 }).unwrap();
    (svm, ms)
}

fn total_minted(svm: &LiteSVM, ms: &Pubkey) -> Option<u32> {
    svm.get_account(ms)
        .filter(|a| a.data.len() >= 12)
        .map(|a| u32::from_le_bytes(a.data[8..12].try_into().unwrap()))
}
fn ms_authority(svm: &LiteSVM, ms: &Pubkey) -> Option<Pubkey> {
    svm.get_account(ms).filter(|a| a.data.len() >= 44).map(|a| Pubkey::try_from(&a.data[12..44]).unwrap())
}

// ── Binaries ───────────────────────────────────────────────────────────────

#[test]
fn binaries_are_the_expected_ones() {
    let live = std::fs::read(live_so()).unwrap();
    let hex = |b: &[u8]| Sha256::digest(b).iter().map(|x| format!("{x:02x}")).collect::<String>();
    assert_eq!(hex(&live), LIVE_SHA256, "live fixture = 19d455a build = mainnet dump (trimmed)");
    assert_eq!(live.len(), 425_904);
    let freeze = std::fs::read(freeze_so()).unwrap();
    assert!(freeze.len() <= 429_528, "fits the existing 429,528-byte program data: no extend needed");
    assert_eq!(hex(&std::fs::read(fixture("mpl_token_metadata_x1_mainnet.so")).unwrap()),
        "bb0842f6d5740eabe8f9fb3b723b9ecd89cadf9f48ef9ad6a9dc6cfa8a9658e4");
    assert_eq!(hex(&std::fs::read(fixture("spl_token_x1_mainnet.so")).unwrap()),
        "8190d3f7ceb6cb7a7a8d8924bff89f9f611e15ce1f806f2b6237f3311a98f697");
    println!("freeze build {} bytes, sha256 {}", freeze.len(), hex(&freeze));
}

// ── Removed instructions ───────────────────────────────────────────────────

#[test]
fn removed_instructions_fail_fallback_not_found() {
    // Contrast: on the LIVE binary the authority can still close mint_state.
    let mut live = setup_with(false);
    let a = live.authority.insecure_clone();
    let ix = removed_ix(live.mint_state, live.collection_mint, live.member_mint, "close_mint_state", a.pubkey());
    live.send(&[ix], &[&a]).expect("live binary: close_mint_state works");
    assert!(live.svm.get_account(&live.mint_state).map_or(true, |x| x.lamports == 0));

    // Freeze build: every removed instruction is gone.
    let mut env = setup();
    let auth = env.authority.insecure_clone();
    let ms_before = env.svm.get_account(&env.mint_state).unwrap();
    let member_before = env.raw_md(&env.member_mint);
    let coll_before = env.raw_md(&env.collection_mint);
    for name in REMOVED {
        let mut ix = removed_ix(env.mint_state, env.collection_mint, env.member_mint, name, auth.pubkey());
        let extra = Keypair::new();
        let mut signers = vec![&auth];
        // create_collection / fulfill_mint list a fresh mint as a second signer
        if ix.accounts.iter().filter(|m| m.is_signer).count() == 2 {
            for m in ix.accounts.iter_mut() {
                if m.is_signer && m.pubkey != auth.pubkey() {
                    m.pubkey = extra.pubkey();
                }
            }
            signers.push(&extra);
        }
        let err = env.send(&[ix], &signers).unwrap_err();
        assert_eq!(custom(&err), Some(INSTRUCTION_FALLBACK_NOT_FOUND), "{name}: {err:?}");
        println!("{name}: InstructionFallbackNotFound (101)");
    }
    assert_eq!(env.svm.get_account(&env.mint_state).unwrap(), ms_before, "mint_state untouched");
    assert_eq!(env.raw_md(&env.member_mint), member_before);
    assert_eq!(env.raw_md(&env.collection_mint), coll_before);
}

#[test]
fn sold_out_mint_state_cannot_be_reset_or_reopened() {
    let close = |ms, who| Instruction {
        program_id: PROGRAM_ID,
        accounts: vec![AccountMeta::new(ms, false), AccountMeta::new(who, true)],
        data: disc("global", "close_mint_state").to_vec(),
    };
    let init = |ms, who| Instruction {
        program_id: PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(ms, false),
            AccountMeta::new(who, true),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data: disc("global", "initialize").to_vec(),
    };

    // LIVE binary, real MINT_AUTHORITY (sigverify off): close + initialize resets
    // total_minted to 0 (RISE audit P1, same code here).
    let (mut svm, ms) = mainnet_mint_state_svm(&live_so());
    send_as(&mut svm, &[close(ms, MINT_AUTHORITY)], &MINT_AUTHORITY).expect("live: close_mint_state");
    send_as(&mut svm, &[init(ms, MINT_AUTHORITY)], &MINT_AUTHORITY).expect("live: initialize");
    assert_eq!(total_minted(&svm, &ms), Some(0), "live binary reopens minting");
    println!("live 19d455a: close_mint_state + initialize -> total_minted = 0");

    // CAPY-ONLY: the live `initialize` is not authority-gated (RISE fixed this in e4b9fac,
    // Capy never got that commit). Once the authority closes mint_state, ANY wallet can
    // re-create it and become its authority, i.e. the update authority of all 501 NFTs.
    let (mut svm, ms) = mainnet_mint_state_svm(&live_so());
    let stranger = Pubkey::new_unique();
    svm.airdrop(&stranger, 10_000_000_000).unwrap();
    send_as(&mut svm, &[close(ms, MINT_AUTHORITY)], &MINT_AUTHORITY).expect("live: close");
    send_as(&mut svm, &[init(ms, stranger)], &stranger).expect("live: a stranger initializes");
    assert_eq!(ms_authority(&svm, &ms), Some(stranger), "live: stranger now controls mint_state");
    println!("live 19d455a: after close, a stranger's initialize makes it mint_state.authority");

    // FREEZE build, same keys, same state: nothing resets or mints.
    let (mut svm, ms) = mainnet_mint_state_svm(&freeze_so());
    let before = svm.get_account(&ms).unwrap();
    svm.airdrop(&stranger, 10_000_000_000).unwrap();
    for (label, ixs, payer) in [
        ("close_mint_state", vec![close(ms, MINT_AUTHORITY)], MINT_AUTHORITY),
        ("initialize (authority)", vec![init(ms, MINT_AUTHORITY)], MINT_AUTHORITY),
        ("initialize (stranger)", vec![init(ms, stranger)], stranger),
        ("close_mint_state + initialize in one tx", vec![close(ms, MINT_AUTHORITY), init(ms, MINT_AUTHORITY)], MINT_AUTHORITY),
    ] {
        let err = send_as(&mut svm, &ixs, &payer).unwrap_err();
        assert_eq!(custom(&err), Some(INSTRUCTION_FALLBACK_NOT_FOUND), "{label}: {err:?}");
        println!("freeze: {label} -> 101");
    }
    for who in [stranger, MINT_AUTHORITY] {
        for name in ["request_mint", "fulfill_mint", "create_collection", "verify_collection", "create_member_master_edition"] {
            let ix = removed_ix(ms, Pubkey::new_unique(), Pubkey::new_unique(), name, who);
            let err = send_as(&mut svm, &[ix], &who).unwrap_err();
            assert_eq!(custom(&err), Some(INSTRUCTION_FALLBACK_NOT_FOUND), "{name}: {err:?}");
        }
    }
    println!("freeze: request_mint / fulfill_mint / create_collection / verify_collection / create_member_master_edition -> 101 (stranger and authority)");
    let after = svm.get_account(&ms).unwrap();
    assert_eq!(after, before, "mint_state byte-identical");
    assert_eq!(total_minted(&svm, &ms), Some(500));
    let bits: u32 = after.data[45..109].iter().map(|b| b.count_ones()).sum();
    assert_eq!(bits, 500);
}

#[test]
fn member_supply_is_locked_by_master_edition() {
    let mut env = setup();
    let auth = env.authority.insecure_clone();
    let mint = env.svm.get_account(&env.member_mint).unwrap();
    assert_eq!(&mint.data[0..4], &1u32.to_le_bytes(), "mint authority present");
    assert_eq!(Pubkey::try_from(&mint.data[4..36]).unwrap(), edition_pda(&env.member_mint));
    let mut mint_to = vec![7u8];
    mint_to.extend_from_slice(&1u64.to_le_bytes());
    let ix = Instruction {
        program_id: TOKEN,
        accounts: vec![
            AccountMeta::new(env.member_mint, false),
            AccountMeta::new(ata(&auth.pubkey(), &env.member_mint), false),
            AccountMeta::new_readonly(auth.pubkey(), true),
        ],
        data: mint_to,
    };
    assert!(env.send(&[ix], &[&auth]).is_err());
    assert_eq!(env.svm.get_account(&env.member_mint).unwrap().data[36..44], 1u64.to_le_bytes());
}

// ── lock_metadata ──────────────────────────────────────────────────────────

#[test]
fn lock_metadata_sets_only_is_mutable() {
    let mut env = setup();
    let auth = env.authority.insecure_clone();
    let before = env.raw_md(&env.member_mint);
    let coll_before = env.raw_md(&env.collection_mint);
    let cu = lock_member(&mut env, &auth).expect("lock_metadata");
    println!("lock_metadata compute units (incl. compute-budget ix): {cu}");
    let after = env.raw_md(&env.member_mint);
    assert_only_is_mutable_cleared(&before, &after);
    let md = parse(&after.data);
    assert_eq!(md.collection, Some((true, env.collection_mint)), "collection stays verified");
    assert!(md.creators.as_ref().unwrap()[0].verified, "creator stays verified");
    assert_eq!(env.raw_md(&env.collection_mint), coll_before, "collection NFT untouched");

    // Idempotent: locking again succeeds and changes nothing.
    lock_member(&mut env, &auth).expect("second lock is a no-op");
    assert_eq!(env.raw_md(&env.member_mint), after);

    dump("lock_before.bin", &before.data);
    dump("lock_after.bin", &after.data);
}

#[test]
fn lock_after_uri_change_with_primary_sale_true_keeps_everything() {
    let mut env = setup();
    let auth = env.authority.insecure_clone();
    let mut acc = env.raw_md(&env.member_mint);
    let off = parse(&acc.data).psh_offset;
    acc.data[off] = 1;
    env.svm.set_account(metadata_pda(&env.member_mint), acc).unwrap();
    call(&mut env, &auth, NEW_URI).expect("uri moved first, as in the real sequence");
    let ix = update_royalty_ix(env.mint_state, auth.pubkey(), metadata_pda(&env.member_mint), 300, &[(env.creator.pubkey(), 100)]);
    env.send(&[ix], &[&auth]).expect("royalty set first");
    let before = env.raw_md(&env.member_mint);
    let b = parse(&before.data);
    assert!(b.primary_sale_happened);
    assert_eq!(b.creators, Some(vec![Creator { address: env.creator.pubkey(), verified: true, share: 100 }]), "creator kept its flag");
    lock_member(&mut env, &auth).expect("lock");
    let after = env.raw_md(&env.member_mint);
    assert_only_is_mutable_cleared(&before, &after);
    let md = parse(&after.data);
    assert_eq!(md.uri, NEW_URI);
    assert_eq!(md.seller_fee_basis_points, 300);
    assert!(md.primary_sale_happened);
}

#[test]
fn after_lock_uri_and_royalty_updates_are_refused() {
    let mut env = setup();
    let auth = env.authority.insecure_clone();
    lock_member(&mut env, &auth).expect("lock");
    let locked = env.raw_md(&env.member_mint);

    let err = call(&mut env, &auth, NEW_URI).unwrap_err();
    assert_eq!(custom(&err), Some(MPL_DATA_IS_IMMUTABLE), "update_token_uri: {err:?}");
    let err = call(&mut env, &auth, OLD_URI).unwrap_err();
    assert_eq!(custom(&err), Some(MPL_DATA_IS_IMMUTABLE), "revert to Vercel: {err:?}");
    let ix = update_royalty_ix(env.mint_state, auth.pubkey(), metadata_pda(&env.member_mint), 0, &[(auth.pubkey(), 100)]);
    let err = env.send(&[ix], &[&auth]).unwrap_err();
    assert_eq!(custom(&err), Some(MPL_DATA_IS_IMMUTABLE), "update_royalty: {err:?}");
    assert_eq!(env.raw_md(&env.member_mint), locked, "locked account byte-identical");
    println!("after lock: update_token_uri, revert and update_royalty -> Metaplex DataIsImmutable (59)");
}

#[test]
fn lock_rejects_wrong_or_unsigned_authority() {
    let mut env = setup();
    let before = env.raw_md(&env.member_mint);
    let impostor = Keypair::new();
    env.svm.airdrop(&impostor.pubkey(), 1_000_000_000).unwrap();
    let err = lock_member(&mut env, &impostor).unwrap_err();
    assert_eq!(custom(&err), Some(CONSTRAINT_HAS_ONE), "{err:?}");
    assert_eq!(env.raw_md(&env.member_mint), before);

    let mut ix = lock_ix(env.mint_state, env.authority.pubkey(), metadata_pda(&env.member_mint));
    ix.accounts[1].is_signer = false;
    let err = env.send(&[ix], &[&impostor]).unwrap_err();
    assert_eq!(custom(&err), Some(ACCOUNT_NOT_SIGNER), "{err:?}");
    assert_eq!(env.raw_md(&env.member_mint), before);

    // Still mutable: the real authority can still change the uri.
    let auth = env.authority.insecure_clone();
    call(&mut env, &auth, NEW_URI).expect("still mutable after the rejected locks");
}

#[test]
fn lock_rejects_non_metadata_account() {
    let mut env = setup();
    let auth = env.authority.insecure_clone();
    let mut fake = env.raw_md(&env.member_mint);
    fake.owner = PROGRAM_ID;
    let fake_key = Pubkey::new_unique();
    env.svm.set_account(fake_key, fake.clone()).unwrap();
    let ix = lock_ix(env.mint_state, auth.pubkey(), fake_key);
    assert!(env.send(&[ix], &[&auth]).is_err());
    assert_eq!(env.svm.get_account(&fake_key).unwrap(), fake);
}

#[test]
fn lock_rejects_metadata_of_another_update_authority() {
    // A real Metaplex metadata whose update authority is NOT mint_state (a stranger's NFT):
    // Metaplex refuses the CPI (mint_state is not its update authority) and nothing changes.
    let mut env = setup();
    let auth = env.authority.insecure_clone();
    let m = env.member_mint;
    let mut acc = env.raw_md(&m);
    let other = Pubkey::new_unique();
    acc.data[1..33].copy_from_slice(other.as_ref());
    env.svm.set_account(metadata_pda(&m), acc.clone()).unwrap();
    assert!(lock(&mut env, &auth, &m).is_err());
    assert_eq!(env.raw_md(&m), acc);
}

#[test]
fn lock_collection_nft() {
    let mut env = setup();
    let auth = env.authority.insecure_clone();
    let coll = env.collection_mint;
    // repoint first, as the owner will (collection currently on the Vercel /api/metadata/collection)
    let ix = update_token_uri_ix(env.mint_state, auth.pubkey(), metadata_pda(&coll), NEW_URI);
    env.send(&[ix], &[&auth]).expect("collection uri update");
    let before = env.raw_md(&coll);
    let member_before = env.raw_md(&env.member_mint);
    let b = parse(&before.data);
    assert!(b.collection_details.is_some(), "sized collection");
    assert_eq!(b.collection_details.as_ref().unwrap()[1..9], 1u64.to_le_bytes(), "size 1 (one member verified)");
    lock(&mut env, &auth, &coll).expect("lock collection NFT");
    let after = env.raw_md(&coll);
    assert_only_is_mutable_cleared(&before, &after);
    assert_eq!(parse(&after.data).collection_details, b.collection_details, "size kept");
    assert_eq!(env.raw_md(&env.member_mint), member_before, "member untouched");

    let ix = update_token_uri_ix(env.mint_state, auth.pubkey(), metadata_pda(&coll), COLLECTION_URI);
    let err = env.send(&[ix], &[&auth]).unwrap_err();
    assert_eq!(custom(&err), Some(MPL_DATA_IS_IMMUTABLE), "{err:?}");

    // The member can still be locked afterwards, and stays verified.
    let mb = env.raw_md(&env.member_mint);
    lock_member(&mut env, &auth).expect("lock member after collection");
    assert_only_is_mutable_cleared(&mb, &env.raw_md(&env.member_mint));
    assert_eq!(env.md(&env.member_mint).collection, Some((true, coll)));
}

// ── close_pending_mint (kept: 5 open pending_mint accounts on mainnet) ──────

#[test]
fn close_pending_mint_still_refunds_its_owner_only() {
    let mut env = setup();
    let minter = Keypair::new();
    let stranger = Keypair::new();
    env.svm.airdrop(&minter.pubkey(), 1_000_000_000).unwrap();
    env.svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();
    let (pda, bump) = Pubkey::find_program_address(&[b"pending_mint", minter.pubkey().as_ref()], &PROGRAM_ID);
    let mut d = disc("account", "PendingMint").to_vec();
    d.extend_from_slice(minter.pubkey().as_ref());
    d.extend_from_slice(Pubkey::new_unique().as_ref());
    d.push(bump);
    d.extend_from_slice(&74_706_159u64.to_le_bytes());
    assert_eq!(d.len(), 81);
    let rent = env.svm.minimum_balance_for_rent_exemption(81);
    assert_eq!(rent, 1_454_640, "same rent as the 5 mainnet pending_mint accounts");
    env.svm.set_account(pda, Account { lamports: rent, data: d, owner: PROGRAM_ID, executable: false, rent_epoch: 0 })
        .unwrap();
    let ix = |m: Pubkey| Instruction {
        program_id: PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(Pubkey::find_program_address(&[b"pending_mint", m.as_ref()], &PROGRAM_ID).0, false),
            AccountMeta::new(m, true),
        ],
        data: disc("global", "close_pending_mint").to_vec(),
    };
    // A stranger can only address their own (non-existent) PDA.
    let err = env.send(&[ix(stranger.pubkey())], &[&stranger]).unwrap_err();
    assert_eq!(custom(&err), Some(ACCOUNT_NOT_INITIALIZED), "{err:?}");
    // Passing the minter's PDA with the stranger signing fails the seeds check.
    let mut bad = ix(minter.pubkey());
    bad.accounts[1] = AccountMeta::new(stranger.pubkey(), true);
    assert!(env.send(&[bad], &[&stranger]).is_err());
    // The authority cannot close (or drain) it either.
    let auth = env.authority.insecure_clone();
    let mut bad = ix(minter.pubkey());
    bad.accounts[1] = AccountMeta::new(auth.pubkey(), true);
    assert!(env.send(&[bad], &[&auth]).is_err());
    assert!(env.svm.get_account(&pda).is_some_and(|a| a.lamports == rent));

    let bal = env.svm.get_balance(&minter.pubkey()).unwrap();
    env.send(&[ix(minter.pubkey())], &[&minter]).expect("minter reclaims rent");
    assert!(env.svm.get_account(&pda).map_or(true, |a| a.lamports == 0));
    let fee = 5_000;
    assert_eq!(env.svm.get_balance(&minter.pubkey()).unwrap(), bal + rent - fee);
}

#[test]
fn close_pending_mint_on_the_real_mainnet_accounts() {
    // The 5 pending_mint accounts read from mainnet 2026-11-24 (minter, request, bump, slot).
    // Each minter (sigverify off) can close its own; nobody else can.
    const P: [(&str, &str, u8, u64); 5] = [
        ("PEk9CSUuyU6sMsS839HSxRmXmxKssC62Q1NjBzu21Zp", "FsNbJVfLp4PYWkWBdrii1ECsLzxDSrDF1jwDt5ZCwvRd", 254, 54_535_110),
        ("CoCt4P59qbwqfiJVmgtAZrSQssbCg8VeWS7A6hNmwgz2", "bZm8iYq4FUFNoHbA2ey2ZysVZ1q4vYJUADKPjYjeY36", 255, 55_356_899),
        ("DS4keEcVVdCCUs5mBLUYn7CjEuhuLzNxX798UxuHBkGx", "GehU32nzELvz2KKi2wEnGjR536aq69QDnEteNmtctXEB", 254, 55_413_135),
        ("EeRzaTbMyqVN51kxx9JAQPEoUC2FuEh9C484AXuYwVTc", "6tARigKGm1uyJpX2Qr9FHz1zQfUVM7bSeRYG4eNhL5D8", 255, 73_646_973),
        ("FNhgW5Eq7zJrQ6kJqhroqF1PWPgXtC1zuZUUfYGixPtF", "ECbMyPc464AaMYnu2ZAkBB4bknQpFtN923q1dsEsNTGR", 255, 74_706_159),
    ];
    let (mut svm, _ms) = mainnet_mint_state_svm(&freeze_so());
    for (minter, req, bump, slot) in P {
        let minter: Pubkey = minter.parse().unwrap();
        let (pda, b) = Pubkey::find_program_address(&[b"pending_mint", minter.as_ref()], &PROGRAM_ID);
        assert_eq!(b, bump, "stored bump is canonical");
        let mut d = disc("account", "PendingMint").to_vec();
        d.extend_from_slice(minter.as_ref());
        d.extend_from_slice(req.parse::<Pubkey>().unwrap().as_ref());
        d.push(bump);
        d.extend_from_slice(&slot.to_le_bytes());
        svm.set_account(pda, Account { lamports: 1_454_640, data: d, owner: PROGRAM_ID, executable: false, rent_epoch: 0 }).unwrap();
        svm.airdrop(&minter, 10_000_000).unwrap();
        let ix = |signer: Pubkey| Instruction {
            program_id: PROGRAM_ID,
            accounts: vec![AccountMeta::new(pda, false), AccountMeta::new(signer, true)],
            data: disc("global", "close_pending_mint").to_vec(),
        };
        assert!(send_as(&mut svm, &[ix(MINT_AUTHORITY)], &MINT_AUTHORITY).is_err(), "authority cannot close it");
        let before = svm.get_balance(&minter).unwrap();
        send_as(&mut svm, &[ix(minter)], &minter).expect("the minter closes its own");
        assert_eq!(svm.get_balance(&minter).unwrap(), before + 1_454_640 - 5_000);
    }
}
