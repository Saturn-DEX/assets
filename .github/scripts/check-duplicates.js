/**
 * Check for duplicate token addresses across chains
 */

const fs = require('fs');
const path = require('path');

const SUPPORTED_CHAINS = ['ethereum', 'classic'];

function findAllAddresses() {
    const addresses = new Map(); // address -> { chain, path }
    
    for (const chain of SUPPORTED_CHAINS) {
        const chainPath = path.join(process.cwd(), chain);
        if (!fs.existsSync(chainPath)) continue;
        
        const addressDirs = fs.readdirSync(chainPath);
        for (const address of addressDirs) {
            const addressPath = path.join(chainPath, address);
            if (!fs.statSync(addressPath).isDirectory()) continue;
            
            if (address.startsWith('0x') && address.length === 42) {
                const key = `${chain}:${address.toLowerCase()}`;
                addresses.set(key, { chain, address, path: addressPath });
            }
        }
    }
    
    return addresses;
}

function main() {
    console.log('Checking for duplicate addresses...\n');
    
    const addresses = findAllAddresses();
    const seen = new Map(); // normalized address -> [{ chain, address }]
    
    let hasDuplicates = false;
    
    for (const [key, info] of addresses) {
        const normalized = info.address.toLowerCase();
        
        if (seen.has(normalized)) {
            const existing = seen.get(normalized);
            
            // Check if same address exists in multiple chains (that's OK)
            // But flag if same chain has duplicate (shouldn't happen)
            const sameChain = existing.filter(e => e.chain === info.chain);
            
            if (sameChain.length > 0) {
                hasDuplicates = true;
                console.error(`❌ Duplicate in ${info.chain}:`);
                console.error(`   ${info.address}`);
                console.error(`   Path: ${info.path}`);
            }
        } else {
            seen.set(normalized, [{ chain: info.chain, address: info.address }]);
        }
    }
    
    if (hasDuplicates) {
        console.error('\n❌ Duplicate addresses found');
        process.exit(1);
    }
    
    console.log(`✅ No duplicates found (${addresses.size} unique addresses checked)`);
}

main();
