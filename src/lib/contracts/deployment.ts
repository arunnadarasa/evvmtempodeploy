import { type WalletClient, type PublicClient, type Hash, type Address, createPublicClient, http } from 'viem';
import { sepolia } from 'wagmi/chains';
import {
  StakingABI,
  NameServiceABI,
  EstimatorABI,
  P2PSwapABI,
} from '@evvm/viem-signature-library';
import {
  STAKING_BYTECODE,
  EVVM_CORE_BYTECODE,
  CORE_HASH_UTILS_BYTECODE,
  EVVM_CORE_LINK_REFERENCES,
  NAME_SERVICE_BYTECODE,
  ESTIMATOR_BYTECODE,
  TREASURY_BYTECODE,
  P2P_SWAP_BYTECODE,
} from './bytecodes';

const REGISTRY_EVM_SEPOLIA_ADDRESS =
  '0x389dC8fb09211bbDA841D59f4a51160dA2377832' as Address;

const TEMPO_MODERATO_CHAIN_ID = 42431 as const;

const RegistryEvvmABI = [
  {
    type: 'function',
    name: 'registerEvvm',
    inputs: [
      { name: 'hostChainId', type: 'uint256', internalType: 'uint256' },
      { name: 'evvmAddress', type: 'address', internalType: 'address' },
    ],
    outputs: [{ name: 'evvmId', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'nonpayable',
  },
] as const;

export type DeploymentStage =
  | 'idle'
  | 'deploying-staking'
  | 'deploying-core'
  | 'deploying-nameservice'
  | 'deploying-estimator'
  | 'initializing-staking'
  | 'initializing-core'
  | 'deploying-treasury'
  | 'deploying-p2pswap'
  | 'deployment-complete'
  | 'switching-to-sepolia'
  | 'registering'
  | 'switching-back'
  | 'configuring-evvm-id'
  | 'complete'
  | 'failed';

export interface DeploymentProgress {
  stage: DeploymentStage;
  message: string;
  txHash?: string;
  step: number;
  totalSteps: number;
}

export interface DeploymentConfig {
  adminAddress: Address;
  goldenFisherAddress: Address;
  activatorAddress: Address;
  evvmName: string;
  principalTokenName: string;
  principalTokenSymbol: string;
  totalSupply: bigint;
  eraTokens: bigint;
  rewardPerOperation: bigint;
}

export interface ContractAddresses {
  staking?: Address;
  evvmCore?: Address;
  nameService?: Address;
  estimator?: Address;
  treasury?: Address;
  p2pSwap?: Address;
  evvmId?: bigint;
}

const CoreABI = [
  {
    type: 'constructor',
    inputs: [
      { name: '_initialOwner', type: 'address', internalType: 'address' },
      {
        name: '_stakingContractAddress',
        type: 'address',
        internalType: 'address',
      },
      {
        name: '_evvmMetadata',
        type: 'tuple',
        internalType: 'struct CoreStructs.EvvmMetadata',
        components: [
          { name: 'EvvmName', type: 'string', internalType: 'string' },
          { name: 'EvvmID', type: 'uint256', internalType: 'uint256' },
          { name: 'principalTokenName', type: 'string', internalType: 'string' },
          { name: 'principalTokenSymbol', type: 'string', internalType: 'string' },
          { name: 'principalTokenAddress', type: 'address', internalType: 'address' },
          { name: 'totalSupply', type: 'uint256', internalType: 'uint256' },
          { name: 'eraTokens', type: 'uint256', internalType: 'uint256' },
          { name: 'reward', type: 'uint256', internalType: 'uint256' },
        ],
      },
    ],
    stateMutability: 'nonpayable',
  },
] as const;

const TreasuryABI = [
  {
    type: 'constructor',
    inputs: [{ name: '_coreAddress', type: 'address', internalType: 'address' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getCoreAddress',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
] as const;

const StakingInitializeSystemContractsABI = [
  {
    type: 'function',
    name: 'initializeSystemContracts',
    inputs: [
      { name: '_estimator', type: 'address', internalType: 'address' },
      { name: '_core', type: 'address', internalType: 'address' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

const CoreInitializeSystemContractsABI = [
  {
    type: 'function',
    name: 'initializeSystemContracts',
    inputs: [
      { name: '_nameServiceAddress', type: 'address', internalType: 'address' },
      { name: '_treasuryAddress', type: 'address', internalType: 'address' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

async function deployContractWithRetry(
  walletClient: WalletClient,
  publicClient: PublicClient,
  params: { abi: any; bytecode: `0x${string}`; args: any[] },
  maxRetries: number = 3
): Promise<{ address: Address; txHash: Hash }> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const hash = await walletClient.deployContract({
        abi: params.abi,
        bytecode: params.bytecode,
        args: params.args,
        account: walletClient.account!,
        chain: walletClient.chain,
      });

      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        timeout: 120_000,
      });

      if (receipt.status === 'reverted') {
        throw new Error('Deployment transaction reverted');
      }

      if (!receipt.contractAddress) {
        throw new Error('No contract address in receipt');
      }

      // Some Tempo RPCs may return empty `eth_getCode` even when txs succeeded.
      // Tempo Moderato: prioritize tx receipt success over eth_getCode verification.
      const shouldVerifyBytecode = walletClient.chain?.id !== TEMPO_MODERATO_CHAIN_ID;
      if (shouldVerifyBytecode) {
        // Verify bytecode exists (some RPCs lag right after mining).
        let code: `0x${string}` | undefined;
        for (let i = 0; i < 8; i++) {
          // Some RPC providers reject eth_getCode(address, blockNumber) as "invalid params".
          // We poll "latest" instead to confirm the contract shows up.
          code = await publicClient.getCode({ address: receipt.contractAddress });
          if (code && code !== '0x') break;
          await new Promise((r) => setTimeout(r, 500 * (i + 1)));
        }
        if (!code || code === '0x') {
          throw new Error('Contract bytecode verification failed (RPC may be lagging)');
        }
      }

      return { address: receipt.contractAddress, txHash: hash };
    } catch (error) {
      if (attempt >= maxRetries) throw error;
      await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
    }
  }
  throw new Error('Deployment failed after retries');
}

function linkBytecode(
  bytecode: `0x${string}`,
  libraryAddress: Address,
  refs: Array<{ start: number; length: number }>
): `0x${string}` {
  const addr = libraryAddress.toLowerCase().replace(/^0x/, '');
  if (addr.length !== 40) {
    throw new Error(`Invalid library address length: ${libraryAddress}`);
  }

  let hex = bytecode.replace(/^0x/, '');
  for (const { start, length } of refs) {
    const offset = start * 2;
    const replaceLen = length * 2;
    hex = hex.slice(0, offset) + addr + hex.slice(offset + replaceLen);
  }
  return `0x${hex}` as `0x${string}`;
}

export async function deployEVVMContracts(
  config: DeploymentConfig,
  walletClient: WalletClient,
  publicClient: PublicClient,
  onProgress: (progress: DeploymentProgress) => void
): Promise<ContractAddresses> {
  const addresses: ContractAddresses = {};
  const totalSteps = 9;

  // Step 1: Deploy Staking
  onProgress({ stage: 'deploying-staking', message: 'Deploying Staking contract...', step: 1, totalSteps });
  const staking = await deployContractWithRetry(walletClient, publicClient, {
    abi: StakingABI,
    bytecode: STAKING_BYTECODE,
    args: [config.adminAddress, config.goldenFisherAddress],
  });
  addresses.staking = staking.address;
  onProgress({ stage: 'deploying-staking', message: 'Staking deployed', txHash: staking.txHash, step: 1, totalSteps });

  // Step 2: Deploy EVVM Core
  onProgress({ stage: 'deploying-core', message: 'Deploying EVVM Core contract...', step: 2, totalSteps });
  const evvmMetadata = {
    EvvmName: config.evvmName,
    EvvmID: 0n,
    principalTokenName: config.principalTokenName,
    principalTokenSymbol: config.principalTokenSymbol,
    // Matches Tempo's BaseInputs.sol placeholder (0x...01).
    principalTokenAddress: '0x0000000000000000000000000000000000000001' as Address,
    totalSupply: config.totalSupply,
    eraTokens: config.eraTokens,
    reward: config.rewardPerOperation,
  } as const;

  // Core bytecode needs linking for CoreHashUtils (Solidity library).
  const coreHashUtilsRefs =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((EVVM_CORE_LINK_REFERENCES as any)?.['src/library/utils/signature/CoreHashUtils.sol']?.CoreHashUtils as
      | Array<{ start: number; length: number }>
      | undefined) ?? [];

  if (coreHashUtilsRefs.length === 0) {
    throw new Error('Missing CoreHashUtils link references for Core bytecode');
  }

  onProgress({ stage: 'deploying-core', message: 'Deploying CoreHashUtils library...', step: 2, totalSteps });
  const coreHashUtils = await deployContractWithRetry(walletClient, publicClient, {
    abi: [],
    bytecode: CORE_HASH_UTILS_BYTECODE,
    args: [],
  });

  const linkedCoreBytecode = linkBytecode(
    EVVM_CORE_BYTECODE,
    coreHashUtils.address,
    coreHashUtilsRefs
  );

  const core = await deployContractWithRetry(walletClient, publicClient, {
    abi: CoreABI,
    bytecode: linkedCoreBytecode,
    args: [config.adminAddress, addresses.staking, evvmMetadata],
  });
  addresses.evvmCore = core.address;
  onProgress({ stage: 'deploying-core', message: 'EVVM Core deployed', txHash: core.txHash, step: 2, totalSteps });

  // Step 3: Deploy Estimator
  onProgress({ stage: 'deploying-estimator', message: 'Deploying Estimator contract...', step: 3, totalSteps });
  const estimator = await deployContractWithRetry(walletClient, publicClient, {
    abi: EstimatorABI,
    bytecode: ESTIMATOR_BYTECODE,
    args: [config.activatorAddress, addresses.evvmCore, addresses.staking, config.adminAddress],
  });
  addresses.estimator = estimator.address;
  onProgress({ stage: 'deploying-estimator', message: 'Estimator deployed', txHash: estimator.txHash, step: 3, totalSteps });

  // Step 4: Deploy NameService
  onProgress({ stage: 'deploying-nameservice', message: 'Deploying NameService contract...', step: 4, totalSteps });
  const nameService = await deployContractWithRetry(walletClient, publicClient, {
    abi: NameServiceABI,
    bytecode: NAME_SERVICE_BYTECODE,
    args: [addresses.evvmCore, config.adminAddress],
  });
  addresses.nameService = nameService.address;
  onProgress({ stage: 'deploying-nameservice', message: 'NameService deployed', txHash: nameService.txHash, step: 4, totalSteps });

  // Step 5: staking.initializeSystemContracts(estimator, core)
  onProgress({ stage: 'initializing-staking', message: 'Initializing Staking system contracts...', step: 5, totalSteps });
  const initStakingTxHash = await walletClient.writeContract({
    address: addresses.staking!,
    abi: StakingInitializeSystemContractsABI,
    functionName: 'initializeSystemContracts',
    args: [addresses.estimator!, addresses.evvmCore!],
    account: walletClient.account!,
    chain: walletClient.chain,
  });
  const initStakingReceipt = await publicClient.waitForTransactionReceipt({ hash: initStakingTxHash, timeout: 120_000 });
  if (initStakingReceipt.status === 'reverted') {
    throw new Error('Staking initializeSystemContracts transaction reverted');
  }
  onProgress({
    stage: 'initializing-staking',
    message: 'Staking initialized',
    txHash: initStakingTxHash,
    step: 5,
    totalSteps,
  });

  // Step 6: Deploy Treasury
  onProgress({ stage: 'deploying-treasury', message: 'Deploying Treasury contract...', step: 6, totalSteps });
  const treasury = await deployContractWithRetry(walletClient, publicClient, {
    abi: TreasuryABI,
    bytecode: TREASURY_BYTECODE,
    args: [addresses.evvmCore],
  });
  addresses.treasury = treasury.address;
  onProgress({ stage: 'deploying-treasury', message: 'Treasury deployed', txHash: treasury.txHash, step: 6, totalSteps });

  // Step 7: core.initializeSystemContracts(nameService, treasury)
  onProgress({ stage: 'initializing-core', message: 'Initializing Core system contracts...', step: 7, totalSteps });
  const initCoreTxHash = await walletClient.writeContract({
    address: addresses.evvmCore!,
    abi: CoreInitializeSystemContractsABI,
    functionName: 'initializeSystemContracts',
    args: [addresses.nameService!, addresses.treasury!],
    account: walletClient.account!,
    chain: walletClient.chain,
  });
  const initCoreReceipt = await publicClient.waitForTransactionReceipt({ hash: initCoreTxHash, timeout: 120_000 });
  if (initCoreReceipt.status === 'reverted') {
    throw new Error('Core initializeSystemContracts transaction reverted');
  }
  onProgress({
    stage: 'initializing-core',
    message: 'Core initialized',
    txHash: initCoreTxHash,
    step: 7,
    totalSteps,
  });

  // Step 8: Deploy P2PSwap
  onProgress({ stage: 'deploying-p2pswap', message: 'Deploying P2PSwap contract...', step: 8, totalSteps });
  const p2pSwap = await deployContractWithRetry(walletClient, publicClient, {
    abi: P2PSwapABI,
    bytecode: P2P_SWAP_BYTECODE,
    args: [addresses.evvmCore, addresses.staking, config.adminAddress],
  });
  addresses.p2pSwap = p2pSwap.address;
  onProgress({ stage: 'deploying-p2pswap', message: 'P2PSwap deployed', txHash: p2pSwap.txHash, step: 8, totalSteps });

  // Step 9: Register EVVM on Ethereum Sepolia Registry
  const hostChainId = walletClient.chain?.id ?? TEMPO_MODERATO_CHAIN_ID;
  onProgress({ stage: 'switching-to-sepolia', message: 'Switching to Ethereum Sepolia for registry registration...', step: 9, totalSteps });

  await walletClient.switchChain?.({ id: sepolia.id });

  const sepoliaPublicClient = createPublicClient({
    chain: sepolia,
    transport: http(),
  });

  onProgress({ stage: 'registering', message: 'Registering EVVM instance on Sepolia registry...', step: 9, totalSteps });
  const sim = await sepoliaPublicClient.simulateContract({
    address: REGISTRY_EVM_SEPOLIA_ADDRESS,
    abi: RegistryEvvmABI,
    functionName: 'registerEvvm',
    args: [BigInt(hostChainId), addresses.evvmCore],
    account: walletClient.account!,
  });

  const evvmId = sim.result;
  const regTxHash = await walletClient.writeContract({
    ...sim.request,
    account: walletClient.account!,
    chain: sepolia,
  } as any);

  const regReceipt = await sepoliaPublicClient.waitForTransactionReceipt({
    hash: regTxHash,
    timeout: 120_000,
  });
  if (regReceipt.status === 'reverted') {
    throw new Error('Registry registration transaction reverted');
  }

  addresses.evvmId = evvmId;
  onProgress({
    stage: 'registering',
    message: `EVVM registered on Sepolia (ID: ${evvmId.toString()})`,
    txHash: regTxHash,
    step: 9,
    totalSteps,
  });

  onProgress({ stage: 'switching-back', message: 'Switching back to Tempo Moderato...', step: 9, totalSteps });
  await walletClient.switchChain?.({ id: TEMPO_MODERATO_CHAIN_ID });

  onProgress({ stage: 'deployment-complete', message: 'All contracts deployed and registered!', step: 9, totalSteps });

  return addresses;
}
