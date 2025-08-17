import React, { createContext, useEffect, useState } from "react";

/**
 * MetaMask-based wallet context
 * ------------------------------------------------------------
 * - Keeps the SAME API surface as your original Flow context:
 *   flowAddress, flowBalance, connectFlowWallet, fetchFlowBalance,
 *   refreshFlowBalance, sendFlowTransaction
 * - Uses window.ethereum (MetaMask or compatible).
 */

export const FlowWalletContext = createContext({
  flowAddress: null,
  flowBalance: null,
  connectFlowWallet: async () => {},
  sendFlowTransaction: async () => ({ success: false }),
  fetchFlowBalance: async () => "0.0",
  refreshFlowBalance: async () => null,
});

export const FlowWalletProvider = ({ children }) => {
  const [flowAddress, setFlowAddress] = useState(null); // EVM address (0x...)
  const [flowBalance, setFlowBalance] = useState(null); // string in ETH

  // ---- helpers ----
  const getProvider = () => {
    if (typeof window !== "undefined" && window.ethereum) return window.ethereum;
    console.warn("MetaMask (window.ethereum) not found.");
    return null;
  };

  const hexWeiToEthString = (hexWei) => {
  const wei = parseInt(hexWei, 16);
  return (wei / 1e18).toFixed(4);
};

  // ---- event listeners for account/chain changes ----
  useEffect(() => {
    const provider = getProvider();
    if (!provider) return;

    // Try to read current account without prompting
    provider
      .request({ method: "eth_accounts" })
      .then((accounts) => {
        if (accounts && accounts[0]) {
          setFlowAddress(accounts[0]);
          refreshFlowBalance(accounts[0]);
        }
      })
      .catch(() => {});

    const onAccountsChanged = (accounts) => {
      if (accounts && accounts.length > 0) {
        setFlowAddress(accounts[0]);
        refreshFlowBalance(accounts[0]);
      } else {
        setFlowAddress(null);
        setFlowBalance(null);
      }
    };

    const onChainChanged = () => {
      // Chain changed—refresh balance if we still have an address
      if (flowAddress) refreshFlowBalance(flowAddress);
    };

    provider.on?.("accountsChanged", onAccountsChanged);
    provider.on?.("chainChanged", onChainChanged);

    return () => {
      provider.removeListener?.("accountsChanged", onAccountsChanged);
      provider.removeListener?.("chainChanged", onChainChanged);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Connect MetaMask
  const connectFlowWallet = async () => {
    const provider = getProvider();
    if (!provider) {
      console.error("MetaMask not available.");
      return;
    }
    try {
      const accounts = await provider.request({ method: "eth_requestAccounts" });
      const addr = accounts[0];
      setFlowAddress(addr);
      await refreshFlowBalance(addr);
    } catch (err) {
      console.error("connectFlowWallet error:", err);
    }
  };

  // Query native balance (ETH) for an address
  const fetchFlowBalance = async (address) => {
    const provider = getProvider();
    if (!provider || !address) return "0.0";
    try {
      const weiHex = await provider.request({
        method: "eth_getBalance",
        params: [address, "latest"],
      });
      return hexWeiToEthString(weiHex);
    } catch (err) {
      console.error("fetchFlowBalance error:", err);
      return "0.0";
    }
  };

  // Refresh balance (uses current address if none provided)
  const refreshFlowBalance = async (addr) => {
    const target = addr || flowAddress;
    if (!target) return null;
    const bal = await fetchFlowBalance(target);
    setFlowBalance(bal);
    return bal;
  };

  // Send a simple transaction via MetaMask (0 ETH to self by default)
  // NOTE: This still costs gas on real networks. Adjust 'to' and 'value' as needed.
  const sendFlowTransaction = async () => {
    const provider = getProvider();
    if (!provider || !flowAddress) {
      return { success: false, error: "Wallet not connected." };
    }
    try {
      const txHash = await provider.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: flowAddress,
            to: flowAddress, // no-op self tx; change as needed
            value: "0x0",    // 0 ETH
            data: "0x",      // no data
          },
        ],
      });
      // No "onceSealed" equivalent here; return hash immediately
      return { success: true, txHash };
    } catch (err) {
      console.error("sendFlowTransaction error:", err);
      return { success: false, error: err?.message || String(err) };
    }
  };

  return (
    <FlowWalletContext.Provider
      value={{
        flowAddress,
        flowBalance,
        connectFlowWallet,
        sendFlowTransaction,
        fetchFlowBalance,
        refreshFlowBalance,
      }}
    >
      {children}
    </FlowWalletContext.Provider>
  );
};

// Keep the alias export the same
export { FlowWalletProvider as WalletProvider };
