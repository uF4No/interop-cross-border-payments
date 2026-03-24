1. clone repo

## Init base chains
   1. log into docker as detailed in `local-prividium/README.md`
   2. Run local instances with 3 prividiums
  
  docker compose -f ./prividium-utils/docker-compose-prividium.yaml down -v
docker compose -f ./prividium-utils/docker-compose-prividium.yaml up -d


## Sarah's feedback

- Aave v32 (draft) shadow accounts
- Interop v31 - no shadow accounts, send tokens. Mint and burn via asset tracker contracts,
  - Deploy in 1 one chain
  - check if token is registered in destination chain, if not, it deploys it.
    - https://github.com/matter-labs/interop-examples/blob/main/examples/sso-interop-portal/frontend/src/utils/l2-interop/interop-token-transfer.ts
  - v31 PR docs: https://github.com/matter-labs/zksync-docs/tree/sarah/interop-docs-v30/content/00.zksync-network/30.unique-features/50.zksync-connect
  - does not require backend system, interop is baked into the protocol. Check https://github.com/matter-labs/interop-examples/tree/main/examples/sso-interop-portal#running-with-l2---l2-interop
  - 
