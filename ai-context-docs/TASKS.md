**Important**: update @TASK_DETAILS.md with the progress you do on each of the following tasks.

## docker setup (prividium-3chain-local folder)

- [x] Confirm if keycloak instance is loaded with seed data that includes user@local.dev and admin@local.dev
- [x] Remove the demo-app from the compose file as it's not needed


## Setup script

- [x] Configure env.example and .env to work with 3 different chains, which are the ones mentioned in /prividium-3chain-local/README.md
- [x] Fund the entrypoint contract in chains A and B with ETH so they can send transactions
- [x] Deploy SSO contracts to chains A and B
- [x] Deploy InvoicePayment.sol to chain C
- [x] Deploy TestnetERC20Token.sol to chain C 3 times as USDC, SGD and TBILL
- [x] All ERC20 tokens deployed must be whitelisted in InvoicePayment.sol
- [x] All ERC20 tokens must be registered in the Native Token Vault and bridged to chains A and B so we can have its addresses in all chains.
- [x] Pre Mint tokens to deployer account
- [x] allow all users to call methods in all contracts deployed. See prividium-api.json for reference
- [x] create application client ids in chain A and B. They should have the callback url and CORS settings relative to the web-app, which runs on port 5000 and has a /auth-callback.html URL. Save them to the contracts.json file
- [x] Write all the information about contracts deployed (SSO, bytecodehash, Invoice and tokens) to ./config/contracts.json, separating the information for each chain. 
- [x] after deploying all contracts and writing the info in the json file, this script should update the docker-compose inside prividium-3chain-local to enable the bundler in the permission-api service for chains A and B. This is done via BUNDLER_ENABLED and BUNDLER_RPC_URL env variables. Also, we should provide the DISPATCHER_SSO_IMPLEMENTATIONS and DISPATCHER_SSO_BYTECODE_HASHES env variables as well, which should be the SSO implementation address and bytecodehash for each correspondent chain. At the end, print the command needed to restart the permission-api services in these 2 chains so they pick up the added env variables. Print that in the terminal.


## Backend service

- [x] Configure env.example and .env to work with 3 different chains, which are the ones mentioned in /prividium-3chain-local/README.md
- [x] The /deploy-account endpoint should also mint some amount to the USDC, SGD and TBILL tokens (deployed in the setup script) to the newly created account
- [x] Create a new endpoint /invoices, that uses a hardcoded account (ADMIN_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 ADMIN_ADDRESS=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266) to call the InvoicePayment.sol contract (deployed in setup script, address in /config/contracts.json) to query the available invoices and send the data back. This will be used from the web-app
- [ ] Create a new endpoint to change the exchange rate of the tokens in chain C InvoicePayment.sol contract. We should call setExchangeRate() with the admin account, which is the one that deployed the contracts in the setup script.
- [ ] make /invoices endpoint able to query all invoices, not filtering by a specific account.

## Web app

- [x] Configure env.example and .env to work with 2 different chains, which are the A and B mentioned in /prividium-3chain-local/README.md
- [x] Login view should have a toggle so users can choose which chain they want to log into, chain A or B
- [x] Dashboard should have a table listing all available invoices. Retrieve them calling the /invoices endpoint from the backend service
- [x] Create a Modal form to create invoices:
  - [x] tokens must be pre-populated with the deployed ERC20 tokens.
  - [x] destination chain id must correspond to A or B (never C)
  - [x] the creatorRefundAddress must be equal to creator, so let's just have an input for "creator"
  - [x] the recipientRefundAddress must be equal to recipient, so let's just have an input for "recipient"
- [x] logout should delete all info from cache or state so we have to manually log in again
- [x] Add a logout button in the navbar, with a dropdown with the option to copy the current wallet address. logout should redirect to login page with a clean state.
- [x] App dashboard should only focus on invoices. hide any components related to Counter (don't delete them from the codebase though), but not the activity table.
- [x] Creator address in invoice modal should be pre-populated with current user wallet address
- [x] Invoice modal should send an interop transactions from current chain (A or B, depending of what user chose on login) to chain C. As interop transactions take a little while to being process, we should provide users with some visual feedback of steps being completed. Currently looks like the modal just saves a draft with the data as we only show the message "Invoice payload validated and prepared." in the UI but no RPC call is being done.
- [x] when switching between chain A and B in login view, we should update the accent color, company name etc from the env file using the correspondent values from chain A or B. THIS IS UNCOMPLETED, we have VITE_COMPANY_A_* and VITE_COMPANY_B_* variables which should be used.
- [x] BUG: when there's an error in the app (like querying the invoices or a network issue) the logout button disapears from the navbar. Make sure errors do not affect visibility of this component/button.
- [x] In the MainView, we should display the current user token balances at the top, in a table view.
- [ ] Amount in the invoices table is not formatted properly and it shows the full amount without any decimal delimiter. Make it more human readable.
