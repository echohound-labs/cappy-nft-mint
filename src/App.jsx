import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ConnectionProvider,
  WalletProvider,
  useWallet,
  useConnection,
} from '@solana/wallet-adapter-react';
import { WalletModalProvider, WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import {
  Transaction,
  TransactionInstruction,
  SystemProgram,
  PublicKey,
  Keypair,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { BackpackWalletAdapter } from '@solana/wallet-adapter-backpack';
import '@solana/wallet-adapter-react-ui/styles.css';
import './App.css';

// ── Config ─────────────────────────────────────────────────────────────
const NETWORK = 'testnet'; // switch to 'mainnet' for production

const CONFIG = {
  testnet: {
    rpc: 'https://rpc.testnet.x1.xyz',
    program: '9TjTjyiz3gpRrTaeGvxi2LTrjjsYmDers7VQVDxo9Zdh',
    mintState: 'Gpbu72gYwMPbYyaFQjdxAt2c7KV3hzCMqPWPfDYo7DSx',
    lpTreasury: 'GZuBHE3fQCQ6eSTLMwWKrK15CjtWfA58BmxdtWwG5mJJ',
    oracleOperator: 'HGFisVbULNKqogtPuGTfcHG9y6i5nboZabYwifkiiodo',
    geiger: '2dQf9uaCzXewrDNLttmtzQmc3SmqfAHz3qahKQjtGQyY',
    explorer: 'https://explorer.testnet.x1.xyz',
  },
  mainnet: {
    rpc: 'https://rpc.mainnet.x1.xyz',
    program: '9TjTjyiz3gpRrTaeGvxi2LTrjjsYmDers7VQVDxo9Zdh',
    mintState: 'Gpbu72gYwMPbYyaFQjdxAt2c7KV3hzCMqPWPfDYo7DSx',
    lpTreasury: 'GZuBHE3fQCQ6eSTLMwWKrK15CjtWfA58BmxdtWwG5mJJ',
    oracleOperator: 'HGFisVbULNKqogtPuGTfcHG9y6i5nboZabYwifkiiodo',
    geiger: 'BxUNg2yo5371BQMZPkfcxdCptFRDHkhvEXNM1QNPBRYU',
    explorer: 'https://explorer.mainnet.x1.xyz',
  },
};

const C = CONFIG[NETWORK];
const CAPY_PROGRAM = new PublicKey(C.program);
const MINT_STATE_PDA = new PublicKey(C.mintState);
const LP_TREASURY = new PublicKey(C.lpTreasury);
const ORACLE_OPERATOR = new PublicKey(C.oracleOperator);
const GEIGER_PROGRAM = new PublicKey(C.geiger);
const METADATA_PROGRAM = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

const WAVE1_MAX = 150, WAVE2_MAX = 150, WAVE3_MAX = 200;
const WAVE1_PRICE = 10, WAVE2_PRICE = 12, WAVE3_PRICE = 15;
const MAX_SUPPLY = 500;

function getCurrentPrice(minted) {
  if (minted < WAVE1_MAX) return WAVE1_PRICE;
  if (minted < WAVE1_MAX + WAVE2_MAX) return WAVE2_PRICE;
  return WAVE3_PRICE;
}

function getMintsUntilNextWave(minted) {
  if (minted < WAVE1_MAX) return { until: WAVE1_MAX - minted, nextPrice: WAVE2_PRICE };
  if (minted < WAVE1_MAX + WAVE2_MAX) return { until: WAVE1_MAX + WAVE2_MAX - minted, nextPrice: WAVE3_PRICE };
  return null;
}


// ── Market Cap Tracker ─────────────────────────────────────────────────
const RPC_URL = 'https://rpc.mainnet.x1.xyz';
const CAPY_VAULT = 'CCd6V4WZZ3qXEZSV4daDxvWRLR2V35WGqjxLupW8Ex88';
const XNT_CAPY_VAULT = '14rjAEfArCzNFktWQU6MSkgUjAjMkqqGACoNY9xPVyxc';
const XNT_USDC_VAULT_XNT = '8wvV4HKBDFMLEUkVWp1WPNa5ano99XCm3f9t3troyLb';
const XNT_USDC_VAULT_USDC = '7iw2adw8Af7x3pY7gj5RwczFXuGjCoX92Gfy3avwXQtg';
const CAPY_TOTAL_SUPPLY = 999993336.999;

async function fetchTokenBalance(account) {
  try {
    const res = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTokenAccountBalance', params: [account] }),
    });
    const j = await res.json();
    return Number(j?.result?.value?.uiAmount || 0);
  } catch { return null; }
}

function useCapyMarketData() {
  const [data, setData] = useState(null);
  const refresh = useCallback(async () => {
    try {
      const [capyAmt, xntAmt, xntPoolAmt, usdcAmt] = await Promise.all([
        fetchTokenBalance(CAPY_VAULT),
        fetchTokenBalance(XNT_CAPY_VAULT),
        fetchTokenBalance(XNT_USDC_VAULT_XNT),
        fetchTokenBalance(XNT_USDC_VAULT_USDC),
      ]);
      if (!capyAmt || !xntAmt || !xntPoolAmt || !usdcAmt) return;
      const xntUsd = usdcAmt / xntPoolAmt;
      const capyXnt = xntAmt / capyAmt;
      const capyUsd = capyXnt * xntUsd;
      const marketCapUsd = capyUsd * CAPY_TOTAL_SUPPLY;
      const marketCapXnt = capyXnt * CAPY_TOTAL_SUPPLY;
      setData({ capyUsd, capyXnt, marketCapUsd, marketCapXnt, xntUsd, capyAmt, xntAmt });
    } catch {}
  }, []);
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30000);
    return () => clearInterval(id);
  }, [refresh]);
  return data;
}

