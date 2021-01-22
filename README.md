# Chainlink Keepers

## [Design doc](https://www.notion.so/chainlink/Keeper-V2-94415970f1ef4b46ba0f6aebee1cd477)

## Setup

```
yarn install
```

## Test

```
yarn test
```

## Deploy to Kovan

Set environment variables `KOVAN_PRIVATE_KEY` and `KOVAN_RPC_URL`.

Then run:
```
yarn deploy:kovan
```

## Verify on Etherscan

Set environment variables `ETHERSCAN_API_KEY`.

Then run:
```
yarn verify:kovan
```
