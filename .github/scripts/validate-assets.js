/**
 * PR validation script for asset submissions
 * Validates info.json format and required fields
 */

const fs = require("fs");
const path = require("path");

const SUPPORTED_CHAINS = ["ethereum", "classic"];

// Logo is mandatory for PR-touched tokens (new + edit). 19 existing grandfathered
// tokens without logo are NOT failed when the script falls back to a full scan
// (no CHANGED_FILES env). Only CHANGED_FILES entries are held to the logo rule.
const BASE_REQUIRED_FIELDS = ["name", "address", "symbol", "decimals"];
const LOGO_REQUIRED_FIELD = "logo";

function isValidAddress(address) {
    return /^0x[0-9a-f]{40}$/.test(address);
}

/**
 * Pull the 42-char 0x… address segment out of a file path
 * (e.g. "ethereum/0xabc…/info.json" -> "0xabc…"). Returns null if absent.
 */
function extractAddressFromPath(filePath) {
    const parts = filePath.split(/[\\/]/);
    for (const part of parts) {
        if (part.startsWith("0x") && part.length === 42) {
            return part;
        }
    }
    return null;
}

function validateInfoJson(filePath, expectedAddress, opts = {}) {
    const { isChangedFile = true } = opts;
    const errors = [];

    try {
        const content = fs.readFileSync(filePath, "utf-8");
        const data = JSON.parse(content);

        // Check required fields — logo only for touched tokens (grandfather)
        const requiredFields = isChangedFile
            ? [...BASE_REQUIRED_FIELDS, LOGO_REQUIRED_FIELD]
            : BASE_REQUIRED_FIELDS;
        for (const field of requiredFields) {
            if (!(field in data)) {
                errors.push(`Missing required field: ${field}`);
            }
        }

        // Validate address format
        if (data.address) {
            if (!isValidAddress(data.address)) {
                errors.push(`Invalid address format: ${data.address}`);
            }
            if (data.address !== data.address.toLowerCase()) {
                errors.push(`Address must be lowercase: ${data.address}`);
            }
        }

        // Cross-check: the address inside info.json must match the directory it lives in
        if (expectedAddress && data.address) {
            if (data.address.toLowerCase() !== expectedAddress.toLowerCase()) {
                errors.push(
                    `Address mismatch: info.json says "${data.address}" but the file is stored under directory "${expectedAddress.toLowerCase()}"`,
                );
            }
        }

        // Validate decimals — must be integer 0..18 (decimals plural is canonical)
        if (data.decimals !== undefined) {
            if (
                typeof data.decimals !== "number" ||
                !Number.isInteger(data.decimals) ||
                !Number.isFinite(data.decimals) ||
                data.decimals < 0 ||
                data.decimals > 18
            ) {
                errors.push(
                    `Invalid decimals (must be integer 0..18): ${data.decimals}`,
                );
            }
        }

        // Validate symbol — non-empty trimmed string
        if ("symbol" in data) {
            if (typeof data.symbol !== "string") {
                errors.push("Symbol must be a string");
            } else if (data.symbol.trim().length === 0) {
                errors.push("Symbol must be non-empty");
            }
        }

        // Validate name — non-empty trimmed string
        if ("name" in data) {
            if (typeof data.name !== "string") {
                errors.push("Name must be a string");
            } else if (data.name.trim().length === 0) {
                errors.push("Name must be non-empty");
            }
        }

        // Validate logo field (mandatory for touched tokens, format for all when present)
        if ("logo" in data || isChangedFile) {
            if (!("logo" in data)) {
                // already reported as missing required, no extra format error
            } else if (typeof data.logo !== "string") {
                errors.push("Logo must be a string URL");
            } else if (data.logo.trim().length === 0) {
                errors.push("Logo must be non-empty");
            } else {
                const rawLogo = data.logo;
                if (rawLogo !== rawLogo.trim()) {
                    errors.push(
                        `Logo URL has leading/trailing whitespace: "${rawLogo}"`,
                    );
                }
                const trimmedLogo = rawLogo.trim();
                try {
                    new URL(trimmedLogo);
                } catch {
                    errors.push(`Invalid URL for logo: ${rawLogo}`);
                }
                // Optional strict shape warning: should point at same chain/address logo.png
                if (expectedAddress) {
                    const parts = filePath.split(/[\\/]/);
                    let chainFromPath = null;
                    for (const p of parts)
                        if (SUPPORTED_CHAINS.includes(p)) chainFromPath = p;
                    if (chainFromPath) {
                        // Enforce that logo URL at least contains the address
                        if (
                            !trimmedLogo
                                .toLowerCase()
                                .includes(expectedAddress.toLowerCase())
                        ) {
                            errors.push(
                                `Logo URL should contain token address "${expectedAddress.toLowerCase()}": ${rawLogo}`,
                            );
                        }
                    }
                }
            }
            // Filesystem check: logo.png must exist for touched tokens (whole-dir diff scope)
            if (isChangedFile && expectedAddress) {
                const parts = filePath.split(/[\\/]/);
                let chainFromPath = null;
                for (const p of parts)
                    if (SUPPORTED_CHAINS.includes(p)) chainFromPath = p;
                if (chainFromPath) {
                    const logoPath = path.join(
                        process.cwd(),
                        chainFromPath,
                        expectedAddress.toLowerCase(),
                        "logo.png",
                    );
                    if (!fs.existsSync(logoPath)) {
                        errors.push(
                            `Missing logo.png file for ${chainFromPath}/${expectedAddress.toLowerCase()} (required for touched tokens)`,
                        );
                    }
                }
            }
        }

        // Validate URLs if present — trim check + URL validity
        const urlFields = [
            "website",
            "x",
            "telegram",
            "discord",
            "reddit",
            "facebook",
            "coingecko",
        ];
        for (const field of urlFields) {
            if (
                data[field] !== undefined &&
                data[field] !== null &&
                data[field] !== ""
            ) {
                if (typeof data[field] !== "string") {
                    errors.push(`${field} must be a string URL`);
                    continue;
                }
                if (data[field] !== data[field].trim()) {
                    errors.push(
                        `Invalid URL for ${field} (leading/trailing whitespace): "${data[field]}"`,
                    );
                    continue;
                }
                if (data[field].trim().length === 0) continue;
                try {
                    new URL(data[field].trim());
                } catch {
                    errors.push(`Invalid URL for ${field}: ${data[field]}`);
                }
            }
        }
    } catch (error) {
        if (error instanceof SyntaxError) {
            errors.push(`Invalid JSON format: ${error.message}`);
        } else {
            errors.push(`Failed to read file: ${error.message}`);
        }
    }

    return errors;
}

