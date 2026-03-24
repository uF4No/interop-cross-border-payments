import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { execCmd } from './exec-cmd';

const INVOICE_SOURCE = path.join('src', 'InvoicePayment.sol');
const TOKEN_SOURCE = path.join('src', 'TestnetERC20Token.sol');
const INVOICE_ARTIFACT = path.join('out', 'InvoicePayment.sol', 'InvoicePayment.json');
const TOKEN_ARTIFACT = path.join('out', 'TestnetERC20Token.sol', 'TestnetERC20Token.json');
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

type ArtifactJson = {
  abi?: unknown;
  bytecode?: {
    object?: string;
  };
};

const COMPATIBILITY_FILES: Array<{ relativePath: string; content: string }> = [
  {
    relativePath: path.join(
      'era-contracts',
      'l1-contracts',
      'contracts',
      'common',
      'l2-helpers',
      'L2ContractAddresses.sol'
    ),
    content: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

address constant L2_NATIVE_TOKEN_VAULT_ADDR = 0x0000000000000000000000000000000000010004;
`
  },
  {
    relativePath: path.join(
      'era-contracts',
      'l1-contracts',
      'contracts',
      'bridge',
      'ntv',
      'INativeTokenVault.sol'
    ),
    content: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface INativeTokenVault {
    function assetId(address token) external view returns (bytes32);
}
`
  },
  {
    relativePath: path.join(
      'era-contracts',
      'l1-contracts',
      'contracts',
      'bridgehub',
      'IInteropCenter.sol'
    ),
    content: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {InteropCallStarter, GasFields} from "../common/Messaging.sol";

interface IInteropCenter {
    function requestInterop(
        uint256 destinationChainId,
        address refundRecipient,
        InteropCallStarter[] calldata feePaymentCallStarters,
        InteropCallStarter[] calldata executionCallStarters,
        GasFields calldata gasFields
    ) external payable;
}
`
  },
  {
    relativePath: path.join(
      'era-contracts',
      'l1-contracts',
      'contracts',
      'bridgehub',
      'IInteropHandler.sol'
    ),
    content: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IInteropHandler {
    function getAliasedAccount(address account, uint256 chainId) external view returns (address);
}
`
  },
  {
    relativePath: path.join(
      'era-contracts',
      'system-contracts',
      'contracts',
      'Constants.sol'
    ),
    content: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

address constant L2_INTEROP_CENTER = 0x000000000000000000000000000000000001000B;
address constant L2_STANDARD_TRIGGER_ACCOUNT_ADDR = 0x000000000000000000000000000000000001000F;
address constant L2_INTEROP_HANDLER = 0x000000000000000000000000000000000001000D;
`
  },
  {
    relativePath: path.join(
      'era-contracts',
      'l1-contracts',
      'contracts',
      'common',
      'Messaging.sol'
    ),
    content: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

struct InteropCallStarter {
    bool isService;
    address to;
    bytes data;
    uint256 value;
    uint256 gasLimit;
}

struct GasFields {
    uint256 gasLimit;
    uint256 gasPerPubdataByteLimit;
    address refundRecipient;
    address gasPayer;
    bytes customData;
}
`
  },
  {
    relativePath: path.join(
      'era-contracts',
      'l1-contracts',
      'contracts',
      'common',
      'libraries',
      'DataEncoding.sol'
    ),
    content: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library DataEncoding {}
`
  },
  {
    relativePath: path.join('@openzeppelin', 'contracts', 'token', 'ERC20', 'ERC20.sol'),
    content: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract ERC20 {
    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;
    uint256 private _totalSupply;
    string private _name;
    string private _symbol;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory name_, string memory symbol_) {
        _name = name_;
        _symbol = symbol_;
    }

    function name() public view returns (string memory) {
        return _name;
    }

    function symbol() public view returns (string memory) {
        return _symbol;
    }

    function decimals() public view virtual returns (uint8) {
        return 18;
    }

    function totalSupply() public view returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) public view returns (uint256) {
        return _balances[account];
    }

    function transfer(address to, uint256 value) public returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function allowance(address owner, address spender) public view returns (uint256) {
        return _allowances[owner][spender];
    }

    function approve(address spender, uint256 value) public returns (bool) {
        _approve(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) public returns (bool) {
        uint256 currentAllowance = _allowances[from][msg.sender];
        require(currentAllowance >= value, "ERC20: insufficient allowance");
        unchecked {
            _approve(from, msg.sender, currentAllowance - value);
        }
        _transfer(from, to, value);
        return true;
    }

    function _transfer(address from, address to, uint256 value) internal {
        require(from != address(0), "ERC20: transfer from the zero address");
        require(to != address(0), "ERC20: transfer to the zero address");

        uint256 fromBalance = _balances[from];
        require(fromBalance >= value, "ERC20: transfer amount exceeds balance");
        unchecked {
            _balances[from] = fromBalance - value;
        }
        _balances[to] += value;

        emit Transfer(from, to, value);
    }

    function _mint(address account, uint256 value) internal {
        require(account != address(0), "ERC20: mint to the zero address");
        _totalSupply += value;
        _balances[account] += value;
        emit Transfer(address(0), account, value);
    }

    function _approve(address owner, address spender, uint256 value) internal {
        require(owner != address(0), "ERC20: approve from the zero address");
        require(spender != address(0), "ERC20: approve to the zero address");
        _allowances[owner][spender] = value;
        emit Approval(owner, spender, value);
    }
}
`
  }
];

