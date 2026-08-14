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

    // Avantis' own pair indices, so the number on chain means something to the keeper.
    uint16 internal constant ETH_PAIR = 0;
    uint16 internal constant BTC_PAIR = 1;
    uint16 internal constant SOL_PAIR = 2;

    function setUp() public override {
        super.setUp();
        keeper = makeAddr("keeper");
        inc = new HenceIncognito(keeper, EPOCH);
    }

    function _submit(address who, uint256 size, HenceIncognito.Side side, uint16 pair, bool route)
        internal
    {
        bytes memory ct = fakePrepareEuint256Ciphertext(size, who, address(inc));
        // Read the fee BEFORE pranking. `vm.prank` applies to the very next external call, and
        // `inco.getFee()` written inline in `{value: ...}` IS an external call — it silently
        // eats the prank, the order arrives as the test contract rather than `who`, and the
        // ciphertext (which is bound to `who`) then fails handle validation with
        // ExternalHandleDoesNotMatchComputedHandle. Cost an hour; do not inline it.
        uint256 fee = inco.getFee();
        vm.deal(who, fee);             // the PRANKED address pays the value, so fund `who`
        vm.prank(who);
        inc.submitOrder{value: fee}(ct, side, pair, route);
    }

    /// Most tests only care about one market; default to BTC and return-unfilled.
    function _submit(address who, uint256 size, HenceIncognito.Side side) internal {
        _submit(who, size, side, BTC_PAIR, false);
    }

    function _net(uint64 epId) internal {
        vm.warp(block.timestamp + EPOCH + 1);
        vm.prank(keeper);
        inc.netEpoch(epId);
        processAllOperations();
    }

    /// The core mechanic. $10k long against $8k short should cross $8k internally and send
    /// only $2k onward — with every individual order still encrypted throughout.
    function test_crossing_matches_the_smaller_side() public {
        _submit(alice, 10_000, HenceIncognito.Side.Long);
        _submit(bob, 8_000, HenceIncognito.Side.Short);
        processAllOperations();
        _net(1);

        (euint256 sumLongs, euint256 sumShorts) = inc.bookSums(1, BTC_PAIR);
        assertEq(getUint256Value(sumLongs), 10_000, "longs");
        assertEq(getUint256Value(sumShorts), 8_000, "shorts");
        // $8k never reaches a public venue — this number IS the product
        assertEq(getUint256Value(inc.bookMatched(1, BTC_PAIR)), 8_000, "matched should be min(longs, shorts)");
        // only the difference is ever sent out
        assertEq(getUint256Value(inc.bookResidual(1, BTC_PAIR)), 2_000, "residual should be the imbalance");
    }

    /// The symmetric case — shorts heavier than longs. `select` has no branch, so a bug here
    /// would produce an underflow rather than a wrong-but-plausible number.
    function test_crossing_when_shorts_are_heavier() public {
        _submit(alice, 3_000, HenceIncognito.Side.Long);
        _submit(bob, 11_500, HenceIncognito.Side.Short);
        processAllOperations();
        _net(1);

        assertEq(getUint256Value(inc.bookMatched(1, BTC_PAIR)), 3_000, "matched");
        assertEq(getUint256Value(inc.bookResidual(1, BTC_PAIR)), 8_500, "residual");
    }

    /// A perfectly balanced epoch is the best case: EVERYTHING crosses, nothing goes on-chain.
    function test_a_balanced_book_sends_nothing_to_the_venue() public {
        _submit(alice, 5_000, HenceIncognito.Side.Long);
        _submit(bob, 5_000, HenceIncognito.Side.Short);
        processAllOperations();
        _net(1);

        assertEq(getUint256Value(inc.bookMatched(1, BTC_PAIR)), 5_000, "all of it should cross");
        assertEq(getUint256Value(inc.bookResidual(1, BTC_PAIR)), 0, "nothing should reach Avantis");
    }

    /// Many orders per side must aggregate before matching, not match pairwise.
    function test_many_orders_aggregate_before_matching() public {
        _submit(alice, 1_000, HenceIncognito.Side.Long);
        _submit(bob, 2_500, HenceIncognito.Side.Long);
        _submit(carol, 4_000, HenceIncognito.Side.Short);
        processAllOperations();
        _net(1);

        (euint256 longs, ) = inc.bookSums(1, BTC_PAIR);
        assertEq(getUint256Value(longs), 3_500, "longs should sum");
        assertEq(getUint256Value(inc.bookMatched(1, BTC_PAIR)), 3_500, "the whole long side crosses");
        assertEq(getUint256Value(inc.bookResidual(1, BTC_PAIR)), 500, "short overhang goes out");
    }

    /// THE BUG THIS CONTRACT VERSION EXISTS TO FIX. A BTC long and a SOL short are not a hedge.
    /// v1 summed every order in the epoch into one book and reported them as crossed; each must
    /// instead stand alone as a full residual in its own market.
    function test_different_markets_do_not_cross() public {
        _submit(alice, 9_000, HenceIncognito.Side.Long, BTC_PAIR, false);
        _submit(bob, 9_000, HenceIncognito.Side.Short, SOL_PAIR, false);
        processAllOperations();
        _net(1);

        assertEq(getUint256Value(inc.bookMatched(1, BTC_PAIR)), 0, "BTC has no short side");
        assertEq(getUint256Value(inc.bookResidual(1, BTC_PAIR)), 9_000, "all of BTC is residual");
        assertEq(getUint256Value(inc.bookMatched(1, SOL_PAIR)), 0, "SOL has no long side");
        assertEq(getUint256Value(inc.bookResidual(1, SOL_PAIR)), 9_000, "all of SOL is residual");
    }

    /// Markets net independently in the same epoch: one can cross fully while another does not.
    function test_markets_net_independently() public {
        _submit(alice, 4_000, HenceIncognito.Side.Long, ETH_PAIR, false);
        _submit(bob, 4_000, HenceIncognito.Side.Short, ETH_PAIR, false);
        _submit(carol, 7_000, HenceIncognito.Side.Long, BTC_PAIR, false);
        processAllOperations();
        _net(1);

        assertEq(getUint256Value(inc.bookMatched(1, ETH_PAIR)), 4_000, "ETH crosses entirely");
        assertEq(getUint256Value(inc.bookResidual(1, ETH_PAIR)), 0, "ETH sends nothing out");
        assertEq(getUint256Value(inc.bookMatched(1, BTC_PAIR)), 0, "BTC found no counterparty");
        assertEq(getUint256Value(inc.bookResidual(1, BTC_PAIR)), 7_000, "BTC is entirely unfilled");

        uint16[] memory mkts = inc.marketsInEpoch(1);
        assertEq(mkts.length, 2, "two markets touched");
    }

    /// The leakage guard. A total over a tiny book gives up its parts, so that market is skipped
    /// — but skipping must not block a market that DID trade enough to publish safely.
    function test_a_thin_market_is_skipped_without_blocking_a_healthy_one() public {
        // BTC: five orders, enough to publish.
        _submit(makeAddr("t1"), 1_000, HenceIncognito.Side.Long, BTC_PAIR, false);
        _submit(makeAddr("t2"), 1_000, HenceIncognito.Side.Long, BTC_PAIR, false);
        _submit(makeAddr("t3"), 1_000, HenceIncognito.Side.Long, BTC_PAIR, false);
        _submit(makeAddr("t4"), 1_000, HenceIncognito.Side.Short, BTC_PAIR, false);
        _submit(makeAddr("t5"), 1_000, HenceIncognito.Side.Short, BTC_PAIR, false);
        // SOL: one order. Publishing this total would be publishing that order.
        _submit(makeAddr("t6"), 4_242, HenceIncognito.Side.Long, SOL_PAIR, false);
        processAllOperations();
        _net(1);

        vm.prank(keeper);
        inc.revealAggregate(1);

        (, , bool btcRevealed) = inc.bookStatus(1, BTC_PAIR);
        (, , bool solRevealed) = inc.bookStatus(1, SOL_PAIR);
        assertTrue(btcRevealed, "BTC had enough orders to publish");
        assertFalse(solRevealed, "a one-order book must never be published");
    }

    /// Netting loops over every market touched, so an attacker who can open unlimited markets
    /// can make that loop exceed the block gas limit and brick the epoch for everyone in it.
    function test_an_epoch_cannot_be_flooded_with_markets() public {
        for (uint16 p = 0; p < 8; p++) {
            _submit(makeAddr(string(abi.encodePacked("m", p))), 1_000, HenceIncognito.Side.Long, p, false);
        }
        processAllOperations();

        address flooder = makeAddr("flooder");
        bytes memory ct = fakePrepareEuint256Ciphertext(1_000, flooder, address(inc));
        uint256 fee = inco.getFee();
        vm.deal(flooder, fee);
        vm.prank(flooder);
        vm.expectRevert(HenceIncognito.TooManyMarkets.selector);
        inc.submitOrder{value: fee}(ct, HenceIncognito.Side.Long, 99, false);
    }

    /// A market already open this epoch keeps accepting orders even at the ceiling — the cap
    /// bounds the netting loop, it must not shut the book to genuine traders.
    function test_the_market_cap_does_not_block_an_open_market() public {
        for (uint16 p = 0; p < 8; p++) {
            _submit(makeAddr(string(abi.encodePacked("n", p))), 1_000, HenceIncognito.Side.Long, p, false);
        }
        processAllOperations();

        _submit(makeAddr("late"), 2_000, HenceIncognito.Side.Short, BTC_PAIR, false);
        processAllOperations();
        _net(1);

        assertEq(getUint256Value(inc.bookMatched(1, BTC_PAIR)), 1_000, "the late order crossed");
    }

    /// The residual disposition is recorded on chain so the keeper can honour it. It is public,
    /// like `side` — what stays hidden is the size and the owner.
    function test_residual_disposition_is_recorded() public {
        vm.expectEmit(true, true, true, true);
        emit HenceIncognito.OrderSubmitted(1, alice, BTC_PAIR, HenceIncognito.Side.Long, true);
        _submit(alice, 1_000, HenceIncognito.Side.Long, BTC_PAIR, true);
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
