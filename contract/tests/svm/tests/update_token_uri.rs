//! Offline tests for `update_token_uri` (kept byte-identical from the live program)
//! and a regression check of `update_royalty`. Port of RISE tests/svm/tests/update_token_uri.rs.
//!
//! Difference from RISE: Capy's update_token_uri has NO EmptyUri / UriTooLong checks
//! (RISE added them before its freeze; the Capy instruction is kept exactly as deployed).
//! What stops a bad uri is X1's Metaplex and the scripts' map checks; recorded below.

mod common;
use common::*;

#[test]
fn happy_path_changes_only_uri() {
    let mut env = setup();
    let before = env.md(&env.member_mint);
    let coll_before = env.raw_md(&env.collection_mint);
    let auth = env.authority.insecure_clone();
    dump("before.bin", &env.raw_md(&env.member_mint).data);
    dump("collection_mint.txt", env.collection_mint.to_string().as_bytes());

    let cu = call(&mut env, &auth, NEW_URI).expect("update_token_uri");
    println!("update_token_uri compute units (incl. compute-budget ix): {cu}");

    let after = env.md(&env.member_mint);
    assert_only_uri_changed(&before, &after, NEW_URI);
    dump("after.bin", &env.raw_md(&env.member_mint).data);
    dump("collection.bin", &coll_before.data);
    assert_eq!(after.collection, Some((true, env.collection_mint)), "collection must stay verified");
    assert!(after.creators.as_ref().unwrap()[0].verified, "creator must stay verified");
    assert!(!after.primary_sale_happened);
    assert!(after.is_mutable);
    assert_eq!(env.raw_md(&env.collection_mint), coll_before, "collection NFT untouched");
}

#[test]
fn primary_sale_happened_true_is_preserved() {
    let mut env = setup();
    let mut acc = env.raw_md(&env.member_mint);
    let off = parse(&acc.data).psh_offset;
    acc.data[off] = 1;
    env.svm.set_account(metadata_pda(&env.member_mint), acc).unwrap();
    let before = env.md(&env.member_mint);
    assert!(before.primary_sale_happened);
    let auth = env.authority.insecure_clone();
    call(&mut env, &auth, NEW_URI).expect("update_token_uri");
    let after = env.md(&env.member_mint);
    assert_only_uri_changed(&before, &after, NEW_URI);
    assert!(after.primary_sale_happened);
}

#[test]
fn rejects_wrong_authority() {
    let mut env = setup();
    let before = env.raw_md(&env.member_mint);
    let impostor = Keypair::new();
    env.svm.airdrop(&impostor.pubkey(), 1_000_000_000).unwrap();
    let err = call(&mut env, &impostor, NEW_URI).unwrap_err();
    assert_eq!(custom(&err), Some(CONSTRAINT_HAS_ONE), "{err:?}");
    assert_eq!(env.raw_md(&env.member_mint), before);
}

#[test]
fn rejects_unsigned_authority() {
    let mut env = setup();
    let before = env.raw_md(&env.member_mint);
    let payer = Keypair::new();
    env.svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();
    let mut ix = update_token_uri_ix(env.mint_state, env.authority.pubkey(), metadata_pda(&env.member_mint), NEW_URI);
    ix.accounts[1].is_signer = false;
    let err = env.send(&[ix], &[&payer]).unwrap_err();
    assert_eq!(custom(&err), Some(ACCOUNT_NOT_SIGNER), "{err:?}");
    assert_eq!(env.raw_md(&env.member_mint), before);
}

#[test]
fn empty_uri_is_not_refused_by_the_program() {
    // RISE refuses "" with EmptyUri (6004). Capy's kept instruction has no such check and
    // X1's Metaplex accepts an empty uri, so the only guard is sweep_uri.cjs's map check
    // (empty / non-https refused before anything is signed).
    let mut env = setup();
    let auth = env.authority.insecure_clone();
    let before = env.md(&env.member_mint);
    let r = call(&mut env, &auth, "");
    println!("update_token_uri(\"\") on X1 Metaplex: {r:?}");
    assert!(r.is_ok(), "{r:?}");
    assert_only_uri_changed(&before, &env.md(&env.member_mint), "");
}

