// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IncoTest} from "@inco/lightning/src/test/IncoTest.sol";
import {euint256, e, inco} from "@inco/lightning/src/Lib.sol";
import {HenceIncognito} from "../src/HenceIncognito.sol";

/// The claim this whole project rests on: orders can be netted WITHOUT decrypting any of them,
/// and only the aggregate is ever revealed. If these tests fail, the product does not exist.
contract NettingTest is IncoTest {
    HenceIncognito internal inc;
    address internal keeper;

    uint64 internal constant EPOCH = 300;

    function setUp() public override {
        super.setUp();
        keeper = makeAddr("keeper");
        inc = new HenceIncognito(keeper, EPOCH);
    }

    function _submit(address who, uint256 size, HenceIncognito.Side side) internal {
        bytes memory ct = fakePrepareEuint256Ciphertext(size, who, address(inc));
        // Read the fee BEFORE pranking. `vm.prank` applies to the very next external call, and
        // `inco.getFee()` written inline in `{value: ...}` IS an external call — it silently
        // eats the prank, the order arrives as the test contract rather than `who`, and the
        // ciphertext (which is bound to `who`) then fails handle validation with
        // ExternalHandleDoesNotMatchComputedHandle. Cost an hour; do not inline it.
        uint256 fee = inco.getFee();
        vm.deal(who, fee);             // the PRANKED address pays the value, so fund `who`
        vm.prank(who);
        inc.submitOrder{value: fee}(ct, side);
    }

    /// The core mechanic. $10k long against $8k short should cross $8k internally and send
    /// only $2k onward — with every individual order still encrypted throughout.
    function test_crossing_matches_the_smaller_side() public {
        _submit(alice, 10_000, HenceIncognito.Side.Long);
        _submit(bob, 8_000, HenceIncognito.Side.Short);
        processAllOperations();

        vm.warp(block.timestamp + EPOCH + 1);
        vm.prank(keeper);
        inc.netEpoch(1);
        processAllOperations();

        (euint256 sumLongs, euint256 sumShorts) = inc.epochSums(1);
        assertEq(getUint256Value(sumLongs), 10_000, "longs");
        assertEq(getUint256Value(sumShorts), 8_000, "shorts");
        euint256 matched = inc.epochMatched(1);
        euint256 residual = inc.epochResidual(1);
        // $8k never reaches a public venue — this number IS the product
        assertEq(getUint256Value(matched), 8_000, "matched should be min(longs, shorts)");
        // only the difference is ever sent out
        assertEq(getUint256Value(residual), 2_000, "residual should be the imbalance");
    }

    /// The symmetric case — shorts heavier than longs. `select` has no branch, so a bug here
    /// would produce an underflow rather than a wrong-but-plausible number.
    function test_crossing_when_shorts_are_heavier() public {
        _submit(alice, 3_000, HenceIncognito.Side.Long);
        _submit(bob, 11_500, HenceIncognito.Side.Short);
        processAllOperations();

        vm.warp(block.timestamp + EPOCH + 1);
        vm.prank(keeper);
        inc.netEpoch(1);
        processAllOperations();

        euint256 matched = inc.epochMatched(1);
        euint256 residual = inc.epochResidual(1);
        assertEq(getUint256Value(matched), 3_000, "matched");
        assertEq(getUint256Value(residual), 8_500, "residual");
    }

    /// A perfectly balanced epoch is the best case: EVERYTHING crosses, nothing goes on-chain.
    function test_a_balanced_book_sends_nothing_to_the_venue() public {
        _submit(alice, 5_000, HenceIncognito.Side.Long);
        _submit(bob, 5_000, HenceIncognito.Side.Short);
        processAllOperations();

        vm.warp(block.timestamp + EPOCH + 1);
        vm.prank(keeper);
        inc.netEpoch(1);
        processAllOperations();

        euint256 matched = inc.epochMatched(1);
        euint256 residual = inc.epochResidual(1);
        assertEq(getUint256Value(matched), 5_000, "all of it should cross");
        assertEq(getUint256Value(residual), 0, "nothing should reach Avantis");
    }

    /// Many orders per side must aggregate before matching, not match pairwise.
    function test_many_orders_aggregate_before_matching() public {
        _submit(alice, 1_000, HenceIncognito.Side.Long);
        _submit(bob, 2_500, HenceIncognito.Side.Long);
        _submit(carol, 4_000, HenceIncognito.Side.Short);
        processAllOperations();

        vm.warp(block.timestamp + EPOCH + 1);
        vm.prank(keeper);
        inc.netEpoch(1);
        processAllOperations();

        (euint256 longs, ) = inc.epochSums(1);
        euint256 matched = inc.epochMatched(1);
        euint256 residual = inc.epochResidual(1);
        assertEq(getUint256Value(longs), 3_500, "longs should sum");
        assertEq(getUint256Value(matched), 3_500, "the whole long side crosses");
        assertEq(getUint256Value(residual), 500, "short overhang goes out");
    }

    /// The leakage guard. A total over a tiny book gives up its parts, so publishing is
    /// refused below the floor — this is a deliberate product constraint, not an oversight.
    function test_aggregate_is_not_published_over_a_tiny_book() public {
        _submit(alice, 1_000, HenceIncognito.Side.Long);
        _submit(bob, 1_000, HenceIncognito.Side.Short);
        processAllOperations();

        vm.warp(block.timestamp + EPOCH + 1);
        vm.prank(keeper);
        inc.netEpoch(1);
        processAllOperations();

        vm.prank(keeper);
        vm.expectRevert(bytes("book too small to publish safely"));
        inc.revealAggregate(1);
    }

    /// Netting is keeper-only: anyone could otherwise close an epoch early and reshape the book.
    function test_only_the_keeper_can_net() public {
        _submit(alice, 1_000, HenceIncognito.Side.Long);
        processAllOperations();
        vm.warp(block.timestamp + EPOCH + 1);

        vm.prank(alice);
        vm.expectRevert(HenceIncognito.NotKeeper.selector);
        inc.netEpoch(1);
    }

    /// An epoch cannot be netted while traders can still submit into it.
    function test_cannot_net_an_open_epoch() public {
        _submit(alice, 1_000, HenceIncognito.Side.Long);
        processAllOperations();

        vm.prank(keeper);
        vm.expectRevert(HenceIncognito.EpochStillOpen.selector);
        inc.netEpoch(1);
    }

}
