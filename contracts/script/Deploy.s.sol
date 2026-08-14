// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {HenceIncognito} from "../src/HenceIncognito.sol";

/// Deploys HenceIncognito to Base Sepolia (or Base mainnet, later).
///
///   forge script script/Deploy.s.sol:Deploy \
///     --rpc-url https://sepolia.base.org --broadcast -vvv
///
/// TWO WAYS TO SIGN. Prefer the first — a raw key on a command line ends up in shell history.
///
///   A) encrypted keystore (recommended)
///      cast wallet import incognito-deployer --interactive
///      forge script ... --account incognito-deployer --sender <address> --broadcast
///
///   B) raw key in the environment
///      DEPLOYER_KEY=0x... forge script ... --broadcast
///
/// Reads from the environment:
///   DEPLOYER_KEY     OPTIONAL. Omit it when using --account.
///   KEEPER_ADDRESS   who may net epochs and reveal aggregates. Defaults to the sender.
///   EPOCH_SECONDS    epoch length; defaults to 300 (5 min)
///
/// The keeper is NOT the shielded wallet and NOT the omnibus funder. It only closes epochs
/// and publishes aggregates — it can never move a user's collateral. Keeping those roles
/// separate means a compromised keeper stalls the book rather than draining it.
contract Deploy is Script {
    function run() external {
        // 0 means "no DEPLOYER_KEY set" — then forge's own signer (--account / --private-key)
        // is used and msg.sender is the broadcaster it resolved.
        uint256 pk = vm.envOr("DEPLOYER_KEY", uint256(0));
        address deployer = pk == 0 ? msg.sender : vm.addr(pk);

        // Fail with a number the reader can act on. Foundry's own out-of-funds error arrives
        // mid-broadcast and reads like a node problem rather than "your wallet is empty".
        uint256 bal = deployer.balance;
        console2.log("deployer     ", deployer);
        console2.log("balance (wei)", bal);
        require(bal > 0.0005 ether, "deployer has no gas - fund it from a Base Sepolia faucet");

        address keeper = vm.envOr("KEEPER_ADDRESS", deployer);
        uint64 epochSeconds = uint64(vm.envOr("EPOCH_SECONDS", uint256(300)));

        if (pk == 0) vm.startBroadcast();      // forge supplies the signer (--account)
        else vm.startBroadcast(pk);            // raw key from the environment
        HenceIncognito inc = new HenceIncognito(keeper, epochSeconds);
        vm.stopBroadcast();

        console2.log("HenceIncognito", address(inc));
        console2.log("keeper        ", keeper);
        console2.log("epochSeconds  ", epochSeconds);
        console2.log("");
        console2.log("Next: put this in web/.env.local");
        console2.log("  VITE_INCOGNITO_CONTRACT=%s", address(inc));
    }
}
