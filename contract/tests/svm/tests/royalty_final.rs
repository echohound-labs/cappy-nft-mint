//! Royalty for the Capy freeze, port of RISE tests/svm/tests/royalty_final.rs.
//!
//! The target royalty is an ARGUMENT of update_royalty.cjs (owner's decision; the
//! value under discussion is 300 bps, single creator GZuB… share 100, VERIFIED).
//! These tests use 300 / GZuB as the example target and also show what happens
//! with a different target.
//!
//! Capy mainnet today (read 2026-11-24, getProgramAccounts on Metaplex):
//!   * all 500 members:   100 bps, [GZuB:100 verified]   -> one instruction:
//!                         update_royalty(bps, [GZuB:100]); GZuB keeps its flag,
//!                         no SignMetadata, no un-verify.
//!   * collection NFT:    500 bps, [mint_state:100 verified] -> update_royalty +
//!                         SignMetadata(GZuB) (mint_state may be dropped: it is the
//!                         update authority signing the CPI), like RISE's 283 group.
//! There is no RISE "217 group" (no third-party verified creator) on Capy.
//!
//! Two kinds of state:
//!   * mainnet: the real metadata bytes of member "Capy Warrior #1" and of the
//!     collection NFT (fixtures/mainnet/), on X1 mainnet's Token Metadata, real keys,
//!     sigverify off;
//!   * fixture: state built by the LIVE program (common::setup()), real signatures.
//! Every path ends with lock_metadata and refused updates (Metaplex 59).

mod common;
use common::*;

const GZUB: Pubkey = pubkey!("GZuBHE3fQCQ6eSTLMwWKrK15CjtWfA58BmxdtWwG5mJJ");
const COLLECTION_MINT: Pubkey = pubkey!("HC8zqrya22MHNR2JsNkmvr2yqPthDDov1ehDSEUATKbC");
const COLLECTION_METADATA: Pubkey = pubkey!("Cx6vNq7cr9cx8jkvTP8FFcYtY8c777WCQtZqgvVBYvfW");
const MEMBER1_METADATA: Pubkey = pubkey!("35RvpUn7rEmsRUpVQazoYVFBR2YVqxhTvSS411wkEZUU");
const MEMBER1_MINT: Pubkey = pubkey!("2pniefwogwKJHFaeTNtr5JQnK7T16qHasqpqU6krqAu8");
const TARGET_BPS: u16 = 300;

const MD_MEMBER: &[u8] = include_bytes!("../fixtures/mainnet/member1_GZuB_100bps.bin");
const MD_COLL: &[u8] = include_bytes!("../fixtures/mainnet/collection_Cx6vNq7.bin");

/// The script's transaction body: update_royalty, then SignMetadata only if the target
/// creator is not already verified on the account.
fn final_royalty_ixs(ms: Pubkey, auth: Pubkey, md: Pubkey, target: Pubkey, sign: bool) -> Vec<Instruction> {
    let mut v = vec![update_royalty_ix(ms, auth, md, TARGET_BPS, &[(target, 100)])];
    if sign {
        v.push(sign_metadata_ix(md, target));
    }
    v
}

/// `after` must equal `before` in every parsed field (tail bytes included)
/// except the royalty and the creator list, which must be exactly [target:100✓].
fn assert_only_royalty_changed(before: &Md, after: &Md, target: Pubkey) {
    let mut want = before.clone();
    want.seller_fee_basis_points = TARGET_BPS;
    want.creators = Some(vec![Creator { address: target, verified: true, share: 100 }]);
    assert_eq!(after, &want, "a field other than royalty/creators changed");
}

// ── mainnet-bytes harness (sigverify off, real keys) ────────────────────────

