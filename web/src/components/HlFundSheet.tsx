/* Deposit / withdraw between the connected Arbitrum wallet and the Hyperliquid perps
   account. Deposit = native-USDC transfer to Bridge2 (lib/hyperliquid-fund). Withdraw =
   signed withdraw3 (lib/hyperliquid-exchange). Every transaction is signed by the user's
   own wallet; this component only builds + submits and shows honest status. */
import { track } from '../lib/analytics';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useHlSigner } from '../hooks/useHlSigner';
import { useHlAccount } from '../hooks/useHlAccount';
import { Icon } from './Icon';
import * as market from '../lib/market.js';
// @ts-ignore — JS module
import { toast, hideToast } from '../lib/ui.js';
import { withdraw, usdClassTransfer, spotUsdcBalance } from '../lib/hyperliquid-exchange';
import { depositToHl, arbUsdcBalance, arbEthBalance, ensureArbitrum, HL_MIN_DEPOSIT, HL_BRIDGE2 } from '../lib/hyperliquid-fund';
import { chainById } from '../lib/funding';
import { walletBalances } from '../lib/venueBalances';

const short = (a: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');

export function HlFundSheet({ mode, onClose }: { mode: 'deposit' | 'withdraw'; onClose: () => void }) {
  const auth = useAuth();
  const signer = useHlSigner();
  // DEV-only visual QA: sessionStorage 'hence.devFundAddr' renders the sheet as if that
  // address were connected (the portfolio's devPfAddr trick). Signing paths stay dead.
  const devAddr = import.meta.env.DEV ? sessionStorage.getItem('hence.devFundAddr') : null;
  const addr = devAddr || auth.address || '';
  const hl = useHlAccount(addr || undefined);
  const [tab, setTab] = useState<'deposit' | 'withdraw'>(mode);
  const [amt, setAmt] = useState('');
  const [dest, setDest] = useState(addr);
  const [busy, setBusy] = useState(false);
  const [arbUsdc, setArbUsdc] = useState<number | null>(null);
  const [arbEth, setArbEth] = useState<number | null>(null);
  const [spotUsdc, setSpotUsdc] = useState<number | null>(null);
  const [moving, setMoving] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  // withdraw progress: HL finalizes + dispatches on Arbitrum in ~5 min; we watch the
  // destination's USDC balance so the user sees "landed" without leaving the sheet
  const [wd, setWd] = useState<{ stage: 'pending' | 'landed' | 'slow'; amount: number; dest: string; baseBal: number } | null>(null);
  useEffect(() => {
    if (!wd || wd.stage !== 'pending') return;
    const started = Date.now();
    const id = window.setInterval(async () => {
      const bal = await arbUsdcBalance(wd.dest);
      // HL keeps a $1 fee — expect amount-1 to arrive
      if (bal >= wd.baseBal + wd.amount - 1 - 0.01) {
        setWd({ ...wd, stage: 'landed' });
        toast(`${(wd.amount - 1).toFixed(2)} USDC landed on Arbitrum`, { icon: 'check' });
      } else if (Date.now() - started > 12 * 60_000) {
        setWd({ ...wd, stage: 'slow' });
      }
    }, 12_000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wd?.stage, wd?.dest]);

  useEffect(() => { setDest(addr); }, [addr]);
  // live Arbitrum + HL-spot balances for the deposit tab. The poll doubles as the
  // bridge/onramp ARRIVAL watcher: a jump in Arbitrum USDC while the sheet is open
  // (auto-bridge or add-cash landing) announces itself and pre-fills the amount, so
  // "get USDC here" flows straight into "deposit it" without the user reconciling.
  const prevArb = useRef<number | null>(null);
  useEffect(() => {
    if (!addr) return;
    let alive = true;
    prevArb.current = null;
    const load = () => {
      arbUsdcBalance(addr).then((v) => {
        if (!alive) return;
        setArbUsdc(v);
        if (prevArb.current != null && v > prevArb.current + 0.5) {
          toast(`${(v - prevArb.current).toFixed(2)} USDC arrived on Arbitrum — ready to deposit`, { icon: 'check' });
          setAmt((a) => a || String(Math.floor(v * 100) / 100));
        }
        prevArb.current = v;
      });
      arbEthBalance(addr).then((v) => alive && setArbEth(v));
      spotUsdcBalance(addr).then((v) => alive && setSpotUsdc(v));
    };
    load();
    const id = window.setInterval(load, 12_000);
    return () => { alive = false; window.clearInterval(id); };
  }, [addr]);

  // funds sitting on OTHER chains (Base/Ethereum ETH+USDC) — surfaced so nobody
  // dead-ends at "Not enough USDC on Arbitrum" while their money sits one bridge away
  const [others, setOthers] = useState<{ total: number; where: string } | null>(null);
  useEffect(() => {
    if (!addr) { setOthers(null); return; }
    let alive = true;
    walletBalances(addr).then((w) => {
      if (!alive || !w) return;
      const rows = w.assets.filter((a) => a.chain !== 'Arbitrum');
      const total = rows.reduce((s, a) => s + a.usd, 0);
      setOthers({ total, where: [...new Set(rows.map((a) => a.chain))].join(' · ') });
    }).catch(() => {});
    return () => { alive = false; };
  }, [addr]);

  // The wallet funnel's rails, inline: bridge any chain/asset → Arbitrum USDC (Privy
  // universal deposit), or buy USDC straight onto Arbitrum (fiat onramp). Both are
  // Privy-owned modals; this sheet only routes and then watches for arrival above.
  const ARB = chainById('arbitrum');
  const fundBridge = () => {
    const f: any = (window as any).henceFund;
    if (!f?.ready) { toast('Sign in first', { icon: 'info' }); return; }
    track('bridge_opened', { to: 'arbitrum', from: 'hlfund' });
    toast('Opening bridge…', { spinner: true, sticky: true });
    Promise.resolve(f.deposit(ARB.caip2, ARB.token))
      .then(() => toast('Bridge started — USDC lands on Arbitrum shortly', { icon: 'check' }))
      .catch((err: any) => {
        const code = String((err && (err.code || err.message)) || '');
        if (code.includes('DEPOSIT_ADDRESSES_NOT_ENABLED')) toast('Auto-bridge isn’t enabled for this app yet', { icon: 'info', duration: 3600 });
        else if (code.includes('USER_EXITED') || /cancel/i.test(code)) hideToast();
        else toast('Could not start the bridge', { icon: 'info', duration: 3200 });
      });
  };
  const fundCash = () => {
    const f: any = (window as any).henceFund;
    if (!f?.ready) { toast('Sign in first', { icon: 'info' }); return; }
    track('addcash_opened', { to: 'arbitrum', from: 'hlfund' });
    toast('Opening add cash…', { spinner: true, sticky: true });
    Promise.resolve(f.addCash(ARB.caip2, ARB.token))
      .then(() => toast('Purchase started — USDC arrives on Arbitrum shortly', { icon: 'check' }))
      .catch((err: any) => {
        const code = String((err && (err.code || err.message)) || '');
        if (code.includes('USER_EXITED') || /cancel|exit/i.test(code)) hideToast();
        else toast('Add cash isn’t available right now', { icon: 'info', duration: 3200 });
      });
  };

  // Move HL spot USDC → perp (usdClassTransfer). Bridge2 deposits land in spot; perps + withdraw
  // use the perp balance, so this is the step that makes a deposit tradeable.
  const moveToPerp = async (amount: number) => {
    if (!signer.sign) { toast('Connect a wallet', { icon: 'wallet' }); return; }
    if (!(amount > 0)) return;
    setMoving(true);
    try {
      // usdClassTransfer is an off-chain EIP-712 sig; the wallet must be on Arbitrum One
      // (0xa4b1) or it rejects the signTypedData whose domain.chainId is 0xa4b1.
      if (auth.wallet) await ensureArbitrum(auth.wallet);
      const r = await usdClassTransfer(signer.sign, amount, true);
      if ('error' in r) toast(r.error, { icon: 'close' });
      else {
        track('withdraw_submitted', { usd: Number(amt) || undefined });
        toast(`Moved ${amount.toFixed(2)} USDC to your perp account.`, { icon: 'check' });
        hl.refresh?.();
        if (addr) spotUsdcBalance(addr).then(setSpotUsdc);
      }
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.error('[HL] spot→perp transfer failed', e);
      toast(e?.shortMessage || e?.message || 'Transfer was cancelled', { icon: 'close' });
    } finally {
      setMoving(false);
    }
  };

  const connected = !!devAddr || !!(auth.authenticated && addr && auth.wallet);
  const usd = Number(amt);

  const doDeposit = async () => {
    setBusy(true); setTxHash(null);
    const target = usd;
    const spotBefore = await spotUsdcBalance(addr);
    const r = await depositToHl(auth.wallet, addr, target);
    if (!r.ok) { toast(r.error, { icon: 'close' }); setBusy(false); return; }
    setTxHash(r.hash); setAmt('');
    track('deposit_submitted', { usd: Number(amt) || undefined });
    toast('Deposit confirmed — crediting Hyperliquid spot…', { icon: 'check' });
    // Bridge2 credits SPOT in ~1 min; poll for it, then auto-move the deposit to perp so it's tradeable.
    let credited = false;
    for (let i = 0; i < 30 && !credited; i++) {
      await new Promise((res) => setTimeout(res, 3000));
      const sp = await spotUsdcBalance(addr); setSpotUsdc(sp);
      if (sp >= spotBefore + target - 0.01) credited = true;
    }
    setBusy(false);
    if (credited) {
      hl.refresh?.();
      // Unified / portfolio-margin accounts trade directly off the spot USDC balance — no
      // spot→perp transfer (HL rejects it). Standard accounts still need the move.
      if (hl.unified) toast('Credited — your deposit is ready to trade.', { icon: 'check' });
      else { toast('Credited — approve moving it to your perp account.', { icon: 'info' }); await moveToPerp(target); }
    } else toast('Still crediting to Hyperliquid. It will appear shortly.', { icon: 'info' });
  };

  const doWithdraw = async () => {
    if (!signer.sign) { toast('Connect a wallet to withdraw', { icon: 'wallet' }); return; }
    setBusy(true);
    try {
      // withdraw3 is an off-chain EIP-712 sig; wallet must be on Arbitrum One to accept it.
      if (auth.wallet) await ensureArbitrum(auth.wallet);
      const baseBal = await arbUsdcBalance(dest).catch(() => 0);
      const r = await withdraw(signer.sign, dest, usd);
      if ('error' in r) toast(r.error, { icon: 'close' });
      else {
        // keep the sheet open and track the bridge instead of vanishing on the user
        setWd({ stage: 'pending', amount: usd, dest, baseBal });
        setAmt('');
        toast('Withdrawal submitted — tracking arrival on Arbitrum…', { icon: 'check' });
        hl.refresh?.();
      }
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.error('[HL] withdraw failed', e);
      toast(e?.shortMessage || e?.message || 'Withdrawal was cancelled', { icon: 'close' });
    } finally {
      setBusy(false);
    }
  };

  const depIssue = !connected ? 'Connect a wallet' : usd < HL_MIN_DEPOSIT ? `Minimum ${HL_MIN_DEPOSIT} USDC`
    : (arbUsdc != null && usd > arbUsdc) ? 'Not enough USDC on Arbitrum'
      : (arbEth != null && arbEth <= 0) ? 'Needs ETH on Arbitrum for gas' : null;
  const wdMax = Math.max(0, hl.withdrawable || 0);
  const wdIssue = !connected ? 'Connect a wallet' : !(usd > 0) ? 'Enter an amount'
    : usd > wdMax ? 'Exceeds withdrawable' : !/^0x[0-9a-fA-F]{40}$/.test(dest) ? 'Invalid destination' : null;

  return (
    <div className="hlfund-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="hlfund" role="dialog" aria-label="Fund Hyperliquid">
        <div className="hlfund__head">
          <b>Hyperliquid account</b>
          <button className="hlfund__x" onClick={onClose} aria-label="Close"><Icon name="close" size={15} /></button>
        </div>
        <div className="hlfund__tabs">
          <button className={tab === 'deposit' ? 'on' : ''} onClick={() => { setTab('deposit'); setAmt(''); }}>Deposit</button>
          <button className={tab === 'withdraw' ? 'on' : ''} onClick={() => { setTab('withdraw'); setAmt(''); }}>Withdraw</button>
        </div>

        {tab === 'deposit' ? (
          <div className="hlfund__body">
            <div className="hlfund__row"><span>Your Arbitrum USDC</span><b>{arbUsdc == null ? '…' : `${arbUsdc.toFixed(2)} USDC`}</b></div>
            <div className="hlfund__row"><span>{hl.unified ? 'In your Hyperliquid account' : 'In your perp account'}</span><b>{hl.loaded ? market.fmtUsd(hl.accountValue) : '…'}</b></div>
            {/* Standard accounts: bridged USDC lands in spot and needs a spot→perp move to trade.
                Unified accounts trade directly off spot, so this step doesn't apply. */}
            {connected && !hl.unified && spotUsdc != null && spotUsdc > 0.01 && (
              <div className="hlfund__spot">
                <div className="hlfund__row"><span>In HL spot · not tradeable yet</span><b>{spotUsdc.toFixed(2)} USDC</b></div>
                <button className="hlfund__move" disabled={moving} onClick={() => moveToPerp(spotUsdc)}>{moving ? 'Sign in your wallet…' : `Move ${spotUsdc.toFixed(2)} USDC → perp`}</button>
              </div>
            )}
            <label className="hlfund__field">
              <span>Amount</span>
              <input type="text" inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} placeholder={`${HL_MIN_DEPOSIT}.00`} />
              <button className="hlfund__max" onClick={() => arbUsdc != null && setAmt(String(Math.floor(arbUsdc * 100) / 100))}>MAX</button>
              <span className="hlfund__unit">USDC</span>
            </label>
            <div className="hlfund__note">Sends native USDC on Arbitrum to Hyperliquid's bridge (<code>{short(HL_BRIDGE2)}</code>). Credits your account in ~1 min. Needs a little ETH on Arbitrum for gas. Min {HL_MIN_DEPOSIT} USDC.</div>
            {connected && (
              <div className="hlfund__bridge">
                <div className="hlfund__bridgehead">
                  Need USDC on Arbitrum?
                  {others != null && others.total > 0.5 && <> You have <b>{market.fmtUsd(others.total)}</b> on {others.where}.</>}
                </div>
                <div className="hlfund__bridgerow">
                  <button className="hlfund__alt" onClick={fundBridge}><Icon name="send" size={13} /> Bridge from any chain</button>
                  <button className="hlfund__alt" onClick={fundCash}><Icon name="card" size={13} /> Add cash</button>
                </div>
              </div>
            )}
            {txHash && <a className="hlfund__tx" href={`https://arbiscan.io/tx/${txHash}`} target="_blank" rel="noreferrer">View deposit on Arbiscan <Icon name="arrowRight" size={11} /></a>}
            {!connected
              ? <button className="hlfund__cta" onClick={() => auth.login()}>Connect your wallet</button>
              : <button className="hlfund__cta" disabled={busy || !!depIssue} onClick={doDeposit}>{busy ? 'Confirm in your wallet…' : depIssue || `Deposit ${usd >= HL_MIN_DEPOSIT ? usd : ''} USDC to Hyperliquid`}</button>}
          </div>
        ) : (
          <div className="hlfund__body">
            <div className="hlfund__row"><span>Withdrawable</span><b>{hl.loaded ? market.fmtUsd(wdMax) : '…'}</b></div>
            <label className="hlfund__field">
              <span>Amount</span>
              <input type="text" inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} placeholder="0.00" />
              <button className="hlfund__max" onClick={() => setAmt(String(Math.floor(wdMax * 100) / 100))}>MAX</button>
              <span className="hlfund__unit">USDC</span>
            </label>
            <label className="hlfund__field hlfund__field--dest">
              <span>To</span>
              <input type="text" value={dest} onChange={(e) => setDest(e.target.value.trim())} spellCheck={false} />
            </label>
            <div className="hlfund__note">Withdraws to Arbitrum as native USDC (Hyperliquid charges a $1 fee). Defaults to your own wallet — double-check any other address, transfers are irreversible.</div>
            {wd && (
              <div className={'hlfund__wdstatus hlfund__wdstatus--' + wd.stage}>
                {wd.stage === 'pending' && <><span className="hlfund__wdspin" /> Withdrawing {wd.amount.toFixed(2)} USDC — Hyperliquid finalizes and sends on Arbitrum in ~5 min. Safe to close this sheet.</>}
                {wd.stage === 'landed' && <><Icon name="check" size={13} /> {(wd.amount - 1).toFixed(2)} USDC landed in {short(wd.dest)}.</>}
                {wd.stage === 'slow' && <><Icon name="alert" size={13} /> Taking longer than usual — check the address on Arbiscan.</>}
                <a href={`https://arbiscan.io/address/${wd.dest}#tokentxns`} target="_blank" rel="noreferrer">View on Arbiscan <Icon name="arrowRight" size={10} /></a>
              </div>
            )}
            {!connected
              ? <button className="hlfund__cta" onClick={() => auth.login()}>Connect your wallet</button>
              : <button className="hlfund__cta" disabled={busy || !!wdIssue || wd?.stage === 'pending'} onClick={doWithdraw}>{busy ? 'Sign in your wallet…' : wd?.stage === 'pending' ? 'Withdrawal in flight…' : wdIssue || `Withdraw ${usd > 0 ? usd : ''} USDC`}</button>}
          </div>
        )}
      </div>
    </div>
  );
}