function MarketBar() {
  const data = useCapyMarketData();
  const fmtUsd = (n) => n == null ? '...' : n < 0.0001 ? '$' + n.toExponential(3) : '$' + n.toLocaleString(undefined, { minimumFractionDigits: n < 0.01 ? 6 : 4, maximumFractionDigits: n < 0.01 ? 6 : 4 });
  return (
    <div style={{background:'rgba(0,229,255,0.03)',borderBottom:'1px solid rgba(0,229,255,0.12)',padding:'.6rem 2rem',display:'flex',alignItems:'center',justifyContent:'center',gap:'2rem',flexWrap:'wrap',fontFamily:'var(--mono)',fontSize:'.58rem',letterSpacing:'.15em'}}>
      <div style={{display:'flex',alignItems:'center',gap:'.5rem'}}>
        <span style={{color:'var(--muted)'}}>$CAPY PRICE</span>
        <span style={{color:'var(--cyan)'}}>{fmtUsd(data?.capyUsd)}</span>
        <span style={{color:'var(--muted)',fontSize:'.5rem'}}>{data ? data.capyXnt.toFixed(8) + ' XNT' : '...'}</span>
      </div>
      <div style={{width:'1px',height:'12px',background:'var(--border)'}} />
      <div style={{display:'flex',alignItems:'center',gap:'.5rem'}}>
        <span style={{color:'var(--muted)'}}>MARKET CAP</span>
        <span style={{color:'var(--green)'}}>{data ? '$' + Math.round(data.marketCapUsd).toLocaleString() : '...'}</span>
      </div>
      <div style={{width:'1px',height:'12px',background:'var(--border)'}} />
      <div style={{display:'flex',alignItems:'center',gap:'.5rem'}}>
        <span style={{color:'var(--muted)'}}>XNT</span>
        <span style={{color:'var(--gold)'}}>{data ? '$' + data.xntUsd.toFixed(4) : '...'}</span>
      </div>
      <div style={{width:'1px',height:'12px',background:'var(--border)'}} />
      <div style={{display:'flex',alignItems:'center',gap:'.5rem'}}>
        <span style={{color:'var(--muted)'}}>SUPPLY</span>
        <span style={{color:'var(--muted)'}}>1B $CAPY</span>
      </div>
      <div style={{width:'1px',height:'12px',background:'var(--border)'}} />
      <div style={{display:'flex',alignItems:'center',gap:'.5rem'}}>
        <span style={{color:'var(--purple)'}}>⚡ FAIRLY LAUNCHED</span>
        <span style={{color:'var(--muted)'}}>DEGEN LAUNCHPAD X1</span>
      </div>
    </div>
  );
}

function getTier(tokenNumber) {
  if (tokenNumber <= 30) return { name: 'Mythic', color: 'var(--purple)', short: 'M' };
  if (tokenNumber <= 150) return { name: 'Legendary', color: 'var(--cyan)', short: 'L' };
  return { name: 'Common', color: 'var(--muted)', short: 'C' };
}

function short(addr) {
  return addr ? `${addr.slice(0,4)}...${addr.slice(-4)}` : '';
}

// ── Hooks ──────────────────────────────────────────────────────────────

function useMintState(connection) {
  const [state, setState] = useState({ minted: 0, bitmap: null, loaded: false });

  const refresh = useCallback(async () => {
    try {
      const acc = await connection.getAccountInfo(MINT_STATE_PDA);
      if (!acc) return;
      const minted = acc.data.readUInt32LE(8);
      const bitmap = acc.data.slice(45, 109);
      setState({ minted, bitmap, loaded: true });
    } catch(e) {}
  }, [connection]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 10000);
    return () => clearInterval(id);
  }, [refresh]);

  return { ...state, refresh };
}

function useMintedNFTs(connection, bitmap) {
  const [nfts, setNfts] = useState([]);

  useEffect(() => {
    if (!bitmap) return;
    const minted = [];
    for (let i = 0; i < MAX_SUPPLY; i++) {
      const u64Idx = Math.floor(i / 64);
      const bitIdx = i % 64;
      const lo = bitmap.readUInt32LE(u64Idx * 8);
      const hi = bitmap.readUInt32LE(u64Idx * 8 + 4);
      const isMinted = bitIdx < 32
        ? (lo & (1 << bitIdx)) !== 0
        : (hi & (1 << (bitIdx - 32))) !== 0;
      if (isMinted) {
        const tokenId = i + 1;
        minted.push({ id: tokenId, tier: getTier(tokenId) });
      }
    }
    setNfts(minted);
  }, [bitmap]);

  return nfts;
}

function useMyNFTs(connection, publicKey) {
  const [nfts, setNfts] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!publicKey) { setNfts([]); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
          publicKey, { programId: TOKEN_PROGRAM_ID }
        );
        const capyNfts = [];
        for (const ta of tokenAccounts.value) {
          const info = ta.account.data.parsed.info;
          if (info.tokenAmount?.amount !== '1' || info.tokenAmount?.decimals !== 0) continue;
          const mint = new PublicKey(info.mint);
          try {
            const [metadataPDA] = PublicKey.findProgramAddressSync(
              [Buffer.from('metadata'), METADATA_PROGRAM.toBuffer(), mint.toBuffer()],
              METADATA_PROGRAM
            );
            const metaAccount = await connection.getAccountInfo(metadataPDA);
            if (!metaAccount) continue;
            const data = metaAccount.data;
            let offset = 65;
            const nameLen = data.readUInt32LE(offset); offset += 4;
            const name = data.slice(offset, offset + nameLen).toString('utf8').replace(/\0+$/, ''); offset += nameLen;
            const symbolLen = data.readUInt32LE(offset); offset += 4;
            const symbol = data.slice(offset, offset + symbolLen).toString('utf8').replace(/\0+$/, ''); offset += symbolLen;
            const uriLen = data.readUInt32LE(offset); offset += 4;
            const uri = data.slice(offset, offset + uriLen).toString('utf8').replace(/\0+$/, '');
            if (symbol === 'CAPY' || name.startsWith('Capy')) {
              // Extract token ID from URI (e.g. .../metadata/92.json)
              const uriMatch = uri.match(/\/(\d+)\.json$/);
              const numMatch = name.match(/#(\d+)/);
              const tokenId = uriMatch ? parseInt(uriMatch[1]) : numMatch ? parseInt(numMatch[1]) : 0;
              capyNfts.push({ mint: mint.toBase58(), name, uri, id: tokenId, tokenId, tier: getTier(tokenId) });
            }
          } catch(e) { continue; }
        }
        if (!cancelled) setNfts(capyNfts);
      } catch(e) {}
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [publicKey, connection]);

  return { nfts, loading };
}