struct Main {
    svm: LiteSVM,
    ms: Pubkey,
}
impl Main {
    fn new(so: &str) -> Self {
        let mut svm = x1_svm().with_sigverify(false);
        svm.add_program_from_file(PROGRAM_ID, so).unwrap();
        for k in [MINT_AUTHORITY, GZUB] {
            svm.airdrop(&k, 10_000_000_000).unwrap();
        }
        let (ms, _) = mint_state_pda();
        let d = mint_state_data(&MINT_AUTHORITY);
        let lamports = svm.minimum_balance_for_rent_exemption(d.len());
        svm.set_account(ms, Account { lamports, data: d, owner: PROGRAM_ID, executable: false, rent_epoch: 0 }).unwrap();
        for (k, bytes) in [(MEMBER1_METADATA, MD_MEMBER), (COLLECTION_METADATA, MD_COLL)] {
            svm.set_account(k, Account { lamports: 15_115_600, data: bytes.to_vec(), owner: MPL, executable: false, rent_epoch: 0 })
                .unwrap();
        }
        Main { svm, ms }
    }
    fn send(&mut self, ixs: &[Instruction]) -> Result<u64, TransactionError> {
        send_as(&mut self.svm, ixs, &MINT_AUTHORITY)
    }
    fn raw(&self, k: &Pubkey) -> Account {
        self.svm.get_account(k).unwrap()
    }
    fn md(&self, k: &Pubkey) -> Md {
        parse(&self.raw(k).data)
    }
    fn royalty(&mut self, md: Pubkey, sign: bool) -> Result<u64, TransactionError> {
        let ixs = final_royalty_ixs(self.ms, MINT_AUTHORITY, md, GZUB, sign);
        self.send(&ixs)
    }
    fn lock(&mut self, md: Pubkey) -> Result<u64, TransactionError> {
        self.send(&[lock_ix(self.ms, MINT_AUTHORITY, md)])
    }
    /// After a lock: update_royalty and update_token_uri all fail with 59 and change nothing.
    fn assert_updates_refused(&mut self, md: Pubkey) {
        let locked = self.raw(&md);
        let ms = self.ms;
        for (what, ixs) in [
            ("update_royalty back to 500/mint_state", vec![update_royalty_ix(ms, MINT_AUTHORITY, md, 500, &[(ms, 100)])]),
            ("update_royalty same target", vec![update_royalty_ix(ms, MINT_AUTHORITY, md, TARGET_BPS, &[(GZUB, 100)])]),
            ("update_token_uri", vec![update_token_uri_ix(ms, MINT_AUTHORITY, md, NEW_URI)]),
            ("update_token_uri back to Vercel", vec![update_token_uri_ix(ms, MINT_AUTHORITY, md, OLD_URI)]),
        ] {
            let err = self.send(&ixs).unwrap_err();
            assert_eq!(custom(&err), Some(MPL_DATA_IS_IMMUTABLE), "{what} after lock: {err:?}");
            assert_eq!(self.raw(&md), locked, "{what}: locked account changed");
        }
    }
}

#[test]
fn mainnet_start_state_is_what_the_recon_read() {
    let m = parse(MD_MEMBER);
    assert_eq!((m.name.as_str(), m.symbol.as_str(), m.seller_fee_basis_points), ("Capy Warrior #1", "CAPY", 100));
    assert_eq!(m.creators, Some(vec![Creator { address: GZUB, verified: true, share: 100 }]));
    assert_eq!(m.collection, Some((true, COLLECTION_MINT)));
    assert_eq!(m.mint, MEMBER1_MINT);
    assert_eq!(metadata_pda(&MEMBER1_MINT), MEMBER1_METADATA);
    assert!(m.uri.starts_with("https://ipfs.x1forge.xyz/ipfs/Qm"));
    let c = parse(MD_COLL);
    assert_eq!((c.name.as_str(), c.seller_fee_basis_points, c.mint), ("CAPY Warriors", 500, COLLECTION_MINT));
    assert_eq!(c.uri, COLLECTION_URI);
    assert_eq!(c.creators, Some(vec![Creator { address: MAINNET_MINT_STATE, verified: true, share: 100 }]));
    assert_eq!(c.collection_details.as_ref().unwrap()[1..9], 500u64.to_le_bytes(), "sized collection, size 500");
    assert_eq!(metadata_pda(&COLLECTION_MINT), COLLECTION_METADATA);
    for b in [MD_MEMBER, MD_COLL] {
        let m = parse(b);
        assert!(m.is_mutable && m.update_authority == MAINNET_MINT_STATE && !m.primary_sale_happened);
        assert_eq!(m.data_len, 607);
    }
}

// ── members: [GZuB:100 verified] @ 100 bps ──────────────────────────────────

#[test]
fn mainnet_member_one_instruction_keeps_gzub_verified_then_locks() {
    for so in [live_so(), freeze_so()] {
        let mut s = Main::new(&so);
        let before = s.md(&MEMBER1_METADATA);
        let cu = s.royalty(MEMBER1_METADATA, false).expect("member path: update_royalty only");
        let after = s.md(&MEMBER1_METADATA);
        assert_only_royalty_changed(&before, &after, GZUB);
        assert_eq!(after.collection, Some((true, COLLECTION_MINT)), "collection stays verified");
        println!("{so}: member path (update_royalty only) ok, {cu} CU (incl. compute-budget ix)");
        // Re-running is harmless: no change.
        let snap = s.raw(&MEMBER1_METADATA);
        s.royalty(MEMBER1_METADATA, false).expect("idempotent");
        assert_eq!(s.raw(&MEMBER1_METADATA), snap);

        if so == freeze_so() {
            dump("royalty_member_after.bin", &snap.data);
            s.lock(MEMBER1_METADATA).expect("lock");
            let mut want = parse(&snap.data);
            want.is_mutable = false;
            assert_eq!(s.md(&MEMBER1_METADATA), want, "lock changed only is_mutable");
            s.assert_updates_refused(MEMBER1_METADATA);
            dump("royalty_member_locked.bin", &s.raw(&MEMBER1_METADATA).data);
        }
    }
}

