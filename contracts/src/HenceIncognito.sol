// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {euint256, ebool, e, inco} from "@inco/lightning/src/Lib.sol";

/// @title HenceIncognito
/// @notice Encrypted order intake and per-market epoch netting.
///
/// PHASE 1 — holds an encrypted order until the keeper executes it on Avantis from a shielded
/// address. Nothing about the order is public before execution.
///
/// PHASE 2 — nets an epoch ON CIPHERTEXT: `matched = min(sumLongs, sumShorts)` and
/// `residual = max - min`, without ever decrypting an individual order. Matched volume crosses
/// internally and never reaches Avantis at all; only the residual is ever sent.
///
/// NETTING IS PER MARKET, and that is not a detail. v1 summed every order in an epoch into one
/// book, which crossed a BTC long against a SOL short and called it matched. That is not a hedge,
/// it is a coincidence — and it left the keeper with a residual it could not act on, because
/// nothing on chain said which market to send it to. Orders therefore carry a plaintext `pair`.
///
/// WHY `pair` IS PUBLIC: `side` already is. What this contract hides is the SIZE and the OWNER.
/// Hiding the market as well would mean netting across an encrypted selector, which is far more
/// machinery than the privacy gain justifies — and the keeper must learn the market eventually
/// anyway, or it cannot route the residual anywhere.
///
/// THREE FACTS FROM THE DOCS THAT SHAPE THIS CONTRACT (verified 2026-08-14):
///
///  1. A contract CANNOT decrypt on its own — there is no async callback. `e.reveal()` only
///     marks a handle publicly decryptable; someone off-chain still fetches the attestation.
///     That is a feature here: after reveal, ANYONE can complete it, so a losing participant
///     cannot grief the book by going quiet, and the keeper is a convenience not a dependency.
///
///  2. Encrypted conditions cannot drive `if`/`revert` — the execution path itself would leak.
///     Every conditional below uses the `select` multiplexer.
///
///  3. Access is irreversible and, once granted, the recipient may share it or publicly
///     decrypt. So privacy here rests on THIS CONTRACT'S LOGIC never revealing an individual
///     order — auditable, since the code is public and immutable, but a weaker claim than
///     "mathematically impossible". Say that plainly in the T&C rather than implying otherwise.
///
/// LEAKAGE, THE REAL LIMIT: revealing an aggregate over a SMALL book leaks its parts. With a
/// handful of orders, publishing the net and the matched volume is often solvable back to
/// individual positions. `MIN_ORDERS_TO_REVEAL` enforces a floor, applied PER MARKET — an epoch
/// with fifty orders spread over five markets has five small books, not one large one. Do not
/// lower it to make a demo look livelier.
contract HenceIncognito {
    using e for *;

    /// Below this many orders IN A SINGLE MARKET, that market settles without publishing its
    /// aggregate. The book is too small for the total to hide its parts.
    uint256 public constant MIN_ORDERS_TO_REVEAL = 5;

    /// Ceiling on distinct markets in one epoch. Netting loops over every market touched, so
    /// without this an attacker submits one order in each of thousands of pair indices and
    /// `netEpoch` can no longer fit in a block — the epoch is bricked, permanently, for everyone
    /// in it. Orders in markets already open this epoch are always accepted; only a NEW market
    /// past the ceiling is refused.
    uint16 public constant MAX_MARKETS_PER_EPOCH = 8;

    enum Side { Long, Short }

    struct Order {
        address trader;        // the SHIELDED address, never the user's main wallet
        Side side;             // public: the side is not what we hide, the SIZE and OWNER are
        uint16 pair;           // Avantis pair index — public, for the same reason side is
        bool routeResidual;    // if unmatched: route to Avantis (true) or return unfilled (false)
        euint256 size;         // encrypted notional
    }

    /// One market's book within one epoch. The netting unit.
    struct Book {
        uint256 orderCount;
        bool netted;
        bool revealed;
        euint256 sumLongs;
        euint256 sumShorts;
        euint256 matched;      // min(longs, shorts) — crosses internally, never sent out
        euint256 residual;     // max - min — the only part Avantis could ever see
    }

    struct Epoch {
        uint64 id;
        uint64 closesAt;
        uint256 orderCount;    // across every market
        bool netted;
    }

    address public immutable keeper;
    uint64 public immutable epochSeconds;
    uint64 public currentEpoch;

    mapping(uint64 => Epoch) public epochs;
    mapping(uint64 => mapping(uint16 => Book)) internal _books;
    mapping(uint64 => mapping(uint16 => Order[])) internal _orders;
    /// Markets touched in an epoch, so netting knows what to loop over without scanning 2^16.
    mapping(uint64 => uint16[]) internal _markets;
    mapping(uint64 => mapping(uint16 => bool)) internal _marketSeen;

    event OrderSubmitted(
        uint64 indexed epoch, address indexed trader, uint16 indexed pair, Side side, bool routeResidual
    );
    event BookNetted(uint64 indexed epoch, uint16 indexed pair, uint256 orderCount);
    event EpochNetted(uint64 indexed epoch, uint256 marketCount, uint256 orderCount);
    event AggregateRevealed(uint64 indexed epoch, uint16 indexed pair);

    error NotKeeper();
    error EpochStillOpen();
    error AlreadyNetted();
    error FeeTooLow();
    error UnauthorizedHandle();
    error TooManyMarkets();

    modifier onlyKeeper() {
        if (msg.sender != keeper) revert NotKeeper();
        _;
    }

    constructor(address _keeper, uint64 _epochSeconds) {
        keeper = _keeper;
        epochSeconds = _epochSeconds;
        currentEpoch = 1;
        epochs[1] = _newEpoch(1);
    }

    function _newEpoch(uint64 id) internal view returns (Epoch memory ep) {
        ep.id = id;
        ep.closesAt = uint64(block.timestamp) + epochSeconds;
    }

    /// @notice Submit an encrypted order into the open epoch.
    /// @param encryptedSize ciphertext produced client-side by `zap.encrypt(...)`
    /// @param side long or short — public
    /// @param pair Avantis pair index (ETH 0, BTC 1, SOL 2) — public
    /// @param routeResidual what to do with the part that finds no counterparty: route it to
    ///        Avantis, or return it unfilled. Recorded here, honoured by the keeper. An order
    ///        that goes unfilled is ordinary crossing-network behaviour, not a failure.
    /// @dev Creating an encrypted input is the one operation Inco charges for; arithmetic and
    ///      comparison are free. The caller pays it so the keeper never fronts user costs.
    function submitOrder(bytes calldata encryptedSize, Side side, uint16 pair, bool routeResidual)
        external
        payable
    {
        if (msg.value < inco.getFee()) revert FeeTooLow();

        _rollEpochIfDue();
        uint64 epId = currentEpoch;

        if (!_marketSeen[epId][pair]) {
            if (_markets[epId].length >= MAX_MARKETS_PER_EPOCH) revert TooManyMarkets();
            _marketSeen[epId][pair] = true;
            _markets[epId].push(pair);
        }

        euint256 size = encryptedSize.newEuint256(msg.sender);
        // The contract must keep access to compute over this in the NETTING transaction,
        // which is a later block — transient allowance within this call is not enough.
        size.allowThis();
        // The trader keeps access to their own figure so the UI can show them their position.
        size.allow(msg.sender);

        _orders[epId][pair].push(
            Order({trader: msg.sender, side: side, pair: pair, routeResidual: routeResidual, size: size})
        );
        _books[epId][pair].orderCount += 1;
        epochs[epId].orderCount += 1;

        emit OrderSubmitted(epId, msg.sender, pair, side, routeResidual);
    }

    /// @notice Net every market in an epoch, on ciphertext. No individual order is decrypted,
    ///         here or ever.
    function netEpoch(uint64 epId) external onlyKeeper {
        Epoch storage ep = epochs[epId];
        if (ep.netted) revert AlreadyNetted();
        if (block.timestamp < ep.closesAt) revert EpochStillOpen();

        uint16[] storage mkts = _markets[epId];
        for (uint256 m = 0; m < mkts.length; m++) {
            _netBook(epId, mkts[m]);
        }

        ep.netted = true;
        emit EpochNetted(epId, mkts.length, ep.orderCount);
    }

    function _netBook(uint64 epId, uint16 pair) internal {
        Book storage bk = _books[epId][pair];

        euint256 longs = uint256(0).asEuint256();
        euint256 shorts = uint256(0).asEuint256();

        Order[] storage list = _orders[epId][pair];
        for (uint256 i = 0; i < list.length; i++) {
            // `side` is plaintext, so this branch leaks nothing an observer cannot already see.
            if (list[i].side == Side.Long) longs = longs.add(list[i].size);
            else shorts = shorts.add(list[i].size);
        }

        // matched = min(longs, shorts). THIS is the volume that never reaches a public venue.
        euint256 matched = longs.min(shorts);
        // residual = |longs - shorts|.
        //
        // NOT `select(cond, shorts.sub(longs), longs.sub(shorts))`. A select is a multiplexer:
        // BOTH arms are evaluated, so whichever side is smaller underflows. Under test that
        // panics; in production unsigned encrypted arithmetic would wrap instead and hand the
        // keeper a colossal residual to send to Avantis. Subtracting min from max is a single
        // operation that cannot underflow by construction.
        euint256 residual = longs.max(shorts).sub(matched);

        matched.allowThis();
        residual.allowThis();
        longs.allowThis();
        shorts.allowThis();
        // The keeper must decrypt the residual to size the Avantis order — and ONLY that.
        residual.allow(keeper);

        bk.sumLongs = longs;
        bk.sumShorts = shorts;
        bk.matched = matched;
        bk.residual = residual;
        bk.netted = true;

        emit BookNetted(epId, pair, list.length);
    }

    /// @notice Publish each market's aggregate — the "68% of the book is long" surface.
    /// @dev Reveals ONLY totals. Individual orders are never revealed by any code path in this
    ///      contract, and `e.reveal` is irreversible, so this is the one place to be sure.
    ///      Markets below MIN_ORDERS_TO_REVEAL are SKIPPED rather than reverting the call: one
    ///      thin book must not block publication for the markets that did trade properly.
    function revealAggregate(uint64 epId) external onlyKeeper {
        Epoch storage ep = epochs[epId];
        if (!ep.netted) revert EpochStillOpen();

        uint16[] storage mkts = _markets[epId];
        for (uint256 m = 0; m < mkts.length; m++) {
            uint16 pair = mkts[m];
            Book storage bk = _books[epId][pair];
            if (bk.revealed) continue;
            if (bk.orderCount < MIN_ORDERS_TO_REVEAL) continue;

            e.reveal(bk.sumLongs);
            e.reveal(bk.sumShorts);
            bk.revealed = true;

            emit AggregateRevealed(epId, pair);
        }
    }

    /// @notice A trader's own encrypted size, for their UI. Guarded per the docs' first rule:
    ///         without this check a caller could pass a handle they do not own but the contract
    ///         does have access to, and read someone else's order.
    function myOrderSize(uint64 epId, uint16 pair, uint256 index) external view returns (euint256) {
        Order storage o = _orders[epId][pair][index];
        if (!msg.sender.isAllowed(o.size)) revert UnauthorizedHandle();
        return o.size;
    }

    /// Markets touched in an epoch — what a UI iterates to show the whole board.
    function marketsInEpoch(uint64 epId) external view returns (uint16[] memory) {
        return _markets[epId];
    }

    function orderCount(uint64 epId) external view returns (uint256) {
        return epochs[epId].orderCount;
    }

    function orderCountIn(uint64 epId, uint16 pair) external view returns (uint256) {
        return _orders[epId][pair].length;
    }

    /// Plaintext book state in one read, so a UI does not need four calls per market.
    function bookStatus(uint64 epId, uint16 pair)
        external
        view
        returns (uint256 count, bool netted, bool revealed)
    {
        Book storage bk = _books[epId][pair];
        return (bk.orderCount, bk.netted, bk.revealed);
    }

    /// Targeted handle reads. The generated getter would return the whole struct, which is
    /// unwieldy for callers that want one number — and juggling seven handles blows the stack.
    /// The keeper only ever needs the residual; the UI only needs the aggregates.
    function bookMatched(uint64 epId, uint16 pair) external view returns (euint256) {
        return _books[epId][pair].matched;
    }

    function bookResidual(uint64 epId, uint16 pair) external view returns (euint256) {
        return _books[epId][pair].residual;
    }

    function bookSums(uint64 epId, uint16 pair) external view returns (euint256 longs, euint256 shorts) {
        Book storage bk = _books[epId][pair];
        return (bk.sumLongs, bk.sumShorts);
    }

    function _rollEpochIfDue() internal {
        if (block.timestamp >= epochs[currentEpoch].closesAt) {
            currentEpoch += 1;
            epochs[currentEpoch] = _newEpoch(currentEpoch);
        }
    }
}