// ── Mint Hook ──────────────────────────────────────────────────────────

function useCapyMint(connection, wallet, onSuccess) {
  const [step, setStep] = useState('idle');
  const [error, setError] = useState(null);
  const [mintedToken, setMintedToken] = useState(null);
  const [txSig, setTxSig] = useState(null);

  const mint = useCallback(async () => {
    if (!wallet.publicKey || !wallet.signTransaction) return;
    setError(null); setMintedToken(null); setTxSig(null);

    try {
      const [oracleStatePDA] = PublicKey.findProgramAddressSync([Buffer.from('oracle_state')], GEIGER_PROGRAM);
      const [entropyPoolPDA] = PublicKey.findProgramAddressSync([Buffer.from('entropy_pool')], GEIGER_PROGRAM);
      const [pendingMintPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('pending_mint'), wallet.publicKey.toBuffer()], CAPY_PROGRAM
      );
      const [mintStatePDA] = PublicKey.findProgramAddressSync([Buffer.from('mint_state_v2')], CAPY_PROGRAM);

      // Close any stuck pending mint
      const existingPending = await connection.getAccountInfo(pendingMintPDA);
      if (existingPending) {
        const closeDiscrim = Buffer.from([128, 201, 19, 78, 249, 231, 10, 165]);
        const closeIx = new TransactionInstruction({
          keys: [
            { pubkey: pendingMintPDA, isSigner: false, isWritable: true },
            { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
          ],
          programId: CAPY_PROGRAM,
          data: closeDiscrim,
        });
        const closeTx = new Transaction();
        closeTx.add(closeIx);
        const { blockhash: bhc } = await connection.getLatestBlockhash();
        closeTx.recentBlockhash = bhc;
        closeTx.feePayer = wallet.publicKey;
        const signedClose = await wallet.signTransaction(closeTx);
        const sigClose = await connection.sendRawTransaction(signedClose.serialize());
        await connection.confirmTransaction(sigClose, 'confirmed');
      }

      // Derive randomness request PDA
      const oracleAcc = await connection.getAccountInfo(oracleStatePDA);
      let totalRequests = 0;
      if (oracleAcc && oracleAcc.data.length >= 56) {
        try { totalRequests = Number(oracleAcc.data.readBigUInt64LE(48)); } catch(e) {}
      }
      const [randomnessRequestPDA] = PublicKey.findProgramAddressSync(
        [
          Buffer.from('rand_request'),
          wallet.publicKey.toBuffer(),
          Buffer.from(new Uint8Array(new BigUint64Array([BigInt(totalRequests)]).buffer)),
        ],
        GEIGER_PROGRAM
      );

      // ── Step 1: Request mint ────────────────────────────────────────
      setStep('requesting');
      const requestDiscrim = Buffer.from([130, 38, 27, 69, 46, 211, 135, 145]);
      const requestIx = new TransactionInstruction({
        keys: [
          { pubkey: mintStatePDA, isSigner: false, isWritable: true },
          { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
          { pubkey: pendingMintPDA, isSigner: false, isWritable: true },
          { pubkey: oracleStatePDA, isSigner: false, isWritable: true },
          { pubkey: entropyPoolPDA, isSigner: false, isWritable: false },
          { pubkey: randomnessRequestPDA, isSigner: false, isWritable: true },
          { pubkey: GEIGER_PROGRAM, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId: CAPY_PROGRAM,
        data: requestDiscrim,
      });
      const tx1 = new Transaction().add(requestIx);
      const { blockhash: bh1 } = await connection.getLatestBlockhash();
      tx1.recentBlockhash = bh1; tx1.feePayer = wallet.publicKey;
      const signed1 = await wallet.signTransaction(tx1);
      const sig1 = await connection.sendRawTransaction(signed1.serialize());
      await connection.confirmTransaction(sig1, 'confirmed');

      // ── Step 2: Wait for Geiger ─────────────────────────────────────
      setStep('waiting');
      await new Promise((resolve) => {
        let elapsed = 0;
        const poll = setInterval(async () => {
          elapsed += 3;
          try {
            const reqAcc = await connection.getAccountInfo(randomnessRequestPDA);
            if (reqAcc && reqAcc.data[104] === 1) { clearInterval(poll); resolve(); }
          } catch(e) {}
          if (elapsed >= 180) { clearInterval(poll); resolve(); }
        }, 3000);
      });

      // ── Step 3: Fulfill mint ────────────────────────────────────────
      setStep('fulfilling');
      const nftMintKeypair = Keypair.generate();
      const nftMint = nftMintKeypair.publicKey;
      const [metadataPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('metadata'), METADATA_PROGRAM.toBuffer(), nftMint.toBuffer()],
        METADATA_PROGRAM
      );
      const minterAta = getAssociatedTokenAddressSync(nftMint, wallet.publicKey);

      const fulfillDiscrim = Buffer.from([57, 64, 56, 56, 44, 114, 224, 165]);
      const fulfillIx = new TransactionInstruction({
        keys: [
          { pubkey: mintStatePDA, isSigner: false, isWritable: true },
          { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
          { pubkey: pendingMintPDA, isSigner: false, isWritable: true },
          { pubkey: randomnessRequestPDA, isSigner: false, isWritable: false },
          { pubkey: nftMint, isSigner: true, isWritable: true },
          { pubkey: minterAta, isSigner: false, isWritable: true },
          { pubkey: metadataPDA, isSigner: false, isWritable: true },
          { pubkey: LP_TREASURY, isSigner: false, isWritable: true },
          { pubkey: ORACLE_OPERATOR, isSigner: false, isWritable: true },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: METADATA_PROGRAM, isSigner: false, isWritable: false },
          { pubkey: new PublicKey('SysvarRent111111111111111111111111111111111'), isSigner: false, isWritable: false },
        ],
        programId: CAPY_PROGRAM,
        data: fulfillDiscrim,
      });

      const tx2 = new Transaction()
        .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }))
        .add(fulfillIx);
      const { blockhash: bh2 } = await connection.getLatestBlockhash();
      tx2.recentBlockhash = bh2; tx2.feePayer = wallet.publicKey;
      tx2.partialSign(nftMintKeypair);
      const signed2 = await wallet.signTransaction(tx2);
      const sig2 = await connection.sendRawTransaction(signed2.serialize());
      await connection.confirmTransaction(sig2, 'confirmed');

      // Parse token ID from on-chain metadata URI
      let tokenId = 0;
      try {
        const [metaPDA] = PublicKey.findProgramAddressSync(
          [Buffer.from('metadata'), METADATA_PROGRAM.toBuffer(), nftMint.toBuffer()],
          METADATA_PROGRAM
        );
        const metaAcc = await connection.getAccountInfo(metaPDA);
        if (metaAcc) {
          let off = 65;
          const nameLen = metaAcc.data.readUInt32LE(off); off += 4 + nameLen;
          const symLen = metaAcc.data.readUInt32LE(off); off += 4 + symLen;
          const uriLen = metaAcc.data.readUInt32LE(off); off += 4;
          const uri = metaAcc.data.slice(off, off + uriLen).toString('utf8').replace(/ +$/, '');
          const m = uri.match(/\/(\d+)$/);
          if (m) tokenId = parseInt(m[1]);
        }
      } catch(e) {}

      setTxSig(sig1);
      setMintedToken({ id: tokenId, tier: getTier(tokenId), mint: nftMint.toBase58() });
      setStep('done');
      if (onSuccess) onSuccess();

    } catch(e) {
      setError(e.message?.slice(0, 300) || 'Mint failed');
      setStep('idle');
    }
  }, [wallet, connection, onSuccess]);

  const reset = () => { setStep('idle'); setError(null); setMintedToken(null); setTxSig(null); };

  return { mint, step, error, mintedToken, txSig, reset };
}