#[test]
fn uri_length_limit_is_200_bytes_enforced_by_metaplex() {
    let mut env = setup();
    let auth = env.authority.insecure_clone();
    let before = env.raw_md(&env.member_mint);

    let too_long = format!("https://x/{}", "a".repeat(201 - 10));
    assert_eq!(too_long.len(), 201);
    let err = call(&mut env, &auth, &too_long).unwrap_err();
    println!("201-byte uri: {err:?}");
    assert!(custom(&err).is_some(), "refused with a Metaplex error: {err:?}");
    assert_eq!(env.raw_md(&env.member_mint), before);

    let multibyte = format!("h{}", "é".repeat(100));
    assert_eq!(multibyte.len(), 201);
    assert!(call(&mut env, &auth, &multibyte).is_err(), "length is counted in bytes");

    let max = format!("https://x/{}", "b".repeat(200 - 10));
    assert_eq!(max.len(), 200);
    let md_before = env.md(&env.member_mint);
    call(&mut env, &auth, &max).expect("200-byte uri accepted");
    assert_only_uri_changed(&md_before, &env.md(&env.member_mint), &max);
}

#[test]
fn rejects_non_metadata_account() {
    let mut env = setup();
    let auth = env.authority.insecure_clone();
    let mut fake = env.raw_md(&env.member_mint);
    fake.owner = PROGRAM_ID;
    let fake_key = Pubkey::new_unique();
    env.svm.set_account(fake_key, fake.clone()).unwrap();
    let ix = update_token_uri_ix(env.mint_state, auth.pubkey(), fake_key, NEW_URI);
    assert!(env.send(&[ix], &[&auth]).is_err());
    assert_eq!(env.svm.get_account(&fake_key).unwrap(), fake);
}

#[test]
fn repeat_and_revert_round_trip() {
    let mut env = setup();
    let auth = env.authority.insecure_clone();
    let original = env.md(&env.member_mint);
    call(&mut env, &auth, NEW_URI).unwrap();
    call(&mut env, &auth, NEW_URI).expect("idempotent re-send");
    call(&mut env, &auth, OLD_URI).expect("revert (the undo for a pilot, before lock)");
    assert_eq!(env.md(&env.member_mint), original, "revert restores the exact original state");
}

#[test]
fn update_royalty_still_works_and_keeps_new_uri() {
    let mut env = setup();
    let auth = env.authority.insecure_clone();
    call(&mut env, &auth, NEW_URI).unwrap();
    let before = env.md(&env.member_mint);
    let ix = update_royalty_ix(env.mint_state, auth.pubkey(), metadata_pda(&env.member_mint), 250, &[(env.creator.pubkey(), 100)]);
    env.send(&[ix], &[&auth]).expect("update_royalty");
    let after = env.md(&env.member_mint);
    assert_eq!(after.uri, NEW_URI);
    assert_eq!(after.seller_fee_basis_points, 250);
    assert_eq!(after.collection, before.collection);
    assert_eq!(after.creators, before.creators);
    // InvalidRoyalty / InvalidCreators unchanged (6003 / 6004).
    for (bps, cr, code) in [(10_001u16, vec![(env.creator.pubkey(), 100u8)], 6003u32), (300, vec![(env.creator.pubkey(), 99)], 6004), (300, vec![], 6004)] {
        let ix = update_royalty_ix(env.mint_state, auth.pubkey(), metadata_pda(&env.member_mint), bps, &cr);
        let err = env.send(&[ix], &[&auth]).unwrap_err();
        assert_eq!(custom(&err), Some(code), "{bps} {cr:?}: {err:?}");
    }
}
