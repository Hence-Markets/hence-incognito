# Hence Incognito

**An on-chain dark pool.** Your order is matched against other traders before any venue sees
it — and whatever matches never reaches one at all.

Built for the **Inco hackathon**, on Base Sepolia. Live at
**[incognito.hence.markets](https://incognito.hence.markets)**.

---

## The problem

On a perp DEX your position is public: size, entry, and your liquidation price. That is not a
flaw in one venue, it is how on-chain trading works — and on a leveraged position, a public
liquidation price is a target rather than a disclosure.

Institutions solved this decades ago with dark pools. Show a large order to a public market and
the market moves against you before you are filled, so instead you match with another trader
privately and the venue never learns the trade happened.

**That has been impossible on-chain, because every order is public by construction.**

## The insight

You cannot hide a trade that reaches a public venue. Avantis stores positions against a
plaintext address, permanently and queryably — no amount of encryption changes that once the
order arrives.

So don't send it.

Orders are matched **against each other, inside our contract, while still encrypted**. Only the
leftover imbalance ever leaves. Matched volume is not obscured on a venue — it is *absent* from
one, because it never went.

## How Inco makes it work

Inco Lightning lets a contract compute on encrypted data. `HenceIncognito.sol` stores each
order's size as a `euint256` and nets an entire epoch on ciphertext:

```solidity
matched  = longs.min(shorts);            // crosses internally — never sent out
residual = longs.max(shorts).sub(matched); // the only part a venue could see
```

**No individual order is decrypted, here or ever.** Not by the contract, not by the keeper, not
by us. After netting, only two aggregate totals are published, and only when the book is large
enough that a total cannot be solved back into its parts.

Three facts about Inco shaped the whole design:

1. **A contract cannot decrypt on its own** — `e.reveal()` only marks a handle publicly
   decryptable; someone off-chain still fetches the attestation. That is *why* a keeper exists,
   and also why the keeper is not trusted: once revealed, **anyone** can complete the step. The
   browser does exactly that rather than asking our server what happened.
2. **Encrypted conditions cannot drive `if`/`revert`** — the execution path itself would leak.
   Everything conditional uses the `select` multiplexer.
3. **Access is irreversible.** Privacy rests on this contract's logic never revealing an
   individual order — auditable, since the code is public and immutable, but a weaker claim than
   "mathematically impossible", and we say so.

## What is actually private

Being precise here matters more than sounding good.

| | Status |
|---|---|
| **Order size** | 🔒 Encrypted in your browser, netted on ciphertext, never decrypted |
| **Who you are** | 🔒 Orders execute from a shielded wallet, gas-funded from a shared omnibus so the funding transfer links nothing |
| **Matched volume** | 🔒 Absent from any public venue — it never went |
| Side (long/short) | 👁 Public |
| Market (BTC/ETH/SOL) | 👁 Public |
| Shielded address | 👁 Public — it is just not *you* |
| Aggregate totals, after netting | 👁 Published deliberately, above a minimum book size |

Side and market are public **on purpose**: the keeper has to know which market to route a
residual to, and hiding them would mean netting across an encrypted selector — far more
machinery than the privacy gain justifies. What is hidden is the **size** and the **owner**.

Not private from Inco's operators, or from anyone analysing the chain.

---

## Architecture

```
   browser                     chain (Base)                   off-chain
   ───────                     ────────────                   ─────────
   web app  ──encrypt──▶  HenceIncognito.sol
   (fork of Hence)         · submitOrder                    keeper (Node)
        │                  · netEpoch      ◀──────────────── · closes epochs
        │                  · revealAggregate                 · attested decrypt
        │                                                    · routes the residual
        └──reads + attestedReveal──▶ epochs / books                 │
                                                                    ▼
                                                             Avantis (Base mainnet)
```

| | |
|---|---|
| `contracts/` | `HenceIncognito.sol` — per-market epoch netting on ciphertext · 12 Foundry tests |
| `keeper/` | Nets closed epochs, publishes aggregates, decrypts **only** the residual |
| `web/` | A fork of the real Hence app — same terminal, tinted, with the order path rerouted |

### The contract

```
0x431777cC5168cFe6D56B33D344E144699603FAe1   Base Sepolia (84532), block 45481692
epochSeconds 120 · MIN_ORDERS_TO_REVEAL 5 · MAX_MARKETS_PER_EPOCH 8
```

- **`submitOrder(bytes encryptedSize, Side side, uint16 pair, bool routeResidual)`** — anyone.
  Costs one Inco input fee.
- **`netEpoch(uint64)`** — keeper only. Nets **each market separately**. An earlier version
  summed a whole epoch into one book, which crossed a BTC long against a SOL short and called it
  matched; that is not a hedge, it is a coincidence.
- **`revealAggregate(uint64)`** — keeper only. Publishes each market's two totals, skipping any
  book under `MIN_ORDERS_TO_REVEAL` — a total over a tiny book gives up its parts.

`MAX_MARKETS_PER_EPOCH` bounds the netting loop. Without it, one order in each of thousands of
pair indices makes `netEpoch` exceed the block gas limit and bricks that epoch for everyone in
it.

### Why three markets

BTC, ETH and SOL, using Avantis' own pair indices. `matched = min(longs, shorts)` collapses to
zero when a small book spreads across a hundred symbols — every market ends up with one order
and nothing to cross. Concentration is what makes the number non-zero, which is also why equity
dark pools live in the most-traded names and never the long tail.

### The keeper is a convenience, not a dependency

It can call `netEpoch` and `revealAggregate`, and attested-decrypt the residual. That is all. It
cannot move collateral, read an individual order, or cancel one. A compromised keeper stalls the
book; it cannot drain it or deanonymise anyone.

`matched` is never revealed on chain — it is derived from the two published sums, so **anyone
can recompute the crossed volume and the residual from public data and check the keeper's
arithmetic.** The keeper checks itself the same way and refuses to act on a residual its own
decrypt and the public sums disagree about.

---

## What is real, and what is not

This is a **testnet demo**. Being exact about the boundary:

| | |
|---|---|
| Order encryption, submission, netting, reveal | ✅ **Real**, on Base Sepolia |
| Per-market books, crossed/residual arithmetic | ✅ **Real** — verifiable on chain |
| Market list | ✅ **Real** — Avantis' own `/v2/pairs` |
| Prices | Reference feed, not Avantis' oracle (which is mainnet-only) |
| The residual reaching Avantis | ❌ **Cannot happen on Sepolia** |
| Money | ❌ None. An order is an encrypted *intent*; nothing is escrowed |

**There is no Avantis testnet.** `tx-builder-testnet.avantisfi.com/v2/meta` returns `chainId
8453` with the same addresses as mainnet. So on Sepolia the unmatched remainder goes **unfilled**
— which is ordinary crossing-network behaviour, not a missing feature: no counterparty, no fill,
retry next epoch. Nothing was escrowed, so nothing is returned. Traders can opt to route it out
instead; that path is the mainnet one.

A verified run, on chain: **9 orders, $40,100 long vs $27,500 short → $27,500 crossed, $12,600
residual.** 81% of the book never reached a venue.

---

## Running it

```bash
npm install                      # root: Foundry remappings resolve into ../node_modules
cd contracts && forge test       # 12 tests
cd ../keeper  && npm install && npm start
cd ../web     && npm install && npm run dev
```

`web/` and `contracts/` install **separately** — npm workspaces hoisting split `@types/react`
18/19 and broke the fork.

Copy `.env.example` and fill in: `INCOGNITO_CONTRACT`, `OMNIBUS_KEY` (keeper), and
`VITE_INCOGNITO_CONTRACT`, `VITE_PRIVY_APP_ID` (web). Vite **inlines** `VITE_*` at build time —
setting them at runtime does nothing, silently, and the epoch panel falls back to a local clock
while still looking alive.

### Seeding a book

```bash
cd keeper && npm run seed        # 5 long / 4 short into one market, one epoch
```

Real orders from real wallets, keys discarded. The only thing to disclose is their **origin**:
one operator controls them all. Pre-seeded is not the same as simulated, and that distinction
only survives scrutiny if you volunteer it.

`keeper/src/filler.ts` does the same on a schedule to keep epochs populated for visitors. Off by
default, and it refuses to run on mainnet.

---

## Deployment

Two containers on the existing `hence-neo` stack, behind its Cloudflare tunnel — see
`deploy/README.md`. It joins that stack rather than standing alone because the web app is a fork
of Hence and inherits its whole market layer; nginx reaches `app:4317` by service name for
prices and news.

The deploy workflow lives in the **private** `neo-hence` repo, deliberately: a self-hosted runner
attached to a public repository executes code from any pull request.

---

## Honest limits

1. **Not a privacy guarantee against Inco's operators**, or against chain analysis.
2. **Netting needs counterparties.** With a thin book, `matched` is small and most of an order
   goes unfilled. No engineering fixes that — it is why the design targets concentrated flow.
3. **Unaudited prototype.** It may lose orders, mis-net a book, or stop working.
4. **Phase 2 (real money) needs counsel** — custody plus operating a matching venue. Phase 3
   (leverage) needs a margin and liquidation engine that does not exist.

## Built for the Inco hackathon

By [Hence](https://hence.markets). The Hence terminal predates the jam; the Inco Lightning
dark-pool pilot — contract, keeper, shielded wallets, and the reworked order path — was built
during it.

Companion repo: [megapot-fee-accrual](https://github.com/Hence-Markets/megapot-fee-accrual).
