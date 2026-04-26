import { createClient } from "@solana/kit";
import { solanaRpc } from "@solana/kit-plugin-rpc";
import { generatedPayer } from "@solana/kit-plugin-signer";
import {
    fetchSysvarClock,
    SYSVAR_CLOCK_ADDRESS,
    fetchSysvarSlotHashes,
    SYSVAR_SLOT_HASHES_ADDRESS }
from "@solana/sysvars";
async function main() {
    const client = await createClient()
        .use(generatedPayer())
        .use(
            solanaRpc({
                rpcUrl: "https://api.mainnet.solana.com"
            })
        );

    const accountInfo = await client.rpc
        .getAccountInfo(SYSVAR_CLOCK_ADDRESS, { encoding: "base64" })
        .send();
    console.log(accountInfo);

    // Automatically fetch and deserialize the account data
    const clock = await fetchSysvarClock(client.rpc);
    console.log(clock);

    const shInfo = await client.rpc
        .getAccountInfo(SYSVAR_SLOT_HASHES_ADDRESS, { encoding: "base64" })
        .send();
    console.log(shInfo);

    // Fetch and deserialize the `SlotHashes` sysvar account
    const slotHashes = await fetchSysvarSlotHashes(client.rpc);
    console.log(slotHashes);
}
main().catch((error) => {
    console.error("Error:", error);
    process.exit(1);
});