#[test]
fn mainnet_member_with_a_different_target_creator_is_refused_by_metaplex() {
    // If the target creator is anyone but GZuB, GZuB (a verified creator that is not the
    // update authority) would be dropped: Metaplex refuses (55) unless GZuB first
    // un-verifies itself. update_royalty.cjs reports such a token as BLOCKED.
    let mut s = Main::new(&freeze_so());
    let before = s.raw(&MEMBER1_METADATA);
    let other = Pubkey::new_unique();
    let ms = s.ms;
    let err = s.send(&[update_royalty_ix(ms, MINT_AUTHORITY, MEMBER1_METADATA, TARGET_BPS, &[(other, 100)])]).unwrap_err();
    assert_eq!(custom(&err), Some(MPL_CANNOT_UNVERIFY_ANOTHER_CREATOR), "{err:?}");
    // Keeping GZuB in a split is accepted and leaves it verified (shown for the record).
    let err2 = s.send(&[update_royalty_ix(ms, MINT_AUTHORITY, MEMBER1_METADATA, TARGET_BPS, &[(GZUB, 50), (other, 50)])]);
    assert!(err2.is_ok(), "{err2:?}");
    s.svm.set_account(MEMBER1_METADATA, before.clone()).unwrap();
    // The bare program accepts any bps <= 10000 and any 100-share list: the target is
    // only as good as the argument the owner passes.
    s.send(&[update_royalty_ix(ms, MINT_AUTHORITY, MEMBER1_METADATA, 10_000, &[(GZUB, 100)])]).expect("10000 bps is accepted on chain");
    let err = s.send(&[update_royalty_ix(ms, MINT_AUTHORITY, MEMBER1_METADATA, 10_001, &[(GZUB, 100)])]).unwrap_err();
    assert_eq!(custom(&err), Some(6003), "InvalidRoyalty");
}

// ── collection NFT: [mint_state:100 verified] @ 500 bps ─────────────────────

#[test]
fn mainnet_collection_nft_update_plus_sign_keeps_size_then_locks() {
    let mut s = Main::new(&freeze_so());
    let before = s.md(&COLLECTION_METADATA);
    // Without SignMetadata the update succeeds but GZuB stays UNVERIFIED (why the 2nd ix exists).
    let snap = s.raw(&COLLECTION_METADATA);
    s.royalty(COLLECTION_METADATA, false).expect("update alone");
    assert_eq!(s.md(&COLLECTION_METADATA).creators, Some(vec![Creator { address: GZUB, verified: false, share: 100 }]));
    s.svm.set_account(COLLECTION_METADATA, snap).unwrap();
    // SignMetadata before GZuB is a creator fails.
    assert!(s.send(&[sign_metadata_ix(COLLECTION_METADATA, GZUB)]).is_err());

    let cu = s.royalty(COLLECTION_METADATA, true).expect("collection path");
    let after = s.md(&COLLECTION_METADATA);
    assert_only_royalty_changed(&before, &after, GZUB);
    assert_eq!(after.collection_details, before.collection_details, "size counter kept (500)");
    assert_eq!(after.collection, None);
    assert!(!after.creators.as_ref().unwrap().iter().any(|c| c.address == s.ms), "mint_state dropped");
    println!("collection path (update + sign GZuB) ok, {cu} CU");
    dump("royalty_collection_after.bin", &s.raw(&COLLECTION_METADATA).data);

    s.lock(COLLECTION_METADATA).expect("lock collection");
    s.assert_updates_refused(COLLECTION_METADATA);
    // Members are separate accounts: the collection lock does not stop a member's royalty.
    s.royalty(MEMBER1_METADATA, false).expect("member after collection lock");
}

