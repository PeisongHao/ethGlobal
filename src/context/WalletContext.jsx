import React, { createContext, useEffect, useState } from "react";
import * as fcl from "@onflow/fcl";

// Flow Testnet 配置
fcl.config()
  .put("accessNode.api", "https://rest-testnet.onflow.org") // Testnet 节点
  .put("flow.network", "testnet")
//   .put("discovery.wallet", "https://fcl-discovery.onflow.org/testnet/authn"); // 钱包发现服务

export const FlowWalletContext = createContext({
  flowAddress: null,
  flowBalance: null,
  connectFlowWallet: async () => {},
  sendFlowTransaction: async () => ({ success: false }),
  fetchFlowBalance: async () => "0.0",
  refreshFlowBalance: async () => null,
});

export const FlowWalletProvider = ({ children }) => {
  const [flowAddress, setFlowAddress] = useState(null);
  const [flowBalance, setFlowBalance] = useState(null);

  // 监听当前登录用户
  useEffect(() => {
    fcl.currentUser().subscribe((user) => {
      if (user && user.addr) {
        setFlowAddress(user.addr);
        refreshFlowBalance(user.addr);
      } else {
        setFlowAddress(null);
        setFlowBalance(null);
      }
    });
  }, []);

  // 连接 Flow 钱包
  const connectFlowWallet = async () => {
    try {
      await fcl.authenticate();
    } catch (err) {
      console.error("connectFlowWallet error:", err);
    }
  };

  // 查询 Flow 原生币余额
  const fetchFlowBalance = async (address) => {
    try {
      const script = `
        import FungibleToken from 0x9a0766d93b6608b7
        import FlowToken from 0x7e60df042a9c0868

        // 查询余额（可能为 nil：未初始化或未暴露能力）
        access(all) fun main(account: Address): UFix64? {
            let cap: Capability<&{FungibleToken.Balance}> =
                getAccount(account)
                    .capabilities
                    .get<&{FungibleToken.Balance}>(/public/flowTokenBalance)

            let ref = cap.borrow()
            if ref == nil { return nil }
            return ref!.balance
        }
      `;
      const res = await fcl.query({
        cadence: script,
        args: (arg, t) => [arg(address, t.Address)]
      });
      return res;
    } catch (err) {
      console.error("fetchFlowBalance error:", err);
      return "0.0";
    }
  };

  // 刷新余额
  const refreshFlowBalance = async (addr) => {
    const target = addr || flowAddress;
    if (!target) return null;
    const bal = await fetchFlowBalance(target);
    setFlowBalance(bal);
    return bal;
  };

  // 发送简单的交易（示例）
  const sendFlowTransaction = async () => {
    try {
      const txId = await fcl.mutate({
        cadence: `
          transaction {
            prepare(acct: AuthAccount) {
              log("Signed by: ".concat(acct.address.toString()))
            }
          }
        `,
        proposer: fcl.currentUser,
        payer: fcl.currentUser,
        authorizations: [fcl.currentUser],
        limit: 50
      });
      const sealed = await fcl.tx(txId).onceSealed();
      return { success: true, txHash: sealed.transactionId };
    } catch (err) {
      console.error("sendFlowTransaction error:", err);
      return { success: false, error: err.message };
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

export { FlowWalletProvider as WalletProvider };
