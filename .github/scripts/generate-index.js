/**
 * Generates index.json — a pre-built token listing for the browse UI.
 * Reuses the directory-scanning pattern from validate-assets.js.
 * Runs on every push to main via GitHub Actions (update-index.yml),
 * or locally via `npm run generate-index`.
 *
 * Output: index.json at repo root, served via GitHub Pages CDN at
 * https://github.saturndex.org/index.json
 *
 * Schema per token (minimal for browse list):
 *   { name, symbol, address, chain, logo }
 * Full info.json is fetched on demand when a token modal is opened.
 */

const fs = require("fs");
const path = require("path");

const SUPPORTED_CHAINS = ["ethereum", "classic"];
// Repo root derived from script location so the script works regardless of cwd
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const OUTPUT_PATH = path.join(REPO_ROOT, "index.json");

function isValidAddress(address) {
    return /^0x[0-9a-f]{40}$/.test(address);
}

function collectChainTokens(chain) {
    const chainPath = path.join(REPO_ROOT, chain);
    if (!fs.existsSync(chainPath)) return [];

    const tokens = [];
    const addresses = fs.readdirSync(chainPath);

    for (const address of addresses) {
        const addressPath = path.join(chainPath, address);
        let stat;
        try {
            stat = fs.statSync(addressPath);
        } catch {
            continue;
        }
        if (!stat.isDirectory()) continue;
        if (!isValidAddress(address)) continue;

        const infoPath = path.join(addressPath, "info.json");
        if (!fs.existsSync(infoPath)) continue;

        try {
            const data = JSON.parse(fs.readFileSync(infoPath, "utf8"));
            if (!data.address || !data.name || !data.symbol) {
                console.warn(`Skipping ${chain}/${address}: missing required fields`);
                continue;
            }
            // Minimal schema for browse list
            tokens.push({
                name: data.name,
                symbol: data.symbol,
                address: data.address,
                chain: chain,
                logo: data.logo || null,
            });
        } catch (e) {
            console.warn(`Skipping ${chain}/${address}: ${e.message}`);
        }
    }

    return tokens;
}

function generateIndex() {
    const index = {
        generatedAt: new Date().toISOString(),
        totalTokens: 0,
        tokens: [],
    };

    for (const chain of SUPPORTED_CHAINS) {
        const chainTokens = collectChainTokens(chain);
        index.tokens = index.tokens.concat(chainTokens);
        console.log(`Collected ${chainTokens.length} ${chain} tokens`);
    }

    // Deterministic sort: chain, then address — stable output for clean diffs
    index.tokens.sort((a, b) => {
        if (a.chain !== b.chain) return a.chain < b.chain ? -1 : 1;
        return a.address < b.address ? -1 : a.address > b.address ? 1 : 0;
    });

    index.totalTokens = index.tokens.length;

    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(index, null, 2) + "\n");
    console.log(`\nGenerated index.json with ${index.totalTokens} tokens`);
}

generateIndex();
