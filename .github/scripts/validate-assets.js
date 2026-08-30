/**
 * PR validation script for asset submissions
 * Validates info.json format and required fields
 */

const fs = require('fs');
const path = require('path');

const SUPPORTED_CHAINS = ['ethereum', 'classic'];

const REQUIRED_FIELDS = ['name', 'address', 'symbol', 'decimals'];

function isValidAddress(address) {
    return /^0x[0-9a-f]{40}$/.test(address);
}

function validateInfoJson(filePath) {
    const errors = [];
    
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(content);
        
        // Check required fields
        for (const field of REQUIRED_FIELDS) {
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
        
        // Validate decimals
        if (data.decimals !== undefined) {
            if (typeof data.decimals !== 'number' || data.decimals < 0 || data.decimals > 18) {
                errors.push(`Invalid decimals: ${data.decimals}`);
            }
        }
        
        // Validate symbol
        if (data.symbol && typeof data.symbol !== 'string') {
            errors.push('Symbol must be a string');
        }
        
        // Validate name
        if (data.name && typeof data.name !== 'string') {
            errors.push('Name must be a string');
        }
        
        // Validate URLs if present
        const urlFields = ['website', 'x', 'telegram', 'discord', 'reddit', 'facebook', 'coingecko'];
        for (const field of urlFields) {
            if (data[field] && typeof data[field] === 'string') {
                try {
                    new URL(data[field]);
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
    const parts = filePath.split(path.sep);
    
    // Find the chain and address in the path
    let chain = null;
    let address = null;
    
    for (const part of parts) {
        if (SUPPORTED_CHAINS.includes(part)) {
            chain = part;
        } else if (part.startsWith('0x') && part.length === 42) {
            address = part;
        }
    }
    
    if (!chain) {
        return ['Could not determine chain from file path'];
    }
    
    if (!address) {
        return ['Could not determine address from file path'];
    }
    
    if (address !== address.toLowerCase()) {
        return [`Address directory must be lowercase: ${address}`];
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
            const infoFile = path.join(addressPath, 'info.json');
            if (fs.existsSync(infoFile)) {
                files.push(infoFile);
            }
        }
    }
    
    return files;
}

async function main() {
    // Find changed files from git diff or scan all
    let filesToValidate = [];
    
    try {
        // Try to get changed files from environment
        const changedFiles = process.env.CHANGED_FILES || '';
        if (changedFiles) {
            filesToValidate = changedFiles.split('\n').filter(f => 
                f.includes('info.json') && 
                (f.startsWith('ethereum/0x') || f.startsWith('classic/0x'))
            );
        }
    } catch (e) {
        // Ignore
    }
    
    // If no changed files, scan all
    if (filesToValidate.length === 0) {
        filesToValidate = findAllAssetFiles();
    }
    
    let hasErrors = false;
    
    for (const file of filesToValidate) {
        console.log(`\nValidating: ${file}`);
        
        // Validate file path
        const pathErrors = validateFilePath(file);
        if (pathErrors.length > 0) {
            hasErrors = true;
            console.error('  ❌ Path errors:');
            pathErrors.forEach(e => console.error(`    - ${e}`));
        }
        
        // Validate info.json content
        const errors = validateInfoJson(file);
        if (errors.length > 0) {
            hasErrors = true;
            console.error('  ❌ Content errors:');
            errors.forEach(e => console.error(`    - ${e}`));
        } else {
            console.log('  ✓ Valid');
        }
    }
    
    if (hasErrors) {
        process.exit(1);
    }
    
    console.log('\n✅ All assets valid');
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