function validateFilePath(filePath) {
    const parts = filePath.split(/[\\/]/);

    // Find the chain and address in the path
    let chain = null;
    let address = null;

    for (const part of parts) {
        if (SUPPORTED_CHAINS.includes(part)) {
            chain = part;
        } else if (part.startsWith("0x") && part.length === 42) {
            address = part;
        }
    }

    if (!chain) {
        return ["Could not determine chain from file path"];
    }

    if (!address) {
        return ["Could not determine address from file path"];
    }

    if (address !== address.toLowerCase()) {
        return [`Address directory must be lowercase: ${address}`];
    }
    if (!isValidAddress(address)) {
        return [`Invalid address directory hex: ${address}`];
    }

    return [];
}

function findAllAssetFiles() {
    const files = [];

    for (const chain of SUPPORTED_CHAINS) {
        const chainPath = path.join(process.cwd(), chain);
        if (!fs.existsSync(chainPath)) continue;

        const addresses = fs.readdirSync(chainPath);
        for (const address of addresses) {
            const addressPath = path.join(chainPath, address);
            if (!fs.statSync(addressPath).isDirectory()) continue;

            // Check for info.json
            const infoFile = path.join(addressPath, "info.json");
            if (fs.existsSync(infoFile)) {
                files.push(infoFile);
            }
        }
    }

    return files;
}

async function main() {
    // Find changed files from env or scan all (grandfather: logo mandatory only for changed files)
    let filesToValidate = [];
    let isFullScan = false;
    const changedFilesEnv = process.env.CHANGED_FILES || "";

    try {
        if (changedFilesEnv) {
            filesToValidate = changedFilesEnv
                .split("\n")
                .filter(
                    (f) =>
                        f.includes("info.json") &&
                        (f.startsWith("ethereum/0x") ||
                            f.startsWith("classic/0x")),
                );
        }
    } catch (_e) {
        // Ignore CHANGED_FILES parse errors
    }

    // If no changed files, scan all — grandfather mode: logo not mandatory
    if (filesToValidate.length === 0) {
        filesToValidate = findAllAssetFiles();
        isFullScan = true;
    }

    let hasErrors = false;
    const changedSet = new Set(filesToValidate);

    for (const file of filesToValidate) {
        console.log(`\nValidating: ${file}`);
        const isChangedFile = !isFullScan || changedSet.has(file);
        // In full-scan mode, isChangedFile is true for all but we want grandfather → treat as NOT changed
        const effectiveIsChanged = changedFilesEnv ? isChangedFile : false;

        // Validate file path
        const pathErrors = validateFilePath(file);
        if (pathErrors.length > 0) {
            hasErrors = true;
            console.error("  ❌ Path errors:");
            pathErrors.forEach((e) => console.error(`    - ${e}`));
        }

        // Validate info.json content (directory address is passed for the cross-check)
        const errors = validateInfoJson(file, extractAddressFromPath(file), {
            isChangedFile: effectiveIsChanged,
        });
        if (errors.length > 0) {
            hasErrors = true;
            console.error("  ❌ Content errors:");
            errors.forEach((e) => console.error(`    - ${e}`));
        } else {
            console.log("  ✓ Valid");
        }
    }

    if (hasErrors) {
        process.exit(1);
    }

    console.log("\n✅ All assets valid");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
