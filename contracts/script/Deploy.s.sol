// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {HenceIncognito} from "../src/HenceIncognito.sol";

/// Deploys HenceIncognito to Base Sepolia (or Base mainnet, later).
///
///   forge script script/Deploy.s.sol:Deploy \
///     --rpc-url https://sepolia.base.org --broadcast -vvv
///
/// Reads from the environment:
///   DEPLOYER_KEY     deployer private key (needs Sepolia ETH for gas ONLY)
///   KEEPER_ADDRESS   who may net epochs and reveal aggregates. Defaults to the deployer.
///   EPOCH_SECONDS    epoch length; defaults to 300 (5 min)
///
/// The keeper is NOT the shielded wallet and NOT the omnibus funder. It only closes epochs
/// and publishes aggregates — it can never move a user's collateral. Keeping those roles
/// separate means a compromised keeper stalls the book rather than draining it.
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_KEY");
        address deployer = vm.addr(pk);

        // Fail with a number the reader can act on. Foundry's own out-of-funds error arrives
        // mid-broadcast and reads like a node problem rather than "your wallet is empty".
        uint256 bal = deployer.balance;
        console2.log("deployer     ", deployer);
        console2.log("balance (wei)", bal);
        require(bal > 0.0005 ether, "deployer has no gas - fund it from a Base Sepolia faucet");

        address keeper = vm.envOr("KEEPER_ADDRESS", deployer);
        uint64 epochSeconds = uint64(vm.envOr("EPOCH_SECONDS", uint256(300)));

        vm.startBroadcast(pk);
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