#[test]
fn mainnet_full_chain_then_residual_powers() {
    // royalty (member + collection), collection uri off Vercel, lock both; then what is left.
    let mut s = Main::new(&freeze_so());
    let ms = s.ms;
    s.royalty(MEMBER1_METADATA, false).unwrap();
    s.royalty(COLLECTION_METADATA, true).unwrap();
    s.send(&[update_token_uri_ix(ms, MINT_AUTHORITY, COLLECTION_METADATA, NEW_URI)]).expect("collection uri");
    for k in [MEMBER1_METADATA, COLLECTION_METADATA] {
        s.lock(k).unwrap();
        s.assert_updates_refused(k);
        s.lock(k).expect("lock again: no-op");
    }
    let c = s.md(&COLLECTION_METADATA);
    assert_eq!((c.uri.as_str(), c.seller_fee_basis_points, c.is_mutable), (NEW_URI, TARGET_BPS, false));
    // RISE audit I2, same here: GZuB can toggle its OWN verified flag after lock.
    let locked = s.md(&MEMBER1_METADATA);
    s.send(&[remove_creator_verification_ix(MEMBER1_METADATA, GZUB)]).expect("GZuB un-verifies itself");
    let unv = s.md(&MEMBER1_METADATA);
    assert_eq!(unv.creators, Some(vec![Creator { address: GZUB, verified: false, share: 100 }]));
    assert_eq!(unv.seller_fee_basis_points, TARGET_BPS);
    s.send(&[sign_metadata_ix(MEMBER1_METADATA, GZUB)]).expect("and re-verifies");
    assert_eq!(s.md(&MEMBER1_METADATA), locked);
    // A stranger cannot sign as a creator.
    let x = Pubkey::new_unique();
    s.svm.airdrop(&x, 1_000_000_000).unwrap();
    assert!(send_as(&mut s.svm, &[sign_metadata_ix(MEMBER1_METADATA, x)], &x).is_err());
}

// ── fixture state built by the LIVE program, then upgraded (real signatures) ─

#[test]
fn fixture_member_built_by_live_program() {
    // setup()'s member is exactly the Capy member shape: [creator:100 verified] @ 100 bps.
    let mut env = setup();
    let auth = env.authority.insecure_clone();
    let gzub = env.creator.insecure_clone(); // stands in for GZuB
    let md = metadata_pda(&env.member_mint);
    let before = env.md(&env.member_mint);
    assert_eq!(before.creators, Some(vec![Creator { address: gzub.pubkey(), verified: true, share: 100 }]));
    let ixs = final_royalty_ixs(env.mint_state, auth.pubkey(), md, gzub.pubkey(), false);
    env.send(&ixs, &[&auth]).expect("member path, authority signature only");
    assert_only_royalty_changed(&before, &env.md(&env.member_mint), gzub.pubkey());

    let m = env.member_mint;
    env.send(&[lock_ix(env.mint_state, auth.pubkey(), metadata_pda(&m))], &[&auth]).expect("lock");
    let err = env.send(&[update_royalty_ix(env.mint_state, auth.pubkey(), md, 100, &[(gzub.pubkey(), 100)])], &[&auth]).unwrap_err();
    assert_eq!(custom(&err), Some(MPL_DATA_IS_IMMUTABLE));
    let err = call(&mut env, &auth, NEW_URI).unwrap_err();
    assert_eq!(custom(&err), Some(MPL_DATA_IS_IMMUTABLE));
}

#[test]
fn fixture_collection_nft_built_by_live_create_collection() {
    // The live program's create_collection made it: [mint_state:100 verified] @ 500 bps.
    let mut env = setup();
    let auth = env.authority.insecure_clone();
    let target = env.creator.insecure_clone();
    let coll = env.collection_mint;
    let md = metadata_pda(&coll);
    let before = env.md(&coll);
    assert_eq!(before.seller_fee_basis_points, 500);
    assert_eq!(before.creators, Some(vec![Creator { address: env.mint_state, verified: true, share: 100 }]));
    let member_before = env.raw_md(&env.member_mint);

    let ixs = final_royalty_ixs(env.mint_state, auth.pubkey(), md, target.pubkey(), true);
    env.send(&ixs, &[&auth, &target]).expect("collection path, two real signatures");
    let after = env.md(&coll);
    assert_only_royalty_changed(&before, &after, target.pubkey());
    assert_eq!(after.collection_details, before.collection_details);
    assert_eq!(env.raw_md(&env.member_mint), member_before, "member untouched");

    env.send(&[lock_ix(env.mint_state, auth.pubkey(), md)], &[&auth]).expect("lock");
    let err = env.send(&[update_royalty_ix(env.mint_state, auth.pubkey(), md, 500, &[(env.mint_state, 100)])], &[&auth]).unwrap_err();
    assert_eq!(custom(&err), Some(MPL_DATA_IS_IMMUTABLE));
    assert_eq!(env.md(&env.member_mint).collection, Some((true, coll)), "member still verified");
}
