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
    const res = await fetch('/api/rpc', {
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
      if (capyAmt == null || xntAmt == null || xntPoolAmt == null || usdcAmt == null) return;
      if (capyAmt === 0 || xntPoolAmt === 0) return;
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
  const [price, setPrice] = useState('...');
  const [mcap, setMcap] = useState('...');
  const [xnt, setXnt] = useState('...');

  useEffect(() => {
    async function load() {
      try {
        const call = (account) => fetch('/api/rpc', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({jsonrpc:'2.0',id:1,method:'getTokenAccountBalance',params:[account]})
        }).then(r => r.json()).then(d => Number(d?.result?.value?.uiAmount || 0));

        const [capy, xntAmt, xntPool, usdc] = await Promise.all([
          call('CCd6V4WZZ3qXEZSV4daDxvWRLR2V35WGqjxLupW8Ex88'),
          call('14rjAEfArCzNFktWQU6MSkgUjAjMkqqGACoNY9xPVyxc'),
          call('8wvV4HKBDFMLEUkVWp1WPNa5ano99XCm3f9t3troyLb'),
          call('7iw2adw8Af7x3pY7gj5RwczFXuGjCoX92Gfy3avwXQtg'),
        ]);

        const xntUsd = usdc / xntPool;
        const capyXnt = xntAmt / capy;
        const capyUsd = capyXnt * xntUsd;
        const mc = capyUsd * 999993336;

        setXnt('$' + xntUsd.toFixed(4));
        setPrice('$' + capyUsd.toLocaleString(undefined, {minimumFractionDigits:6,maximumFractionDigits:6}));
        setMcap('$' + Math.round(mc).toLocaleString());
      } catch(e) { setPrice('ERR'); }
    }
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);
  const items = [['$CAPY',price],['MCAP',mcap],['XNT',xnt],['SUPPLY','1B'],['MINT PRICE','10 XNT FLAT'],['500 NFTS','30 MYTHIC'],['120 LEGENDARY','350 COMMON'],['STORAGE','LIGHTHOUSE IPFS'],['RANDOMNESS','GEIGER ENTROPY ORACLE'],['FAIRLY LAUNCHED','DEGEN LAUNCHPAD X1'],['$CAPY',price],['MCAP',mcap],['XNT',xnt],['SUPPLY','1B'],['MINT PRICE','10 XNT FLAT'],['500 NFTS','30 MYTHIC'],['120 LEGENDARY','350 COMMON'],['STORAGE','LIGHTHOUSE IPFS'],['RANDOMNESS','GEIGER ENTROPY ORACLE'],['FAIRLY LAUNCHED','DEGEN LAUNCHPAD X1']];
  return (
    <div style={{marginTop:"58px",position:"relative",zIndex:2,width:"100%",overflow:"hidden",borderTop:"1px solid var(--border)",borderBottom:"1px solid var(--border)",background:"rgba(0,229,255,0.02)",padding:".5rem 0"}}>
      <div style={{display:'flex',gap:'3rem',whiteSpace:'nowrap',width:'max-content',animation:'tick 30s linear infinite'}}>
        {items.map(([label,val],i) => (
          <div key={i} className="tick-item">{label} <b className={["tg","to","tgo","tc","tp","tg","to","tgo","tc","tp"][i % 10]}>{val}</b></div>
        ))}
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
  const wave1 = Math.min(minted, WAVE1_MAX);
  const wave2 = Math.min(Math.max(minted - WAVE1_MAX, 0), WAVE2_MAX);
  const wave3 = Math.min(Math.max(minted - WAVE1_MAX - WAVE2_MAX, 0), WAVE3_MAX);
  const currentPrice = getCurrentPrice(minted);
  const nextWave = getMintsUntilNextWave(minted);

  const buttonLabel = {
    idle: wallet.connected ? `MINT CAPY WARRIOR — ${currentPrice} XNT` : 'CONNECT WALLET TO MINT',
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
            <div className="mint-price-badge">FROM {currentPrice} XNT / MINT</div>
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

        {nextWave && (
          <div style={{fontFamily:'var(--mono)',fontSize:'.6rem',color:'var(--gold)',textAlign:'center',marginTop:'.75rem',letterSpacing:'.1em',border:'1px solid rgba(255,201,64,.2)',padding:'.5rem',background:'rgba(255,201,64,.04)'}}>
            ⚡ {nextWave.until} MINTS UNTIL PRICE INCREASES TO {nextWave.nextPrice} XNT
          </div>
        )}

        {/* Wave Pricing */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'1px',border:'1px solid var(--border)',marginTop:'1.5rem',overflow:'hidden'}}>
          {[
            {price:10,label:'WAVE 1',desc:'FIRST 150 MINTS',count:wave1,max:WAVE1_MAX,color:'var(--green)',bg:'rgba(0,255,136,0.06)',id:'wave1'},
            {price:12,label:'WAVE 2',desc:'NEXT 150 MINTS',count:wave2,max:WAVE2_MAX,color:'var(--gold)',bg:'rgba(255,201,64,0.06)',id:'wave2'},
            {price:15,label:'WAVE 3',desc:'FINAL 200 MINTS',count:wave3,max:WAVE3_MAX,color:'var(--orange)',bg:'rgba(255,106,0,0.06)',id:'wave3'},
          ].map((w,i) => (
            <div key={w.id} style={{padding:'1.25rem 1rem',background:w.bg,textAlign:'center',borderRight:i<2?'1px solid var(--border)':'none',borderTop:`2px solid ${w.color}`}}>
              <div style={{fontFamily:'var(--display)',fontSize:'2rem',color:w.color,lineHeight:1}}>{w.price} XNT</div>
              <div style={{fontFamily:'var(--mono)',fontSize:'.52rem',letterSpacing:'.18em',color:w.color,margin:'.3rem 0'}}>{w.label}</div>
              <div style={{fontFamily:'var(--mono)',fontSize:'.6rem',color:'var(--muted)'}}>{w.desc}</div>
              <div className="tp-bar-wrap" style={{marginTop:'.75rem'}}>
                <div className="tp-bar" style={{width:`${(w.count/w.max*100)}%`,background:w.color}} />
              </div>
              <div style={{fontFamily:'var(--mono)',fontSize:'.52rem',color:'var(--muted)',marginTop:'.25rem'}}>{w.count} / {w.max}</div>
            </div>
          ))}
        </div>

        <div style={{fontFamily:'var(--mono)',fontSize:'.62rem',color:'var(--muted)',textAlign:'center',marginTop:'.75rem',letterSpacing:'.1em'}}>
          MINT EARLY = LOWEST PRICE // PRICE INCREASES AS WAVES FILL
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

function XNTTracker({ minted }) {
  const wave1 = Math.min(minted, WAVE1_MAX);
  const wave2 = Math.min(Math.max(minted - WAVE1_MAX, 0), WAVE2_MAX);
  const wave3 = Math.min(Math.max(minted - WAVE1_MAX - WAVE2_MAX, 0), WAVE3_MAX);
  const xntRaised = (wave1 * WAVE1_PRICE) + (wave2 * WAVE2_PRICE) + (wave3 * WAVE3_PRICE);
  const xntLP = Math.round(xntRaised * 0.9 * 10) / 10;
  const xntGeiger = Math.round(xntRaised * 0.1 * 10) / 10;

  return (
    <div className="xnt-section">
      <div className="xnt-inner">
        <div className="stag gr">XNT RAISED — LIVE TRACKER</div>
        <h2 className="sh">WHERE THE<br /><span className="gr">XNT GOES</span></h2>
        <div className="xnt-stats">
          <div className="xnt-stat"><div className="xnt-n go">{xntRaised} XNT</div><div className="xnt-l">TOTAL XNT RAISED</div></div>
          <div className="xnt-stat"><div className="xnt-n g">{xntLP} XNT</div><div className="xnt-l">XNT ADDED TO LP</div></div>
          <div className="xnt-stat"><div className="xnt-n c">{xntGeiger} XNT</div><div className="xnt-l">XNT TO GEIGER NODE</div></div>
          <div className="xnt-stat"><div className="xnt-n p">0 $CAPY</div><div className="xnt-l">$CAPY BURNED</div></div>
        </div>
        <div className="logs-grid">
          <div className="log-box lp">
            <div className="log-header">
              <div><div className="log-total g">{xntLP} XNT</div><div className="log-total-label">TOTAL ADDED TO LP</div></div>
            </div>
            <div className="log-entries">
              <div className="log-empty">LP ADDITIONS UPDATE POST-MINT</div>
            </div>
          </div>
          <div className="log-box burn">
            <div className="log-header">
              <div><div className="log-total r">0 $CAPY</div><div className="log-total-label">TOTAL BURNED</div></div>
            </div>
            <div className="log-entries">
              <div className="log-empty">NO BURNS YET — UPDATES POST-MINT</div>
            </div>
          </div>
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
  const [capyPrice, setCapyPrice] = useState('...');
  const [capyMcap, setCapyMcap] = useState('...');
  const [capyXnt, setCapyXnt] = useState('...');
  useEffect(() => {
    async function loadPrice() {
      try {
        const call = (a) => fetch('/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getTokenAccountBalance',params:[a]})}).then(r=>r.json()).then(d=>Number(d?.result?.value?.uiAmount||0));
        const [capy,xntA,xntP,usdc] = await Promise.all([call('CCd6V4WZZ3qXEZSV4daDxvWRLR2V35WGqjxLupW8Ex88'),call('14rjAEfArCzNFktWQU6MSkgUjAjMkqqGACoNY9xPVyxc'),call('8wvV4HKBDFMLEUkVWp1WPNa5ano99XCm3f9t3troyLb'),call('7iw2adw8Af7x3pY7gj5RwczFXuGjCoX92Gfy3avwXQtg')]);
        const xu=usdc/xntP,cu=xntA/capy*xu;
        setCapyXnt('$'+xu.toFixed(4));
        setCapyPrice('$'+cu.toLocaleString(undefined,{minimumFractionDigits:6,maximumFractionDigits:6}));
        setCapyMcap('$'+Math.round(cu*999993336).toLocaleString());
      }catch(e){}
    }
    loadPrice();
    const t=setInterval(loadPrice,30000);
    return()=>clearInterval(t);
  },[]);

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
          <li><a href="#prize">🏆 PRIZE</a></li>
          <li><a href="#meme">$CAPY</a></li>
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
          <a href="#prize" className="btn-gold">🏆 WIN 50 XNT</a>
          <a href="#collection" className="btn-ghost">VIEW COLLECTION</a>
        </div>
        <div className="ticker">
          <div className="tick-inner">
            {[
              ['CAPY PRICE', capyPrice, 'tg'],
              ['MARKET CAP', capyMcap, 'to'],
              ['XNT PRICE', capyXnt, 'tgo'],
              ['PLATFORM', 'DEGEN LAUNCHPAD X1', 'tc'],
              ['500 NFTS //', '30 MYTHIC', 'tgo'],
              ['120 LEGENDARY //', '350 COMMON', 'tg'],
              ['STORAGE', 'LIGHTHOUSE IPFS', 'tc'],
              ['RANDOMNESS', 'GEIGER ENTROPY ORACLE', 'tp'],
              ['MINT PRICE', '10 XNT FLAT', 'tg'],
              ['CAPY PRICE', capyPrice, 'tg'],
              ['MARKET CAP', capyMcap, 'to'],
              ['XNT PRICE', capyXnt, 'tgo'],
              ['PLATFORM', 'DEGEN LAUNCHPAD X1', 'tc'],
              ['500 NFTS //', '30 MYTHIC', 'tgo'],
              ['120 LEGENDARY //', '350 COMMON', 'tg'],
              ['STORAGE', 'LIGHTHOUSE IPFS', 'tc'],
              ['RANDOMNESS', 'GEIGER ENTROPY ORACLE', 'tp'],
              ['MINT PRICE', '10 XNT FLAT', 'tg'],
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

      {/* XNT TRACKER */}
      <XNTTracker minted={mintState.minted} />

      {/* PRIZE SECTION */}
      <div className="prize-section" id="prize">
        <div className="prize-inner">
          <div className="prize-tag">🏆 MYSTERY PRIZE</div>
          <h2 className="prize-title"><span className="go">MINT A FEATURED</span><br />MYTHIC WIN 50 XNT</h2>
          <p className="prize-sub">These 10 Mythic CAPYs are hidden somewhere inside the 500 mint collection. Mint one of the featured Mythics below and win 50 XNT from the treasury — paid directly by the developer.</p>
          <div className="prize-how">10 FEATURED MYTHICS // 50 XNT EACH // DM TO CLAIM // t.me/CAPYX1</div>
          <div className="prize-grid">
            {[
              ['mythical_city.png','CITY // NEON GOD BLADE'],
              ['mythical_space.png','SPACE // CELESTIAL SPEAR'],
              ['mythical_ocean.png','OCEAN // TRIDENT'],
              ['mythical_lava.png','LAVA // MAGMA SWORD'],
              ['mythical_snow.png','SNOW // ICE LANCE'],
              ['mythical_desert.png','DESERT // SANDSTONE BLADE'],
              ['mythical_forrest.png','FOREST // SPIRIT BLADE'],
              ['mythical_mountain.png','MOUNTAIN // WAR AXE'],
              ['mythincal_swamp.png','SWAMP // VINE SPEAR'],
              ['mythical_beach.png','BEACH // CORAL BLADE'],
            ].map(([img, label], i) => (
              <div key={i} className="prize-card">
                <img src={`/${img}`} alt={label} />
                <div className="prize-badge">50 XNT</div>
                <div className="prize-glow" />
                <div className="prize-env">{label}</div>
              </div>
            ))}
          </div>
          <div className="prize-claim">
            <div className="prize-claim-title">HOW TO CLAIM YOUR PRIZE</div>
            <p className="prize-claim-text">
              If you mint one of the 10 featured Mythics above, DM the developer on Telegram with proof of your mint. Prize of 50 XNT will be sent directly from the treasury wallet.<br /><br />
              <a href="https://t.me/CAPYX1" target="_blank" rel="noopener noreferrer">→ t.me/CAPYX1</a>
            </p>
          </div>
          <div style={{marginTop:'2rem'}}>
            <a href="https://t.me/CAPYX1" target="_blank" rel="noopener noreferrer" className="btn-gold">JOIN TELEGRAM TO CLAIM ↗</a>
          </div>
        </div>
      </div>

      {/* GALLERY */}
      <GallerySection mintedNFTs={mintedNFTs} />

      <div className="sep-line" />

      {/* MEME SECTION */}
      <div className="meme-section" id="meme">
        <div className="meme-inner">
          <div className="meme-eyebrow">COMMUNITY MEME TOKEN</div>
          <h2 className="meme-big"><span className="g1">FAIRLY LAUNCHED</span><br /><span className="g2">COMMUNITY DRIVEN</span></h2>
          <p style={{fontSize:'.9rem',color:'var(--muted)',maxWidth:'520px',margin:'0 auto 2rem',lineHeight:1.8}}>$CAPY launched fairly on Degen Launchpad X1 — no presale, no VC, no insider allocation. Pure community meme energy on the best chain. Named after the real protocol that defended the X1 blockchain.</p>
          <div className="launch-box">
            <div className="launch-grid">
              <div><div className="launch-label">LAUNCH PLATFORM</div><div className="launch-val">DEGEN</div><div className="launch-desc">Degen Launchpad X1 — fully fair, open to everyone</div></div>
              <div><div className="launch-label">PRESALE / VC</div><div className="launch-val" style={{color:'var(--red)'}}>NONE</div><div className="launch-desc">Zero insider allocation. Community gets in equally.</div></div>
              <div><div className="launch-label">MINT PRICE</div><div className="launch-val">10–15 XNT</div><div className="launch-desc">Wave pricing: 10 / 12 / 15 XNT. Mint early for the best price.</div></div>
              <div><div className="launch-label">MISSION</div><div className="launch-val" style={{fontSize:'.95rem',color:'var(--gold)',paddingTop:'.4rem'}}>BIGGEST MEME ON X1</div><div className="launch-desc">Simple. Focused. Unstoppable.</div></div>
            </div>
          </div>
          <div className="meme-cards">
            {[
              ['🛡️','c','LEGENDARY NAME','Named after the real X1 protocol. No meme has better lore.'],
              ['⚡','g','X1 NATIVE','Built on the chain Capybara protects. We belong here.'],
              ['🏆','p','WIN 50 XNT','Mint a featured Mythic. Claim your prize. DM to collect.'],
              ['🔥','o','COMMUNITY FIRST','No fake utility. No roadmap fiction. Pure meme energy.'],
            ].map(([ico, cls, title, desc], i) => (
              <div key={i} className="mc">
                <span className="mc-ico">{ico}</span>
                <div className={`mc-t ${cls}`}>{title}</div>
                <p className="mc-d">{desc}</p>
              </div>
            ))}
          </div>
          <div style={{marginTop:'2rem',display:'flex',gap:'1rem',justifyContent:'center',flexWrap:'wrap'}}>
            <a href="#" className="btn-main">BUY $CAPY ON DEGEN LAUNCHPAD</a>
            <a href="https://t.me/CAPYX1" target="_blank" rel="noopener noreferrer" className="btn-ghost">JOIN TELEGRAM ↗</a>
          </div>
        </div>
      </div>

      {/* ECONOMICS */}
      <div className="econ-section">
        <div className="econ-inner">
          <div className="stag gr">MINT ECONOMICS — FULLY TRANSPARENT</div>
          <h2 className="sh">TIERED MINT<br /><span className="gr">PRICING</span></h2>
          <p className="sb" style={{marginBottom:0}}>Mint early for the lowest price. Every wave increases. 90% of every mint goes to LP — regardless of wave.</p>
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'1px',border:'1px solid var(--border)',marginTop:'2rem',overflow:'hidden'}}>
            {[
              {wave:'WAVE 1',price:'10 XNT',desc:'FIRST 150 MINTS',detail:'9 XNT → LP\n1 XNT → Geiger Node',total:'Total wave: 1,500 XNT',color:'var(--green)',bg:'rgba(0,255,136,0.05)'},
              {wave:'WAVE 2',price:'12 XNT',desc:'NEXT 150 MINTS',detail:'10.8 XNT → LP\n1.2 XNT → Geiger Node',total:'Total wave: 1,800 XNT',color:'var(--gold)',bg:'rgba(255,201,64,0.05)'},
              {wave:'WAVE 3',price:'15 XNT',desc:'FINAL 200 MINTS',detail:'13.5 XNT → LP\n1.5 XNT → Geiger Node',total:'Total wave: 3,000 XNT',color:'var(--orange)',bg:'rgba(255,106,0,0.05)'},
            ].map((w,i) => (
              <div key={i} style={{padding:'2rem 1.5rem',background:w.bg,textAlign:'center',borderRight:i<2?'1px solid var(--border)':'none',borderTop:`2px solid ${w.color}`}}>
                <div style={{fontFamily:'var(--mono)',fontSize:'.58rem',letterSpacing:'.25em',color:w.color,marginBottom:'.5rem'}}>{w.wave}</div>
                <div style={{fontFamily:'var(--display)',fontSize:'3.5rem',color:w.color,lineHeight:1,marginBottom:'.25rem'}}>{w.price}</div>
                <div style={{fontFamily:'var(--mono)',fontSize:'.62rem',color:'var(--muted)',marginBottom:'1rem'}}>{w.desc}</div>
                <div style={{fontSize:'.78rem',color:'var(--muted)',lineHeight:1.7,whiteSpace:'pre-line'}}>
                  {w.detail}<br /><span style={{color:w.color}}>{w.total}</span>
                </div>
              </div>
            ))}
          </div>
          <div style={{border:'1px solid var(--border)',background:'rgba(4,5,10,.6)',padding:'1.5rem 2rem',marginTop:'1px',display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'1px',textAlign:'center'}}>
            {[
              {val:'6,300',label:'TOTAL XNT IF SOLD OUT',color:'var(--cyan)'},
              {val:'5,670',label:'XNT TO LP (90%)',color:'var(--green)'},
              {val:'630',label:'XNT TO GEIGER (10%)',color:'var(--cyan)'},
              {val:'500 XNT',label:'MAX PRIZE POOL',color:'var(--gold)'},
            ].map((s,i) => (
              <div key={i} style={{padding:'.75rem',borderLeft:i>0?'1px solid var(--border)':'none'}}>
                <div style={{fontFamily:'var(--display)',fontSize:'1.8rem',color:s.color}}>{s.val}</div>
                <div style={{fontFamily:'var(--mono)',fontSize:'.52rem',letterSpacing:'.15em',color:'var(--muted)'}}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="sep-line" />

      {/* PROTOCOL */}
      <div className="proto-section" id="protocol">
        <div className="proto-inner">
          <div className="stag cy">THE REAL PROTOCOL</div>
          <h2 className="sh">PROJECT<br /><span className="cy">CAPYBARA</span></h2>
          <div className="proto-grid">
            <div>
              <div className="notice">
                <p><b>Project Capybara is a real X1 blockchain protocol</b> — specified by Jack Levin (Cyphereus Prime) on May 1st and deployed to mainnet.<br /><br /><span className="sep">$CAPY is a separate community meme.</span> Named after it because the name is legendary. No official connection. The community ran with it.</p>
              </div>
              <p style={{fontSize:'.84rem',color:'var(--muted)',lineHeight:1.85,marginBottom:'1.5rem'}}>Capybara is X1's delegation fair stake threshold system. Every epoch it calculates the 85th percentile of all active validator self-stakes — closing the door on validators trying to game Foundation delegation with tiny self-stake.</p>
              <div className="quote">
                <p className="q-text">"The p85 method ensures the threshold is always representative of real validator commitment — not a static number that becomes stale as the network evolves."</p>
                <div className="q-auth">// JACK LEVIN — CYPHEREUS PRIME — MAY 1ST</div>
              </div>
            </div>
            <div>
              <p style={{fontFamily:'var(--mono)',fontSize:'.52rem',letterSpacing:'.2em',color:'var(--muted)',marginBottom:'1rem'}}>DELEGATION CRITERIA</p>
              <div className="crit-list">
                {[
                  ['P85','SELF-STAKE','Must meet 85th percentile of all active validator self-stakes. Recalculates every epoch.'],
                  ['≤10%','COMMISSION','Maximum commission rate. Keeps fees fair for delegators.'],
                  ['≥97%','VOTE CREDITS','Minimum vote credit score. Proves active consensus participation.'],
                  ['±10%','SKIP RATE','Must stay within 10% of network average.'],
                  ['MAJ.','TACHYON VERSION','Must run majority Tachyon version. Network stays strongest.'],
                ].map(([val, name, desc], i) => (
                  <div key={i} className="crit-item">
                    <div className="crit-val" style={val==='MAJ.'?{fontSize:'.85rem'}:{}}>{val}</div>
                    <div><div className="crit-name">{name}</div><div className="crit-desc">{desc}</div></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* FOOTER */}
      <footer>
        <div className="f-logo">$CAPY</div>
        <ul className="f-links">
          <li><a href="#collection">COLLECTION</a></li>
          <li><a href="#prize">🏆 PRIZE</a></li>
          <li><a href="#meme">$CAPY</a></li>
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
