import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { http } from 'wagmi';
import { sepolia } from 'wagmi/chains';
import { tempoModerato } from 'viem/chains';
import { Addresses } from 'viem/tempo';

// Tempo Moderato testnet (chain id 42431) uses USD-denominated TIP-20 fee tokens.
const tempoModeratoChain = tempoModerato.extend({
  feeToken: Addresses.pathUsd,
  // Default Tempo TX-confirmation waits can be too short in wallets; raise the client-side wait.
  blockTime: 30_000,
});

export const config = getDefaultConfig({
  appName: 'EVVM Tempo Deployer',
  projectId: 'b3d3e8a1c7f04e9b8d2a5c6e7f8a9b0c', // Replace with your Reown project ID from https://cloud.reown.com
  chains: [tempoModeratoChain, sepolia],
  ssr: false,
  transports: {
    [tempoModeratoChain.id]: http('https://rpc.moderato.tempo.xyz'),
    [sepolia.id]: http(),
  },
});

export const SUPPORTED_CHAINS = {
  TEMPO_MODERATO: tempoModeratoChain,
  SEPOLIA: sepolia,
} as const;

export const getExplorerUrl = (chainId: number, hash: string, type: 'tx' | 'address' = 'tx'): string => {
  if (chainId === 42431) {
    // https://explore.moderato.tempo.xyz/tx/<hash> and /address/<addr>
    return `https://explore.moderato.tempo.xyz/${type}/${hash}`;
  }

  const explorers: Record<number, string> = {
    11155111: `https://sepolia.etherscan.io/${type}/${hash}`,
  };
  return explorers[chainId] || '#';
};

export const getChainName = (chainId: number): string => {
  const names: Record<number, string> = {
    42431: 'Tempo Moderato',
    11155111: 'Sepolia',
  };
  return names[chainId] || 'Unknown';
};
