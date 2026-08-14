# Hence Incognito

Shielded trading on [Avantis](https://avantisfi.com) (Base), with identity and pre-trade
intent held in [Inco Lightning](https://inco.org).

**The trade is public. You are not.** That distinction is the entire product — see
"What is actually private" below, and do not let any copy overclaim past it.

## How it works

Avantis positions are stored against a **plaintext trader address** and are permanently,
publicly queryable — from the contract and from an unauthenticated API. Nothing can make a
trade that reaches Avantis private. So this does not try to hide the trade; it hides **you**.

Each trader gets a shielded wallet, **funded from a shared Hence address rather than their own**
— that funding step is what breaks the on-chain link, and it means the crowd you blend into is
every other Incognito user. Inco Lightning holds the order encrypted before execution (so
nothing leaks into a public mempool) and holds the encrypted map between your account and that
shielded address, so you can later *prove* a position was yours without publishing the link.

### What is actually private — Phase 1 (shielded execution)

| | Hidden | Public |
| --- | --- | --- |
| Who placed the trade | ✅ | |
| Your handle, profile, main wallet | ✅ | |
| Pre-trade intent (no mempool signal) | ✅ | |
| That the position exists, size, entry, leverage, liquidation price | | ❌ **forever** |
| From Inco's TEE operators | | ❌ |
| From chain analysis correlating amount + timing | | ❌ probabilistic only |

**This is not a dark pool and we do not call it one.** A trader who believes they are invisible
will size up — and on Avantis their exact liquidation price is readable by anyone, which is
precisely what a liquidation hunter looks for. Overclaiming here would make users *more*
exploitable, not less.

### Phase 2 — where it becomes genuinely private

The claim changes shape here, and so does the UI. It stops being hidden-vs-public and becomes
**conditional**: if your order matches, nothing about it ever reaches a public venue; if it
does not, it goes out inside one net position that is public but unattributable. A trader
cannot choose which happens, so promising "your trade is invisible" would be false on any day
the book is one-sided. `VITE_PHASE` gates which claim the UI is allowed to make, and it
**defaults to 1** — a misconfigured deploy must underclaim, never overclaim.


Orders batch into short epochs and are netted **on ciphertext**: `e.min` gives matched volume,
`e.add` gives the net, and no individual order is ever decrypted. Matched volume **crosses
internally and never reaches Avantis at all** — not obscured, absent. Only the residual is sent.
Revealing just the aggregate also lets the book publish "68% long" with every order still sealed.

Crossed legs are **bounded at ±100% of posted collateral**. Full collateralisation alone is not
enough: a long at 1x can lose at most its stake, but a short's loss is unbounded. Bounding both
sides makes a shortfall arithmetically impossible, which is what removes the need for a
liquidation engine. Lifting that cap needs a real margin engine and is out of scope here.

## Why this is a separate repo

This is a hackathon build that may not survive the weekend. Keeping it out of the Hence
codebase means that if it does not work out there is **no revert to perform** — no flag to
unwind, no dead code to find in six months. You stop a container and delete a repo.

### The boundary — three rules

Break any of these and the clean-teardown property is gone:

1. **No new tables in `hence_users`.** This service owns its own database.
2. **No new dependencies in the Hence `web/`.**
3. **No edits to `serve.py`.**

The *only* thing shared is **Privy identity** — the same app ID across domains gives the same
user here. This service verifies the Privy JWT itself. Patterns from the main app (JWKS verify,
the keeper loop, the team gate) are **copied, not imported**, on purpose.

## Layout

```
web/         standalone terminal — Avantis assets only, team-gated
keeper/      epoch batcher, ciphertext netting, Avantis relay
contracts/   HenceIncognito.sol — encrypted intent + attribution
```

TypeScript throughout, deliberately: Inco's SDK is JS-only, and Avantis has no official TS SDK
but is plain HTTP. A Python service would have split the stack for no gain.

## Getting started

```bash
cp .env.example .env      # every value starts empty = every feature off
npm install
npm run dev               # web
npm run keeper            # keeper, separate terminal
```

Start on **Base Sepolia** (`VITE_NETWORK=testnet`) with `DRY_RUN=1`.

## Before you build — three unresolved things

These are in the spec's open questions and any of them can cost you an hour on the day:

1. **Every Avantis address in `.env.example` is unverified.** They came from a research pass,
   not from reading the chain. Check on Basescan before a single transaction.
2. **`incognito.hence.markets` must be added to Privy's allowed origins**, or login fails.
3. **Shielded wallet provenance** — a second Privy embedded wallet, or a keypair this service
   manages? Confirm what Privy supports before building around either.


## Deploying the contract (Base Sepolia)

Everything is ready except gas. Two commands, then paste the address back.

**1 — make a deployer.** It needs gas and nothing else; no user funds ever touch it.

```bash
cast wallet new ~/.foundry/keystores      # prompts for a password, writes an ENCRYPTED keystore
```

It prints an address. Fund that at a **Base Sepolia** faucet, then:

**2 — deploy.**

```bash
cd contracts
forge script script/Deploy.s.sol:Deploy \
  --rpc-url https://sepolia.base.org \
  --account <keystore-name> --sender <address> \
  --broadcast -vvv
```

If you would rather not deal with a keystore, a raw key works too — it is a throwaway testnet
wallet holding only faucet ETH:

```bash
DEPLOYER_KEY=0x... forge script script/Deploy.s.sol:Deploy \
  --rpc-url https://sepolia.base.org --broadcast -vvv
```

The script checks the balance first and refuses with `deployer has no gas - fund it from a Base
Sepolia faucet`, rather than letting forge fail mid-broadcast with something that reads like a
node error.

**3 — wire it in.** The script prints the address; put it in `web/.env.local`:

```
VITE_INCOGNITO_CONTRACT=0x...
```

That is what turns the sealed book's `0 sealed` and `—` into real on-chain numbers, and what
`lib/order.ts` is waiting for before it will place anything.

**Roles are separate on purpose.** `KEEPER_ADDRESS` (defaults to the sender) may only close
epochs and publish aggregates — it can never move a user's collateral. A compromised keeper
stalls the book instead of draining it.

## Safety rails

`DRY_RUN=1` and `MAX_ORDER_USD` exist so the default posture is harmless. The omnibus key funds
shielded wallets and **is the anonymity set** — give it the test budget and nothing else.