// ── Components ─────────────────────────────────────────────────────────

function MintReveal({ token, txSig, onClose }) {
  if (!token) return null;
  const [imgUrl, setImgUrl] = useState(null);
  const [metaName, setMetaName] = useState(null);

  useEffect(() => {
    if (!token.id) return;
    fetch(`/api/metadata/${token.id}`)
      .then(r => r.json())
      .then(data => {
        setMetaName(data.name);
        if (data.image) {
          const imgSrc = data.image.startsWith('ipfs://')
            ? `https://gateway.lighthouse.storage/ipfs/${data.image.replace('ipfs://', '')}`
            : data.image;
          setImgUrl(imgSrc);
        }
      })
      .catch(() => {});
  }, [token.id]);

  const tierColors = {
    Mythic: 'var(--purple)',
    Legendary: 'var(--cyan)',
    Common: 'var(--muted)',
  };
  const color = tierColors[token.tier.name] || 'var(--cyan)';

  return (
    <div style={{
      position:'fixed',inset:0,background:'rgba(4,5,10,.95)',zIndex:1000,
      display:'flex',alignItems:'center',justifyContent:'center',padding:'2rem'
    }} onClick={onClose}>
      <div style={{
        background:'var(--black2)',border:`1px solid ${color}`,padding:'3rem',
        maxWidth:'480px',width:'100%',textAlign:'center',
        boxShadow:`0 0 80px ${color}40`,position:'relative'
      }} onClick={e => e.stopPropagation()}>
        <div style={{fontFamily:'var(--mono)',fontSize:'.6rem',letterSpacing:'.25em',color,marginBottom:'1rem'}}>
          ✅ MINTED SUCCESSFULLY
        </div>
        {imgUrl && (
          <img src={imgUrl} alt={`CAPY #${token.id}`} style={{
            width:'200px',height:'200px',objectFit:'cover',
            border:`1px solid ${color}`,marginBottom:'1rem',
            display:'block',margin:'0 auto 1rem'
          }} />
        )}
        <div style={{fontFamily:'var(--display)',fontSize:'3.5rem',color,lineHeight:1,marginBottom:'.5rem'}}>
          CAPY #{token.id}
        </div>
        <div style={{fontFamily:'var(--mono)',fontSize:'.7rem',letterSpacing:'.2em',color,marginBottom:'.5rem'}}>
          {token.tier.name.toUpperCase()} TIER
        </div>
        {metaName && (
          <div style={{fontFamily:'var(--mono)',fontSize:'.6rem',color:'var(--muted)',marginBottom:'1.5rem',letterSpacing:'.1em'}}>
            {metaName}
          </div>
        )}
        <div style={{fontFamily:'var(--mono)',fontSize:'.6rem',color:'var(--muted)',marginBottom:'1.5rem'}}>
          MINT: {short(token.mint)}
        </div>
        {txSig && (
          <a href={`${C.explorer}/tx/${txSig}${NETWORK === 'testnet' ? '?cluster=testnet' : ''}`} target="_blank" rel="noopener noreferrer"
            style={{fontFamily:'var(--mono)',fontSize:'.65rem',color,letterSpacing:'.1em',display:'block',marginBottom:'2rem'}}>
            VIEW ON EXPLORER ↗
          </a>
        )}
        <button onClick={onClose} style={{
          fontFamily:'var(--mono)',fontSize:'.7rem',letterSpacing:'.15em',
          background:`linear-gradient(90deg,${color},var(--cyan))`,
          color:'var(--black)',border:'none',padding:'.85rem 2.5rem',cursor:'pointer',
          clipPath:'polygon(8px 0%,100% 0%,calc(100% - 8px) 100%,0% 100%)'
        }}>CLOSE</button>
      </div>
    </div>
  );
}

