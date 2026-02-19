# Multi-chain Prividium Compose

This folder contains two compose entrypoints:

- `docker-compose-zksyncos-3chains.yaml`: L1 + 3 L2 only
- `docker-compose-prividium.yaml`: L1 + 3 L2 + 3 Prividium stacks + explorers + shared infra

## Run only L1 + 3 L2

```bash
docker compose -f ./prividium-utils/docker-compose-zksyncos-3chains.yaml up -d
```

RPC endpoints:

- L1: `http://localhost:5110`
- L2A (`chain_id=6565`): `http://localhost:5150`
- L2B (`chain_id=6566`): `http://localhost:5151`
- L2C (`chain_id=6567`): `http://localhost:5152`

Stop/reset:

```bash
docker compose -f ./prividium-utils/docker-compose-zksyncos-3chains.yaml down -v --remove-orphans
```

## Run full stack (L1 + 3 L2 + Prividium)

```bash
docker compose -f ./prividium-utils/docker-compose-prividium.yaml up -d
```

Full stack includes:

- 3x permissions APIs, user panels, admin panels
- 3x block explorers (API/app/worker/data-fetcher)
- Postgres, Keycloak, Prometheus, Grafana
- Init/ops jobs and services: `fund-l1-senders`, `wait-for-chains`, `deposit-l1-to-l2`, `interop-relay`

Stop/reset:

```bash
docker compose -f ./prividium-utils/docker-compose-prividium.yaml down -v --remove-orphans
```

## Full Stack Endpoints

| Stack | Chain ID | RPC | Permissions API | User Panel | Admin Panel | Explorer |
| --- | --- | --- | --- | --- | --- | --- |
| L2A | `6565` | `http://localhost:5050` | `http://localhost:8000` | `http://localhost:3001` | `http://localhost:3000` | `http://localhost:3010` |
| L2B | `6566` | `http://localhost:5051` | `http://localhost:8300` | `http://localhost:3301` | `http://localhost:3300` | `http://localhost:3310` |
| L2C | `6567` | `http://localhost:5052` | `http://localhost:8600` | `http://localhost:3601` | `http://localhost:3600` | `http://localhost:3610` |

Shared infra endpoints:

- L1 RPC: `http://localhost:5010`
- Keycloak: `http://localhost:5080`
- Prometheus: `http://localhost:9090`
- Grafana: `http://localhost:3100`

## Credentials

Keycloak admin (console):

| URL | Username | Password |
| --- | --- | --- |
| `http://localhost:5080/admin` | `admin` | `admin` |

Realm users (`prividium` realm, client `prividium-client`):

| User | Password |
| --- | --- |
| `admin@local.dev` | `password` |
| `user1@local.dev` | `password` |
| `user2@local.dev` | `password` |

## Rich Wallets (Local Dev)

These are funded by the setup jobs in the full-stack compose.

| Role | Address | Private Key |
| --- | --- | --- |
| Deployer / Anvil rich account #0 | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` | `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80` |
| L2A Commit Sender | `0x0E8b6302404446775a263A8cCAAbB2692fe24a73` | `0xb8ac8bbc8ca310c35c19ab54dbe61cd4dc49ab6e7aa25cbb92ec632d6658c246` |
| L2A Prove Sender | `0x574141bF5deCA94F71acad4aaC0662c27bC6D85a` | `0x3005ac34ce00f614746f716b920051e962efa168e73980e26553e9c45eee0aa0` |
| L2A Execute Sender | `0xE8242c8C8B3D325624122F54B8963C9979fbF8dA` | `0x8ff6a3da865e01e569ec073b373190d588117efc566af176888d2d96e92e00e9` |
| L2B Commit Sender | `0xD667a272ad926a19dA6E02e4449E0488d646d91A` | `0xbf0dbb75385963dffb6e4b6810cf95050b4d493e8fd99a5f24369f0155cb6df3` |
| L2B Prove Sender | `0x6Fe5f451e5Deb68CB4f7f2Ac1A38E027f9D65f90` | `0xd1e69f0a9551d38e6676c23c5c57f9a0852d01960d588045c4d1412f0e20cc41` |
| L2B Execute Sender | `0xF67c256463BeCB4351f0999eC404BbA9D7B53dfd` | `0x036f88b947b7983319182955891559ffd06bb9a8a5670d082718334622a4b359` |
| L2C Commit Sender | `0xEc1B8631492394bdf1972dCcC520eA9129843DF6` | `0x7c8521182946c5f60c4f9f6b2c7f68e7c0ca4f452f95ce31aafc0af6f9e5d7c6` |
| L2C Prove Sender | `0x919330e38d59f9920FcB9CdE995c93034381A3C0` | `0x47e179ec1974887f6b05f93f4f2dc4e38b0f65b1b845a70d820ee7da8b1fbb5f` |
| L2C Execute Sender | `0x764226932Bb7E0EFC8a2E7d4c3067F05e4fF2f54` | `0x8b3a350cf5c34c9194ca3a545d07a3a6a77f4a17d52f4ec3ce34f32f6b1a9f1f` |

## Chain Snapshot And Config

Both compose files use:

- L1 snapshot: `./chain-configs/dev/zksyncos/l1-state-3chains.json.gz`
- L2 configs: `./chain-configs/dev/zksyncos/chain_6565.yaml`, `./chain-configs/dev/zksyncos/chain_6566.yaml`, `./chain-configs/dev/zksyncos/chain_6567.yaml`

Re-dump snapshot from a running L1:

```bash
docker compose -f ./prividium-utils/docker-compose-zksyncos-3chains.yaml exec -T l1 \
  cast rpc --rpc-url http://127.0.0.1:5010 anvil_dumpState \
  | tr -d '"' \
  | sed 's/^0x//' \
  | xxd -r -p > ./prividium-utils/chain-configs/dev/zksyncos/l1-state-3chains.json.gz
```

Important: each chain must use different `l1_sender` keys. Reusing sender keys across L2s causes L1 nonce collisions (`replacement transaction underpriced`).

## Notes

- Explorer and infra configs are under `./dev`.
- Demo-specific jobs from the institutional demo (`contracts-deploy`, token mint/bridge) are not included here yet since they depend on demo contracts/scripts and addresses.
