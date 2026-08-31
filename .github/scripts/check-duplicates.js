/**
 * Check for duplicate token addresses across chains
 *
 * Two independent layers of protection:
 *
 *  1. Base-branch existence check (PR resubmission guard):
 *     Any asset file this PR *adds* (a new token submission) must not reuse a
 *     token address that is already listed on the base branch.  A merged-tree
 *     scan alone can never see this — the base assets are part of the merge
 *     ref, so a resubmitted token collapses into a single directory and looks
 *     identical to a brand-new listing.  Requires the env vars ADDED_FILES
 *     (newline-separated asset paths added by the PR) and BASE_REF (a git ref
 *     resolving to the base branch tree, e.g. FETCH_HEAD).
 *
 *  2. In-tree duplicate-directory scan:
 *     Flags same-chain duplicates among chain/<address> directories in the
 *     working tree.  Directories are keyed by their *raw* spelling so that
 *     variants differing only by letter case are kept separate and detected —
 *     a Map keyed on the lowercased address would silently drop one of the
 *     two directories, hiding the duplicate before the scan even runs.
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const SUPPORTED_CHAINS = ["ethereum", "classic"];
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const ASSET_PATH_RE = /^(ethereum|classic)\/(0x[0-9a-fA-F]{40})\//;

function findAllAddresses() {
    const directories = new Map(); // raw key `${chain}:${address-as-spelled}` -> { chain, address, path }

    for (const chain of SUPPORTED_CHAINS) {
        const chainPath = path.join(process.cwd(), chain);
        if (!fs.existsSync(chainPath)) continue;

        const addressDirs = fs.readdirSync(chainPath);
        for (const address of addressDirs) {
            const addressPath = path.join(chainPath, address);
            if (!fs.statSync(addressPath).isDirectory()) continue;

            // Deliberately no address.toLowerCase() in the key: two directories
            // that differ only by case must BOTH be kept, otherwise the second
            // set() silently overwrites the first and the duplicate vanishes.
            if (ADDRESS_RE.test(address)) {
                directories.set(`${chain}:${address}`, {
                    chain,
                    address,
                    path: addressPath,
                });
            }
        }
    }

    return directories;
}

function getBaseAddresses(baseRef) {
    // Set of `${chain}:${addressLower}` for every asset directory on the base branch
    let output;
    try {
        output = execFileSync(
            "git",
            ["ls-tree", "-r", "--name-only", baseRef, ...SUPPORTED_CHAINS],
            { encoding: "utf-8" },
        );
    } catch (error) {
        console.error(
            `⚠️  Failed to read base branch tree from "${baseRef}": ${error.message}`,
        );
        return null;
    }

    const addresses = new Set();
    for (const line of output.split("\n")) {
        const match = line.match(ASSET_PATH_RE);
        if (match) {
            addresses.add(`${match[1]}:${match[2].toLowerCase()}`);
        }
    }
    return addresses;
}

function checkAddedAgainstBase(addedFiles, baseAddresses) {
    let alreadyListed = false;

    for (const file of addedFiles) {
        const parts = file.split("/");
        if (parts.length < 3) continue;
        const [chain, address] = parts;
        if (!SUPPORTED_CHAINS.includes(chain) || !ADDRESS_RE.test(address)) {
            continue;
        }

        const key = `${chain}:${address.toLowerCase()}`;
        if (baseAddresses.has(key)) {
            alreadyListed = true;
            console.error(
                `❌ Token already listed on the base branch: ${chain}/${address.toLowerCase()}`,
            );
            console.error(`   Added by this PR: ${file}`);
        }
    }

    return alreadyListed;
}

function findDuplicateDirectories(directories) {
    const byAddress = new Map(); // normalized address -> [{ chain, address, path }]
    for (const info of directories.values()) {
        const normalized = info.address.toLowerCase();
        if (!byAddress.has(normalized)) byAddress.set(normalized, []);
        byAddress.get(normalized).push(info);
    }

    let hasDuplicates = false;
    for (const [normalized, infos] of byAddress) {
        const perChain = new Map();
        for (const info of infos) {
            if (!perChain.has(info.chain)) perChain.set(info.chain, []);
            perChain.get(info.chain).push(info);
        }
        for (const [chain, chainInfos] of perChain) {
            if (chainInfos.length > 1) {
                hasDuplicates = true;
                console.error(
                    `❌ Duplicate address "${normalized}" in ${chain}:`,
                );
                for (const info of chainInfos) {
                    console.error(`   Path: ${info.path}`);
                }
            }
        }
    }
    return hasDuplicates;
}

function main() {
    console.log("Checking for duplicate addresses...\n");

    const addedFiles = (process.env.ADDED_FILES || "")
        .split("\n")
        .filter(Boolean);
    const baseRef = process.env.BASE_REF || "FETCH_HEAD";

    // Layer 1: PR-added tokens must not already be listed on the base branch.
    if (addedFiles.length > 0) {
        const baseAddresses = getBaseAddresses(baseRef);
        if (!baseAddresses) {
            // Fail closed: never silently skip the resubmission guard.
            console.error(
                `❌ Could not read the base branch tree from "${baseRef}"`,
            );
            console.error(
                "   Cannot verify that the added tokens are not already listed — blocking the PR",
            );
            process.exit(1);
        }

        const reListed = checkAddedAgainstBase(addedFiles, baseAddresses);
        if (reListed) {
            console.error(
                "\n❌ This PR re-submits token(s) that are already present in the assets data",
            );
            process.exit(1);
        }

        console.log(
            `✅ None of the ${addedFiles.length} PR-added asset file(s) re-list an already-listed token`,
        );
    }

    // Layer 2: in-tree duplicate directories (same chain, normalized comparison).
    const directories = findAllAddresses();
    if (findDuplicateDirectories(directories)) {
        console.error("\n❌ Duplicate addresses found");
        process.exit(1);
    }

    console.log(
        `✅ No duplicates found (${directories.size} asset directories checked)`,
    );
}

main();
