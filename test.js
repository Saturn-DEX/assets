const fs = require("fs");
const path = require("path");
const _ = require("lodash");

function ensureCorrectAddressFormat(addy) {
  if (addy.length !== 42) {
    throw new Error(`Wrong address format for "${addy}"`);
  }
  if (addy !== addy.toLowerCase()) {
    throw new Error(`All addresses must be lowercase. Fix ${addy}`);
  }
  if (!/^0x[0-9a-f]{40}$/.test(addy)) {
    throw new Error(`Invalid hex address "${addy}"`);
  }
}

function findDuplicate(arr) {
  const hm = {};
  for (const key of arr) {
    if (hm[key]) {
      return key;
    } else {
      hm[key] = true;
    }
  }
}

function ensureNoDuplicates(arr) {
  const allAddresses = _.map(arr, "address");
  _.map(allAddresses, (x) => ensureCorrectAddressFormat(x));
  // Defense-in-depth: lowercased dedup catches case-variant collisions
  // After strict lowercase enforcement, exact and lowercased dedup are equivalent.
  const lowerCaseAddys = _.map(allAddresses, (x) => x.toLowerCase());
  const unique = _.uniq(lowerCaseAddys);
  if (unique.length !== lowerCaseAddys.length) {
    throw new Error(
      `Duplicates detected! Check ${findDuplicate(lowerCaseAddys)}`,
    );
  }
}

function collectChain(chainDir) {
  // Only consider 0x-address folders, ignore stray files/dirs like .git, logo, etc.
  const entries = fs.readdirSync(chainDir);
  const addrFolders = entries.filter((d) => /^0x[0-9a-fA-F]{40}$/.test(d));
  // Folder-level validation: must be lowercase and duplicates case-insensitively
  const lowerFolders = addrFolders.map((d) => d.toLowerCase());
  const uniqLowerFolders = _.uniq(lowerFolders);
  if (uniqLowerFolders.length !== lowerFolders.length) {
    throw new Error(
      `Duplicate folder detected in ${chainDir}! Check ${findDuplicate(lowerFolders)}`,
    );
  }
  for (const folder of addrFolders) {
    ensureCorrectAddressFormat(folder);
  }

  const tokens = [];
  for (const folder of addrFolders) {
    const infoPath = path.join(chainDir, folder, "info.json");
    if (!fs.existsSync(infoPath)) {
      throw new Error(`Missing info.json for ${chainDir}/${folder}`);
    }
    let data;
    try {
      data = JSON.parse(fs.readFileSync(infoPath, "utf8"));
    } catch (e) {
      throw new Error(`Invalid JSON at ${infoPath}: ${e.message}`);
    }
    if (!data.address) {
      throw new Error(`Missing address field in ${infoPath}`);
    }
    // Strict: folder name must exactly equal info.json address (both lowercase)
    if (data.address !== folder) {
      throw new Error(
        `Folder/address mismatch in ${chainDir}/${folder}: info.json address is "${data.address}"`,
      );
    }
    ensureCorrectAddressFormat(data.address);
    tokens.push(data);
  }
  return tokens;
}

try {
  const eth = collectChain("ethereum");
  const etc = collectChain("classic");
  console.log(
    `asset.json is valid! Checked ${eth.length} ethereum + ${etc.length} classic tokens.`,
  );

  ensureNoDuplicates(eth);
  ensureNoDuplicates(etc);

  process.exit(0);
} catch (e) {
  console.error(e);
  process.exit(1);
}
