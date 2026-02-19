# Assets Self-Listing
Please follow these steps to add your token's logo and additional information to our assets database which will be used across our products, notably the information will be displayed on our exchange(https://saturndex.org) . This helps our users research your token and ensures traders do not confuse your token with another, therefore, we ask you be as accurate as possible.

If you need any help please join our discord and drop question in (support).

For any token listing support you can reach us via email: info@saturndex.org

## How to add your logo & additional information
* Step 1: Ensure you have a 200x200 logo on a transparent background in PNG format ready. For the best results, your logo should take up most of the canvas & you do not want to have a transparent margin around it. We also recommend announcing your project in our discord group
* Step 2: Fork the project's repository.
* Step 3: Upload your token's logo to the relevant directory: Ethereum tokens go in assets/ethereum/${tokenAddress}/logo.png whereas Ethereum Classic tokens go in assets/classic/${tokenAddress}/logo.png
* Step 4: Add your token's information to the relevant JSON file: Ethereum tokens use assets/ethereum/${tokenAddress}/info.json whereas Ethereum Classic tokens use assets/classic/${tokenAddress}/info.json.

For any information you do not have, do not leave it blank, remove the whole row.

Here is an an example below for Saturn Token on Ethereum:
```
  {
    "name": "Saturn Token",
    "address": "0x57Ae4e5Bd7dA72159e2e8878E7d8610eECC6eAAc",
    "symbol": "SATURN",
    "decimals": 4,
    "logo": "https://github.saturndex.org/ethereum/0x57Ae4e5Bd7dA72159e2e8878E7d8610eECC6eAAc/logo.png",
    "website": "https://saturndex.org/",
    "x": "https://x.com/saturndexorg",
    "reddit": "https://www.reddit.com/r/saturndex/",
    "telegram": "https://t.me/saturndex",
    "facebook": "https://www.facebook.com/saturndex",
    "coingecko": "https://www.coingecko.com/en/coins/saturn-token",
    "discord": "https://discord.gg/9PRwAPGx"
  }
```

* Step 5: Create a Pull Request.

## **Please note we have to manually approve pull requests and we may refuse requests containing abusive content or misleading information that will alienate our website visitors.**

## **Our exchange is [censorship-free], so steps above are not a requirement for your token to be tradable.**