function MintSection({ mintState, onSuccess }) {
  const wallet = useWallet();
  const { connection } = useConnection();
  const { mint, step, error, mintedToken, txSig, reset } = useCapyMint(connection, wallet, onSuccess);
  const [showReveal, setShowReveal] = useState(false);

  useEffect(() => {
    if (step === 'done') setShowReveal(true);
  }, [step]);

  const { minted } = mintState;

  const buttonLabel = {
    idle: wallet.connected ? 'MINT CAPY WARRIOR — 10 XNT' : 'CONNECT WALLET TO MINT',
    requesting: '☢️ REQUESTING RANDOMNESS...',
    waiting: '⏳ GEIGER GENERATING ENTROPY...',
    fulfilling: '🦫 MINTING YOUR CAPY...',
    done: '✅ MINTED!',
  }[step];

  return (
    <div className="mint-progress">
      {showReveal && mintedToken && (
        <MintReveal token={mintedToken} txSig={txSig} onClose={() => { setShowReveal(false); reset(); }} />
      )}
      <div className="mint-inner">
        <div className="mint-header">
          <div className="mint-title-row">
            <div className="mint-title">MINT PROGRESS</div>
            <div className="mint-price-badge">10 XNT / MINT</div>
          </div>
          <div className="mint-counts">
            <div><div className="mc-n">{minted}</div><div className="mc-l">MINTED</div></div>
            <div><div className="mc-n" style={{color:'var(--muted)'}}>500</div><div className="mc-l">TOTAL</div></div>
            <div><div className="mc-n" style={{color:'var(--green)'}}>{MAX_SUPPLY - minted}</div><div className="mc-l">REMAINING</div></div>
          </div>
        </div>

        <div className="progress-bar-wrap">
          <div className="progress-bar-fill" style={{width:`${(minted/MAX_SUPPLY*100)}%`}} />
        </div>
        <div className="progress-labels">
          <span>{minted} MINTED</span>
          <span>{Math.round(minted/MAX_SUPPLY*100)}% COMPLETE</span>
          <span>500 TOTAL</span>
        </div>
        {/* Tier Breakdown */}
        {mintState.bitmap && (() => {
          const tiers = [{label:'MYTHIC',color:'var(--purple)',total:30,start:1,end:30},{label:'LEGENDARY',color:'var(--gold)',total:120,start:31,end:150},{label:'COMMON',color:'var(--cyan)',total:350,start:151,end:500}];
          return <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'1px',border:'1px solid var(--border)',marginTop:'1rem',overflow:'hidden'}}>
            {tiers.map((t,i) => {
              let count = 0;
              for(let id=t.start;id<=t.end;id++){const byte=Math.floor((id-1)/8);const bit=(id-1)%8;if((mintState.bitmap[byte] >> bit) % 2 === 1)count++;}
              return <div key={t.label} style={{padding:'1rem',textAlign:'center',borderRight:i<2?'1px solid var(--border)':'none'}}>
                <div style={{fontFamily:'var(--display)',fontSize:'1.5rem',color:t.color}}>{count}</div>
                <div style={{fontFamily:'var(--mono)',fontSize:'.52rem',color:t.color,letterSpacing:'.15em'}}>{t.label}</div>
                <div style={{fontFamily:'var(--mono)',fontSize:'.52rem',color:'var(--muted)'}}>{count} / {t.total} MINTED</div>
              </div>;
            })}
          </div>;
        })()}

        {/* Geiger Steps */}
        {step !== 'idle' && step !== 'done' && (
          <div style={{margin:'1.5rem 0',padding:'1.5rem',border:'1px solid var(--border)',background:'rgba(0,229,255,.02)',textAlign:'center'}}>
            <div style={{fontFamily:'var(--mono)',fontSize:'.6rem',letterSpacing:'.15em',color:'var(--cyan)',marginBottom:'1rem'}}>
              ☢️ GEIGER ENTROPY ORACLE — QUANTUM RANDOMNESS
            </div>
            <div style={{display:'flex',justifyContent:'center',alignItems:'center',gap:'1rem',flexWrap:'wrap'}}>
              {[
                {key:'requesting',label:'1. REQUEST'},
                {key:'waiting',label:'2. DECAY EVENT'},
                {key:'fulfilling',label:'3. MINT'},
              ].map((s,i) => (
                <div key={s.key} style={{display:'flex',alignItems:'center',gap:'.5rem'}}>
                  <div style={{
                    width:'28px',height:'28px',borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',
                    fontFamily:'var(--mono)',fontSize:'.6rem',
                    background: step === s.key ? 'var(--cyan)' : ['requesting','waiting','fulfilling'].indexOf(step) > i ? 'var(--green)' : 'var(--border)',
                    color: step === s.key || ['requesting','waiting','fulfilling'].indexOf(step) > i ? 'var(--black)' : 'var(--muted)',
                  }}>{i+1}</div>
                  <span style={{fontFamily:'var(--mono)',fontSize:'.55rem',color:step===s.key?'var(--cyan)':'var(--muted)',letterSpacing:'.1em'}}>{s.label}</span>
                  {i < 2 && <span style={{color:'var(--border)'}}>→</span>}
                </div>
              ))}
            </div>
            {step === 'waiting' && (
              <div style={{marginTop:'1rem',fontFamily:'var(--mono)',fontSize:'.6rem',color:'var(--muted)'}}>
                Waiting for radioactive decay event on-chain...
              </div>
            )}
          </div>
        )}

        {error && (
          <div style={{margin:'1rem 0',padding:'.75rem 1rem',border:'1px solid rgba(255,34,68,.3)',background:'rgba(255,34,68,.05)',fontFamily:'var(--mono)',fontSize:'.65rem',color:'var(--red)'}}>
            ❌ {error}
          </div>
        )}

        <div className="mint-btn-row">
          {wallet.connected ? (
            <button
              onClick={mint}
              disabled={step !== 'idle' && step !== 'done'}
              style={{
                fontFamily:'var(--mono)',fontSize:'.72rem',letterSpacing:'.15em',
                background: step === 'idle' || step === 'done'
                  ? 'linear-gradient(90deg,var(--cyan),var(--purple))'
                  : 'rgba(0,229,255,.1)',
                color: step === 'idle' || step === 'done' ? 'var(--black)' : 'var(--muted)',
                border:'none',padding:'.85rem 4rem',cursor: step === 'idle' || step === 'done' ? 'pointer' : 'default',
                clipPath:'polygon(8px 0%,100% 0%,calc(100% - 8px) 100%,0% 100%)',
                fontWeight:500,transition:'all .2s',
              }}
            >
              {buttonLabel}
            </button>
          ) : (
            <WalletMultiButton style={{
              fontFamily:'var(--mono)',fontSize:'.72rem',letterSpacing:'.15em',
              background:'linear-gradient(90deg,var(--cyan),var(--purple))',
              color:'var(--black)',border:'none',padding:'.85rem 2.5rem',
              borderRadius:0,clipPath:'polygon(8px 0%,100% 0%,calc(100% - 8px) 100%,0% 100%)',
            }} />
          )}
        </div>
      </div>
    </div>
  );
}

