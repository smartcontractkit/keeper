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

## Deployment and verification

The following networks are supported by keeper:
- `kovan`: Ethereum testnet with chain ID 42
- `mumbai`: Polygon testnet with chain ID 80001

### Deploy

Set environment variables `<NETWORK>_PRIVATE_KEY` and `<NETWORK>_RPC_URL` according to the network smart contracts will be deployed to.
Environment variables per network:
- `kovan`:
  - `KOVAN_PRIVATE_KEY`
  - `KOVAN_RPC_URL`
- `mumbai`:
  - `MUMBAI_PRIVATE_KEY`
  - `MUMBAI_RPC_URL`

Then run:
```bash
$ yarn deploy:<network-name>
```

`<network-name>` is the value from the supported networks list above.

### Verify on Etherscan

Set environment variables `ETHERSCAN_API_KEY`.

Then run:
```bash
$ yarn verify:<network-name>
```

`<network-name>` is the value from the supported networks list above.
