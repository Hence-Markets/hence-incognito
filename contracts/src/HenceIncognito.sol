// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {euint256, ebool, e, inco} from "@inco/lightning/src/Lib.sol";

/// @title HenceIncognito
/// @notice Encrypted order intake and epoch netting.
///
/// PHASE 1 — holds an encrypted order until the keeper executes it on Avantis from a shielded
/// address. Nothing about the order is public before execution.
///
/// PHASE 2 — nets an epoch ON CIPHERTEXT: `matched = min(sumLongs, sumShorts)` and
/// `net = |sumLongs - sumShorts|`, without ever decrypting an individual order. Matched volume
/// crosses internally and never reaches Avantis at all; only the residual is sent.
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
/// individual positions. `MIN_ORDERS_TO_REVEAL` enforces a floor — do not lower it to make a
/// demo look livelier.
contract HenceIncognito {
    using e for *;

    /// Below this many orders an epoch settles WITHOUT publishing its aggregate. The book is
    /// too small for the total to hide its parts, and the whole point is not leaking them.
    uint256 public constant MIN_ORDERS_TO_REVEAL = 5;

    enum Side { Long, Short }

    struct Order {
        address trader;      // the SHIELDED address, never the user's main wallet
        Side side;           // public: the side is not what we hide, the SIZE and the OWNER are
        euint256 size;       // encrypted notional
        uint64 epoch;
    }

    struct Epoch {
        uint64 id;
        uint64 closesAt;
        uint256 orderCount;
        bool netted;
        euint256 sumLongs;
        euint256 sumShorts;
        euint256 matched;    // min(sumLongs, sumShorts) — crosses internally, never sent out
        euint256 residual;   // |sumLongs - sumShorts| — the only part Avantis ever sees
        bool revealed;
    }

    address public immutable keeper;
    uint64 public immutable epochSeconds;
    uint64 public currentEpoch;

    mapping(uint64 => Epoch) public epochs;
    mapping(uint64 => Order[]) internal _orders;

    event OrderSubmitted(uint64 indexed epoch, address indexed trader, Side side);
    event EpochNetted(uint64 indexed epoch, uint256 orderCount);
    event AggregateRevealed(uint64 indexed epoch);

    error NotKeeper();
    error EpochStillOpen();
    error AlreadyNetted();
    error FeeTooLow();
    error UnauthorizedHandle();

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
    /// @dev Creating an encrypted input is the one operation Inco charges for; arithmetic and
    ///      comparison are free. The caller pays it so the keeper never fronts user costs.
    function submitOrder(bytes calldata encryptedSize, Side side) external payable {
        if (msg.value < inco.getFee()) revert FeeTooLow();

        _rollEpochIfDue();
        uint64 epId = currentEpoch;

        euint256 size = encryptedSize.newEuint256(msg.sender);
        // The contract must keep access to compute over this in the NETTING transaction,
        // which is a later block — transient allowance within this call is not enough.
        size.allowThis();
        // The trader keeps access to their own figure so the UI can show them their position.
        size.allow(msg.sender);

        _orders[epId].push(Order({trader: msg.sender, side: side, size: size, epoch: epId}));
        epochs[epId].orderCount += 1;

        emit OrderSubmitted(epId, msg.sender, side);
    }

    /// @notice Net an epoch on ciphertext. No individual order is decrypted, here or ever.
    function netEpoch(uint64 epId) external onlyKeeper {
        Epoch storage ep = epochs[epId];
        if (ep.netted) revert AlreadyNetted();
        if (block.timestamp < ep.closesAt) revert EpochStillOpen();

        euint256 longs = uint256(0).asEuint256();
        euint256 shorts = uint256(0).asEuint256();

        Order[] storage list = _orders[epId];
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

        ep.sumLongs = longs;
        ep.sumShorts = shorts;
        ep.matched = matched;
        ep.residual = residual;
        ep.netted = true;

        emit EpochNetted(epId, list.length);
    }

    /// @notice Publish the epoch aggregate — the "68% of the book is long" surface.
    /// @dev Reveals ONLY the totals. Individual orders are never revealed by any code path in
    ///      this contract, and `e.reveal` is irreversible, so this is the one place to be sure.
    ///      Gated on MIN_ORDERS_TO_REVEAL because a total over a tiny book gives up its parts.
    function revealAggregate(uint64 epId) external onlyKeeper {
        Epoch storage ep = epochs[epId];
        if (!ep.netted) revert EpochStillOpen();
        require(ep.orderCount >= MIN_ORDERS_TO_REVEAL, "book too small to publish safely");

        e.reveal(ep.sumLongs);
        e.reveal(ep.sumShorts);
        ep.revealed = true;

        emit AggregateRevealed(epId);
    }

    /// @notice A trader's own encrypted size, for their UI. Guarded per the docs' first rule:
    ///         without this check a caller could pass a handle they do not own but the contract
    ///         does have access to, and read someone else's order.
    function myOrderSize(uint64 epId, uint256 index) external view returns (euint256) {
        Order storage o = _orders[epId][index];
        if (!msg.sender.isAllowed(o.size)) revert UnauthorizedHandle();
        return o.size;
    }

    function orderCount(uint64 epId) external view returns (uint256) {
        return _orders[epId].length;
    }

    /// Targeted reads. The generated `epochs` getter returns the whole struct, which is
    /// unwieldy for callers that want one number — and juggling nine handles blows the stack.
    /// The keeper only ever needs the residual; the UI only needs the aggregates.
    function epochMatched(uint64 epId) external view returns (euint256) {
        return epochs[epId].matched;
    }

    function epochResidual(uint64 epId) external view returns (euint256) {
        return epochs[epId].residual;
    }

    function epochSums(uint64 epId) external view returns (euint256 longs, euint256 shorts) {
        return (epochs[epId].sumLongs, epochs[epId].sumShorts);
    }

    function _rollEpochIfDue() internal {
        if (block.timestamp >= epochs[currentEpoch].closesAt) {
            currentEpoch += 1;
            epochs[currentEpoch] = _newEpoch(currentEpoch);
        }
    }
}