function MyNFTCard({ nft }) {
  const [imgUrl, setImgUrl] = useState(null);
  useEffect(() => {
    if (!nft.id) return;
    fetch(`/api/metadata/${nft.id}`)
      .then(r => r.json())
      .then(data => {
        if (data.image) setImgUrl(data.image.startsWith('ipfs://') ? `https://gateway.lighthouse.storage/ipfs/${data.image.replace('ipfs://','')}` : data.image);
      }).catch(()=>{});
  }, [nft.id]);

  return (
    <div style={{background:'rgba(4,5,10,.8)',borderRight:'1px solid var(--border)',borderBottom:'1px solid var(--border)',cursor:'pointer',overflow:'hidden'}}
      onClick={() => window.open(`${C.explorer}/address/${nft.mint}${NETWORK === 'testnet' ? '?cluster=testnet' : ''}`, '_blank')}>
      <div style={{aspectRatio:'1',position:'relative',overflow:'hidden'}}>
        {imgUrl
          ? <img src={imgUrl} alt={`CAPY #${nft.id}`} style={{width:'100%',height:'100%',objectFit:'cover',display:'block'}} />
          : <div style={{width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(4,5,10,.8)'}}><span style={{fontFamily:'var(--display)',fontSize:'2rem',color:'rgba(0,229,255,.1)'}}>🦫</span></div>
        }
      </div>
      <div style={{padding:'.5rem .75rem',borderTop:`1px solid ${nft.tier.color}`,background:'rgba(4,5,10,.95)'}}>
        <div style={{fontFamily:'var(--display)',fontSize:'1.1rem',color:nft.tier.color,lineHeight:1}}>#{nft.id}</div>
        <div style={{fontFamily:'var(--mono)',fontSize:'.45rem',letterSpacing:'.12em',color:nft.tier.color,marginTop:'.15rem'}}>{nft.tier.name}</div>
      </div>
    </div>
  );
}

function GallerySection({ mintedNFTs }) {
  const wallet = useWallet();
  const { connection } = useConnection();
  const { nfts: myNfts, loading } = useMyNFTs(connection, wallet.publicKey);
  const [nftMeta, setNftMeta] = useState({});

  // Fetch metadata for minted NFTs to get image CIDs
  useEffect(() => {
    if (mintedNFTs.length === 0) return;
    const fetchMeta = async () => {
      const meta = {};
      for (const nft of mintedNFTs) {
        try {
          const res = await fetch(`/api/metadata/${nft.id}`);
          const data = await res.json();
          if (data.image) {
            const cid = data.image.startsWith('ipfs://') ? data.image.replace('ipfs://','') : data.image.replace('https://gateway.lighthouse.storage/ipfs/','');
            meta[nft.id] = cid;
          }
        } catch(e) {}
      }
      setNftMeta(meta);
    };
    fetchMeta();
  }, [mintedNFTs]);

  return (
    <div className="gallery-section" id="collection">
      <div className="gallery-inner">
        <div className="stag pu">LIVE MINTED COLLECTION</div>
        <h2 className="sh">MINTED<br /><span className="pu">CAPYS</span></h2>
        <p className="sb">Each minted CAPY appears here as it's minted. Images stored decentrally on Lighthouse IPFS. Hover to see details.</p>

        <div className="minted-grid">
          {Array.from({length: 500}, (_, i) => {
            const nft = mintedNFTs[i];
            if (nft) {
              const cid = nftMeta[nft.id];
              return (
                <div key={nft.id} className="minted-slot filled">
                  {cid && (
                    <img
                      src={`https://gateway.lighthouse.storage/ipfs/${cid}`}
                      alt={`CAPY #${nft.id}`}
                      style={{width:'100%',height:'100%',objectFit:'cover',position:'absolute',inset:0}}
                    />
                  )}
                  <div className="cid-label">CAPY #{nft.id} — {nft.tier.name}</div>
                </div>
              );
            }
            return (
              <div key={i} className="minted-slot empty">
                <div className="slot-n">{i+1}</div>
                <div className="slot-l">UNMINTED</div>
              </div>
            );
          })}
        </div>

        {/* My Capys */}
        <div className="wallet-section" style={{marginTop:'2rem'}}>
          {!wallet.connected ? (
            <div className="wallet-msg">
              Connect your X1 wallet to view <span>your CAPY NFTs</span>
            </div>
          ) : loading ? (
            <div className="wallet-msg">Loading your Capys...</div>
          ) : myNfts.length === 0 ? (
            <div className="wallet-msg">No Capy Warriors in this wallet yet. <span>Mint one!</span></div>
          ) : (
            <div>
              <div style={{fontFamily:'var(--mono)',fontSize:'.6rem',letterSpacing:'.2em',color:'var(--cyan)',marginBottom:'1rem'}}>
                // YOUR CAPY WARRIORS ({myNfts.length})
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))',gap:'1px',border:'1px solid var(--border)',overflow:'hidden'}}>
                {myNfts.map(nft => (
                  <MyNFTCard key={nft.mint} nft={nft} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


// ── Main App ───────────────────────────────────────────────────────────

function DisclaimerModal({ open, onClose }) {
  if (!open) return null;
  return (
    <div style={{position:"fixed",top:0,left:0,width:"100%",height:"100%",background:"rgba(0,0,0,0.85)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center"}} >
      <div style={{background:"#0a0f1a",border:"1px solid rgba(0,220,255,0.2)",borderRadius:"12px",padding:"2rem",maxWidth:"560px",width:"90%",maxHeight:"80vh",overflowY:"auto"}}>
        <h2 style={{color:"var(--cyan)",fontFamily:"var(--mono)",marginBottom:"1rem"}}>⚠ DISCLAIMER</h2>
        <p style={{color:"#aaa",fontSize:".85rem",marginBottom:"1rem"}}><strong>Last updated: May 2026</strong></p>
        <p style={{color:"#aaa",fontSize:".85rem",marginBottom:"1rem"}}>By accessing this website and participating in the Capy Warriors NFT mint, you acknowledge and agree to the following:</p>
        <ol style={{color:"#aaa",fontSize:".85rem",lineHeight:1.8,paddingLeft:"1.2rem"}}>
          <li><strong>No Financial Advice.</strong> Nothing on this website constitutes financial, investment, legal, or tax advice.</li>
          <li><strong>High Risk.</strong> Cryptocurrency and NFTs are highly volatile and speculative. You may lose all funds spent.</li>
          <li><strong>No Guarantees.</strong> The project makes no guarantees regarding token value, liquidity, returns, or market performance.</li>
          <li><strong>Not a Security.</strong> Capy Warriors NFTs are not securities. They are digital collectibles.</li>
          <li><strong>Random Mint.</strong> Your specific Capy is determined by on-chain randomness from the Geiger Entropy Oracle. Results are final.</li>
          <li><strong>Regulatory Risk.</strong> Ensure compliance with local laws before participating.</li>
          <li><strong>Smart Contract Risk.</strong> Smart contracts may contain bugs. Participation is at your own risk.</li>
          <li><strong>No Refunds.</strong> All mints are final. No refunds once confirmed on-chain.</li>
          <li><strong>Independent Project.</strong> Capy Warriors is not endorsed by or affiliated with the X1 Network Foundation.</li>
          <li><strong>Age Requirement.</strong> You must be at least 18 years old to participate.</li>
          <li><strong>Limitation of Liability.</strong> The creators disclaim all liability for any damages arising from participation.</li>
        </ol>
        <p style={{color:"#aaa",fontSize:".85rem",margin:"1rem 0"}}>By clicking "I Agree," you confirm that you have read, understood, and accept all terms above.</p>
        <button onClick={onClose} style={{background:"var(--cyan)",color:"#000",border:"none",padding:".75rem 2rem",borderRadius:"6px",fontFamily:"var(--mono)",fontWeight:700,cursor:"pointer",width:"100%",fontSize:"1rem"}}>I AGREE — ENTER SITE</button>
      </div>
    </div>
  );
}

function CapyApp() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const mintState = useMintState(connection);
  const mintedNFTs = useMintedNFTs(connection, mintState.bitmap);
  const [refreshTick, setRefreshTick] = useState(0);
  const [showDisclaimer, setShowDisclaimer] = useState(true);
  const [agreed, setAgreed] = useState(false);
  const handleAgree = () => { setAgreed(true); setShowDisclaimer(false); };

  const handleMintSuccess = useCallback(() => {
    setTimeout(() => {
      mintState.refresh();
      setRefreshTick(t => t + 1);
    }, 3000);
  }, [mintState]);

  return (
    <div>
      {/* NAV */}
      <nav>
        <div className="nav-logo">$CAPY</div>
        <ul className="nav-links">
          <li><a href="#collection">COLLECTION</a></li>
          <li><a href="#protocol">PROTOCOL</a></li>
        </ul>
        <div style={{display:'flex',alignItems:'center',gap:'1rem'}}>
          <div className="live"><div className="dot" />{NETWORK === 'testnet' ? 'TESTNET' : 'LIVE ON X1'}</div>
          <WalletMultiButton style={{
            fontFamily:'var(--mono)',fontSize:'.62rem',letterSpacing:'.1em',
            background:'rgba(0,229,255,.1)',border:'1px solid var(--border)',
            color:'var(--cyan)',borderRadius:0,height:'36px',padding:'0 1rem',
          }} />
        </div>
      </nav>
      <MarketBar />


      {/* FAIRLY LAUNCHED SECTION */}
      <div style={{borderBottom:'1px solid var(--border)',padding:'3rem 2rem',textAlign:'center',background:'rgba(4,5,10,.8)',position:'relative',overflow:'hidden'}}>
        <div style={{position:'absolute',inset:0,background:'radial-gradient(ellipse at center, rgba(0,229,255,0.03) 0%, transparent 70%)',pointerEvents:'none'}} />
        <div style={{fontFamily:'var(--mono)',fontSize:'.55rem',letterSpacing:'.3em',color:'var(--purple)',marginBottom:'1rem'}}>
          ⚡ COMMUNITY MEME TOKEN — X1 NETWORK
        </div>
        <h2 style={{fontFamily:'var(--display)',fontSize:'clamp(1.8rem,4vw,3rem)',color:'var(--cyan)',lineHeight:1.1,marginBottom:'1.5rem',letterSpacing:'.05em'}}>
          FAIRLY LAUNCHED<br /><span style={{color:'var(--green)'}}>NO PRESALE. NO VC. NO INSIDERS.</span>
        </h2>
        <p style={{fontFamily:'var(--mono)',fontSize:'.7rem',color:'var(--muted)',maxWidth:'620px',margin:'0 auto 1.5rem',lineHeight:2,letterSpacing:'.08em'}}>
          Launched on <span style={{color:'var(--cyan)'}}>Degen Launchpad X1</span> — every wallet got in on equal terms.
          Named after the real <span style={{color:'var(--gold)'}}>Project Capybara protocol</span> that defended the X1 blockchain.
          The community ran with it.
        </p>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:'1px',border:'1px solid var(--border)',maxWidth:'800px',margin:'0 auto 2rem',overflow:'hidden'}}>
          {[
            ['🛡️','NOT A SECURITY','A community meme token. Not an investment product of any kind.'],
            ['⚖️','NO PROFIT PROMISES','No guarantees of return. No roadmap fiction. No financial promises.'],
            ['🌐','EQUAL ACCESS','No presale. No VC allocation. No insider wallets. Pure fair launch.'],
            ['🔥','X1 NATIVE','Built on the chain Capybara protects. Community meme energy only.'],
          ].map(([ico, title, desc], i) => (
            <div key={i} style={{padding:'1.5rem 1rem',textAlign:'center',background:'rgba(4,5,10,.6)',borderRight:i<3?'1px solid var(--border)':'none'}}>
              <div style={{fontSize:'1.5rem',marginBottom:'.5rem'}}>{ico}</div>
              <div style={{fontFamily:'var(--mono)',fontSize:'.52rem',letterSpacing:'.2em',color:'var(--cyan)',marginBottom:'.5rem'}}>{title}</div>
              <div style={{fontFamily:'var(--mono)',fontSize:'.55rem',color:'var(--muted)',lineHeight:1.7}}>{desc}</div>
            </div>
          ))}
        </div>
        <div style={{fontFamily:'var(--mono)',fontSize:'.55rem',color:'rgba(100,100,120,.6)',letterSpacing:'.1em',maxWidth:'600px',margin:'0 auto'}}>
          $CAPY is a community meme token — not an investment, not a security, not a financial product.
          No promises of profit. No guarantees of any kind. Participate for fun and community only.
        </div>
      </div>
      {/* HERO */}
      <div className="hero">
        <div className="orb1" /><div className="orb2" /><div className="orb3" />
        <div className="alert-bar">⚠ BLOCKCHAIN UNDER ATTACK — IMPLEMENT PROJECT CAPYBARA</div>
        <div className="hero-tag">X1 NETWORK // COMMUNITY MEME</div>
        <h1 className="hero-title">
          <span className="t1">$CAPY</span>
          <span className="t2">X1</span>
        </h1>
        <p className="hero-sub">THE CAPYBARA THAT GUARDS THE BLOCKCHAIN<br />NOW GUARDS THE MEME</p>
        <div className="btn-row">
          <a href="https://app.xdex.xyz/swap" target="_blank" rel="noopener noreferrer" className="btn-main">BUY $CAPY</a>
          <a href="#collection" className="btn-ghost">VIEW COLLECTION</a>
        </div>
        <div className="ticker">
          <div className="tick-inner">
            {[
              ['$CAPY','FAIRLY LAUNCHED','tg'],
              ['PLATFORM','DEGEN LAUNCHPAD X1','to'],
              ['500 NFTS','30 MYTHIC','tgo'],
              ['STORAGE','LIGHTHOUSE IPFS','tc'],
              ['$CAPY','FAIRLY LAUNCHED','tg'],
              ['PLATFORM','DEGEN LAUNCHPAD X1','to'],
              ['500 NFTS','30 MYTHIC','tgo'],
              ['STORAGE','LIGHTHOUSE IPFS','tc'],
            ].map(([label, value, cls], i) => (
              <div key={i} className="tick-item">{label} <b className={cls}>{value}</b></div>
            ))}
          </div>
        </div>
      </div>

      {/* MYTHIC STRIP */}
      <div className="myth-strip">
        <div className="myth-strip-track">
          {[
            ['mythical_city.png','City','cy'],
            ['mythical_space.png','Space','pu'],
            ['mythical_ocean.png','Ocean','cy'],
            ['mythical_lava.png','Lava','or'],
            ['mythical_snow.png','Snow','cy'],
            ['mythical_desert.png','Desert','go'],
            ['mythical_forrest.png','Forest','gr'],
            ['mythical_mountain.png','Mountain','cy'],
            ['mythincal_swamp.png','Swamp','gr'],
            ['mythical_beach.png','Beach','cy'],
            ['mythical_city.png','City','cy'],
            ['mythical_space.png','Space','pu'],
            ['mythical_ocean.png','Ocean','cy'],
            ['mythical_lava.png','Lava','or'],
            ['mythical_snow.png','Snow','cy'],
            ['mythical_desert.png','Desert','go'],
            ['mythical_forrest.png','Forest','gr'],
            ['mythical_mountain.png','Mountain','cy'],
            ['mythincal_swamp.png','Swamp','gr'],
            ['mythical_beach.png','Beach','cy'],
          ].map(([img, label, cls], i) => (
            <div key={i} className="myth-img-wrap">
              <img src={`/${img}`} alt={`Mythic ${label}`} />
              <div className={`env-tag ${cls}`}>{label.toUpperCase()} // MYTHIC</div>
            </div>
          ))}
        </div>
      </div>

      {/* MINT SECTION */}
      <MintSection mintState={mintState} onSuccess={handleMintSuccess} />



      <div className="sep-line" />
      {/* FOOTER */}
      <footer>
        <div className="f-logo">$CAPY</div>
        <ul className="f-links">
          <li><a href="#collection">COLLECTION</a></li>
          <li><a href="#protocol">PROTOCOL</a></li>
          <li><a href="https://t.me/CAPYX1" target="_blank" rel="noopener noreferrer">TELEGRAM ↗</a></li>
          <li><a href="https://x1.xyz" target="_blank" rel="noopener noreferrer">X1 NETWORK ↗</a></li>
        </ul>
        <div className="f-meta">BLOCKCHAIN UNDER ATTACK<br />IMPLEMENT PROJECT CAPYBARA<br /><b>// CYPHEREUS PRIME // X1</b></div>
      </footer>
      <DisclaimerModal open={showDisclaimer} onClose={handleAgree} />
    </div>
  );
}

// ── Root with Wallet Providers ─────────────────────────────────────────

export default function App() {
  const endpoint = C.rpc;
  const wallets = useMemo(() => [
    new BackpackWalletAdapter(),
  ], []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <CapyApp />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
