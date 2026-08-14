// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title HenceIncognito
/// @notice Encrypted trade intent + encrypted attribution, on Inco Lightning.
///
/// PHASE 1 — holds an encrypted order until the keeper executes it on Avantis from a shielded
/// address, and holds the encrypted handle -> shielded-address mapping so a user can later
/// PROVE a position was theirs without publishing the link.
///
/// PHASE 2 — adds epoch batching and ciphertext netting: `e.min(sum longs, sum shorts)` gives
/// matched volume and `e.add` gives the net, WITHOUT decrypting any individual order. Matched
/// volume crosses internally and never reaches Avantis at all. Only the residual is sent.
///
/// TWO FACTS THAT SHAPE THIS CONTRACT — both verified against docs.inco.org 2026-08-14:
///
///  1. A contract CANNOT decrypt on its own. There is no async callback. The flow is always
///     sign -> request -> network attests -> post the attestation on-chain. So reveal is
///     always driven from outside; this contract only ever marks a handle revealable.
///
///  2. `e.reveal()` makes a handle publicly decryptable by ANYONE. That is the property that
///     beats a plain hash commitment — the reveal stops depending on the person who submitted
///     it, so a losing participant cannot grief the book by staying silent. It also means the
///     keeper is a convenience, not a trusted party: if it disappears, anyone can finish.
///
/// PHASE 2 SAFETY — crossed legs are BOUNDED at +/-100% of posted collateral. Full
/// collateralisation alone is NOT enough: a long at 1x can lose at most its stake, but a
/// SHORT's loss is unbounded (asset triples, they owe 200%). Bounding both sides makes a
/// shortfall arithmetically impossible, which is what removes the need for a liquidation
/// engine entirely. Lifting the cap is Phase 3 and needs a real margin engine.
contract HenceIncognito {
    // TODO: import {e, euint256, ebool} from "@inco/lightning/src/Lib.sol";

    error NotKeeper();
    error EpochClosed();

    // TODO: submitOrder(bytes calldata ciphertext) — store the handle, emit for the keeper.
    //       Grant decrypt access with e.allow(handle, keeper) — nothing else may read it.

    // TODO: closeEpoch() — netting via e.min / e.add over the epoch's handles.

    // TODO: revealAggregate() — e.reveal() ONLY the epoch total, never an individual order.
    //       This is what makes "68% of the book is long" publishable without leaking anyone.
}
