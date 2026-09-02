/**
 * Check for duplicate token addresses across chains
 *
 * Three layers (per-chain only, per owner clarification):
 *
 *  1. Base-branch existence check (PR resubmission guard):
 *     Any info.json this PR *adds* (a new token submission) must not reuse a
 *     token address that is already listed on the base branch *in the same chain*.
 *     A merged-tree scan alone can never see this — the base assets are part of
 *     the merge ref, so a resubmitted token collapses into a single directory
 *     and looks identical to a brand-new listing.  Only *added* info.json files
 *     are considered: a genuinely new token dir always adds one, while an edit
 *     never does (every listed token already has info.json on base, and its
 *     info.json would come through as modified, not added).  Added logo.png or
 *     any other file in an existing token dir is a legitimate edit and falls
 *     through to Layer 1b.  Requires the env vars ADDED_FILES (newline-separated
 *     asset paths added by the PR) and BASE_REF (a git ref resolving to the base
 *     branch tree, e.g. FETCH_HEAD).
 *
 *  1b. Per-address edit-vs-new classifier with whole-dir git diff:
 *     For every token directory touched by the PR (derived from ASSET_FILES or
 *     ADDED_FILES), classify as new vs edit by checking
 *     `chain:addressLower` membership in the base set (per-chain).  For edits
 *     (`existsOnBase`), run `git diff --name-only <base>...HEAD -- <chain>/<addr>/`
 *     over the whole token directory (covers info.json + logo.png).  Empty diff
 *     ⇒ reject as duplication error (expected rule: no difference = duplication).
 *     New tokens that already exist on base are also rejected.  Requires
 *     ASSET_FILES (or ADDED_FILES fallback) and BASE_REF.
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
        // Layer 1 is a new-token-submission guard: only an *added* info.json
        // marks a genuinely new token directory (every listed token has info.json
        // on base, so an edit never adds one). Added logo.png / any other file to
        // an existing token dir is a legitimate edit and is delegated to Layer 1b's
        // classifier.
        if (!file.endsWith("info.json")) continue;

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

function getChangedTokenDirs(assetFiles) {
    // Unique set of `chain/addressLower` dirs touched by the PR (per-chain)
    const dirs = new Map(); // key chain:addrLower -> dir string "chain/0x..."
    for (const file of assetFiles) {
        const m = file.match(ASSET_PATH_RE);
        if (!m) continue;
        const chain = m[1];
        const addrLower = m[2].toLowerCase();
        const key = `${chain}:${addrLower}`;
        if (!dirs.has(key)) dirs.set(key, `${chain}/${addrLower}`);
    }
    return dirs;
}

function hasDiffForDir(baseRef, dir) {
    try {
        // Compare baseRef to working tree + HEAD (covers both committed PR head in CI
        // and unstaged working-tree changes locally). Whole-dir scope covers info.json + logo.png.
        const out = execFileSync(
            "git",
            ["diff", "--name-only", baseRef, "--", dir],
            { encoding: "utf-8" },
        );
        return out.trim().length > 0;
    } catch (error) {
        console.error(`⚠️  git diff failed for "${dir}": ${error.message}`);
        // Fail closed when diff cannot be determined
        throw error;
    }
}

function checkNewTokenCompleteness(dir) {
    const missing = [];
    const infoPath = path.join(process.cwd(), dir, "info.json");
    const logoPath = path.join(process.cwd(), dir, "logo.png");
    if (!fs.existsSync(infoPath)) missing.push("info.json");
    if (!fs.existsSync(logoPath)) missing.push("logo.png");
    return missing;
}

function classifyChangedDirs(changedDirs, baseAddresses, baseRef) {
    let hasError = false;
    for (const [key, dir] of changedDirs) {
        const existsOnBase = baseAddresses.has(key);
        let hasDiff;
        try {
            hasDiff = hasDiffForDir(baseRef, dir);
        } catch {
            console.error(`❌ Cannot determine diff for ${dir} — blocking PR`);
            process.exit(1);
        }
        if (existsOnBase) {
            if (hasDiff) {
                console.log(`ℹ️  Edit detected (with diff): ${dir}`);
            } else {
                hasError = true;
                console.error(
                    `❌ Duplicate submission: ${dir} already exists on the base branch and this PR introduces no changes (empty git diff for whole token dir)`,
                );
            }
        } else {
            const missing = checkNewTokenCompleteness(dir);
            if (missing.length > 0) {
                hasError = true;
                console.error(
                    `❌ New token ${dir} is missing required file(s): ${missing.join(", ")}`,
                );
            } else if (hasDiff) {
                console.log(`ℹ️  New token: ${dir}`);
            } else {
                console.log(`ℹ️  New token (no base entry): ${dir}`);
            }
        }
    }
    return hasError;
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
    // Only added info.json marks a genuinely new token dir (see Layer 1).
    const addedInfoFiles = addedFiles.filter((f) => f.endsWith("info.json"));
    const assetFiles = (process.env.ASSET_FILES || "")
        .split("\n")
        .filter(Boolean);
    // Prefer ASSET_FILES (all touched assets) for classifier; fallback to ADDED_FILES
    const filesForClassifier = assetFiles.length > 0 ? assetFiles : addedFiles;
    const baseRef = process.env.BASE_REF || "FETCH_HEAD";

    // Layer 1 + 1b: base-branch guard + per-address whole-dir diff classifier (per-chain)
    // Need base set whenever we have any touched token dir, not only when ADDED_FILES > 0
    if (filesForClassifier.length > 0) {
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

        // Layer 1: legacy ADDED_FILES resubmission guard (kept for clear messaging)
        if (addedInfoFiles.length > 0) {
            const reListed = checkAddedAgainstBase(
                addedInfoFiles,
                baseAddresses,
            );
            if (reListed) {
                console.error(
                    "\n❌ This PR re-submits token(s) that are already present in the assets data",
                );
                process.exit(1);
            }
            console.log(
                `✅ None of the ${addedInfoFiles.length} PR-added info.json file(s) re-list an already-listed token`,
            );
        }

        // Layer 1b: per-address classifier with whole-dir git diff (covers edit no-diff + new-token duplicate via diff path)
        const changedDirs = getChangedTokenDirs(filesForClassifier);
        if (changedDirs.size > 0) {
            const hasDupNoDiff = classifyChangedDirs(
                changedDirs,
                baseAddresses,
                baseRef,
            );
            if (hasDupNoDiff) {
                console.error(
                    "\n❌ Duplicate submission(s) detected: edit with no effective diff for whole token dir (info.json + logo.png)",
                );
                process.exit(1);
            }
        }
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