function ensureDir(targetPath: string): void {
  fs.mkdirSync(targetPath, { recursive: true });
}

function writeTextFile(targetPath: string, content: string): void {
  ensureDir(path.dirname(targetPath));
  fs.writeFileSync(targetPath, content, 'utf8');
}

function artifactIsUsable(targetPath: string): boolean {
  if (!fs.existsSync(targetPath)) {
    return false;
  }

  try {
    const artifact = JSON.parse(fs.readFileSync(targetPath, 'utf8')) as ArtifactJson;
    return Array.isArray(artifact.abi) && typeof artifact.bytecode?.object === 'string';
  } catch {
    return false;
  }
}

function latestMtime(paths: string[]): number {
  return Math.max(...paths.map((entry) => fs.statSync(entry).mtimeMs));
}

function earliestMtime(paths: string[]): number {
  return Math.min(...paths.map((entry) => fs.statSync(entry).mtimeMs));
}

function shouldRebuildArtifacts(contractsDir: string): boolean {
  const sourcePaths = [
    path.join(contractsDir, INVOICE_SOURCE),
    path.join(contractsDir, TOKEN_SOURCE),
    path.join(MODULE_DIR, 'contracts-artifacts.ts')
  ];
  const artifactPaths = [
    path.join(contractsDir, INVOICE_ARTIFACT),
    path.join(contractsDir, TOKEN_ARTIFACT)
  ];

  if (artifactPaths.some((targetPath) => !artifactIsUsable(targetPath))) {
    return true;
  }

  return latestMtime(sourcePaths) > earliestMtime(artifactPaths);
}

function createCompatibilityWorkspace(tempRoot: string, contractsDir: string): void {
  writeTextFile(
    path.join(tempRoot, 'foundry.toml'),
    `[profile.default]\nsrc = "src"\nout = "out"\nlibs = []\nauto_detect_solc = true\noptimizer = true\noptimizer_runs = 200\nvia_ir = true\nremappings = [\n  "era-contracts/=era-contracts/",\n  "@openzeppelin/contracts/=@openzeppelin/contracts/"\n]\n`
  );

  const invoiceDestination = path.join(tempRoot, INVOICE_SOURCE);
  const tokenDestination = path.join(tempRoot, TOKEN_SOURCE);
  ensureDir(path.dirname(invoiceDestination));
  ensureDir(path.dirname(tokenDestination));
  fs.copyFileSync(path.join(contractsDir, INVOICE_SOURCE), invoiceDestination);
  fs.copyFileSync(path.join(contractsDir, TOKEN_SOURCE), tokenDestination);

  for (const file of COMPATIBILITY_FILES) {
    writeTextFile(path.join(tempRoot, file.relativePath), file.content);
  }
}

function copyBuiltArtifact(tempRoot: string, contractsDir: string, relativeArtifactPath: string): void {
  const sourcePath = path.join(tempRoot, relativeArtifactPath);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Expected compiled artifact missing: ${sourcePath}`);
  }

  const destinationPath = path.join(contractsDir, relativeArtifactPath);
  ensureDir(path.dirname(destinationPath));
  fs.copyFileSync(sourcePath, destinationPath);
}

async function assertForgeAvailable(): Promise<void> {
  await execCmd('forge --version', process.cwd()).catch((error) => {
    throw new Error(
      `Foundry is required to compile setup contracts. Install or expose 'forge' before running setup.\n${String(error)}`
    );
  });
}

export async function ensureContractsArtifacts(contractsDir: string): Promise<void> {
  if (!shouldRebuildArtifacts(contractsDir)) {
    return;
  }

  await assertForgeAvailable();

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cross-border-contracts-'));

  try {
    createCompatibilityWorkspace(tempRoot, contractsDir);
    await execCmd(
      'forge build --via-ir src/InvoicePayment.sol src/TestnetERC20Token.sol --force',
      tempRoot
    );
    copyBuiltArtifact(tempRoot, contractsDir, INVOICE_ARTIFACT);
    copyBuiltArtifact(tempRoot, contractsDir, TOKEN_ARTIFACT);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}
