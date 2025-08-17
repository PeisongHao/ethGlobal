import React, { useState } from "react"
import { BrowserProvider, Contract, parseUnits, formatUnits } from "ethers"

// ------- 常量配置 -------
const FLOW_EVM_TESTNET = {
  chainIdHex: "0x221", // 545
  params: {
    chainId: "0x221",
    chainName: "Flow EVM Testnet",
    nativeCurrency: { name: "FLOW", symbol: "FLOW", decimals: 18 },
    rpcUrls: ["https://testnet.evm.nodes.onflow.org"],
    blockExplorerUrls: ["https://evm-testnet.flowscan.io"],
  },
}

const PAIR_ADDRESS = process.env.REACT_APP_CONTRACT_ADDRESS || "0xf7d7281a9CA59F63D47008bBd89D06Fb806D9ac8"

// 你的 Pair 合约 ABI（只放用到的方法）
const PAIR_ABI = [
  "function swap(uint256 amountIn, address tokenIn, uint256 amountOutMin) returns (uint256 amountOut, address tokenOut)",
  "event Swap(address indexed sender, uint256 amountIn, address tokenIn, uint256 amountOut, address tokenOut)"
]

// 最小的 ERC20 ABI
const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function approve(address spender, uint256 value) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)"
]

// ------- 网络辅助 -------
async function ensureFlowTestnet() {
  if (!window.ethereum) throw new Error("No wallet detected.")
  const current = await window.ethereum.request({ method: "eth_chainId" })
  if (current !== FLOW_EVM_TESTNET.chainIdHex) {
    try {
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: FLOW_EVM_TESTNET.chainIdHex }] })
    } catch (e) {
      // 未添加则添加
      await window.ethereum.request({ method: "wallet_addEthereumChain", params: [FLOW_EVM_TESTNET.params] })
    }
  }
}

export default function BuySellPanel({ tokenId, unitPriceXrp, unitPriceUsd, onSubmitted }) {
  const [mode, setMode] = useState(null)
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  const parsedAmt = Number(amount) || 0

  const close = () => {
    setOpen(false)
    setMode(null)
    setAmount("")
    setError("")
  }

  const onClick = (m) => {
    setMode(m)
    setOpen(true)
  }

  const submit = async () => {
    try {
      if (!parsedAmt || parsedAmt <= 0) {
        setError("Please enter a valid amount.")
        return
      }
      setSubmitting(true)
      setError("")

      // 1) 钱包 & 网络
      await ensureFlowTestnet()
      const provider = new BrowserProvider(window.ethereum)
      const signer = await provider.getSigner()
      const user = await signer.getAddress()

      // 2) 选择 tokenIn（你需求里指定的两个地址）
      const tokenIn =
        mode === "buy"
          ? "0xd9a7ebca0a89a243d60333Ae06079e5d5d271568"
          : "0x3f44Bd6B6A8a2c6443ddDa37Dc6AB00752e55c4F"

      // 3) 读取 decimals，并把输入解析成链上单位
      const erc20 = new Contract(tokenIn, ERC20_ABI, provider)
      const decimals = await erc20.decimals()
      const amountIn = parseUnits(String(parsedAmt), decimals)

      // 4) 检查余额（可选，但更友好）
      const bal = await erc20.balanceOf(user)
      if (bal < amountIn) {
        throw new Error("Insufficient balance of tokenIn.")
      }

      // 5) allowance/approve
      const allowance = await erc20.allowance(user, PAIR_ADDRESS)
      if (allowance < amountIn) {
        const erc20WithSigner = erc20.connect(signer)
        const txA = await erc20WithSigner.approve(PAIR_ADDRESS, amountIn)
        await txA.wait()
      }

      // 6) 调用 swap(amountIn, tokenIn, 0)
      const pair = new Contract(PAIR_ADDRESS, PAIR_ABI, signer)
      const tx = await pair.swap(amountIn, tokenIn, 0) // amountOutMin = 0
      const receipt = await tx.wait()

      // 7)（可选）从事件里解析实际成交
      let outQty = null
      try {
        const swapLog = receipt.logs
          .map((l) => {
            try { return pair.interface.parseLog(l) } catch { return null }
          })
          .filter(Boolean)
          .find((ev) => ev.name === "Swap")

        if (swapLog) {
          const { amountIn: evIn, tokenIn: evTokenIn, amountOut, tokenOut } = swapLog.args
          outQty = { amountOut: amountOut?.toString?.(), tokenOut }
        }
      } catch {}

      // 8) 更新 UI（回调）
      const nowIso = new Date().toISOString()
      onSubmitted?.(
        {
          token: tokenId,
          side: mode === "buy" ? "Buy" : "Sell",
          amount: parsedAmt,               // 用户输入数量（人类可读）
          value: parsedAmt * (unitPriceXrp || 0),
          status: "Filled",
          time: nowIso,
          quantity: parsedAmt,
          unitPrice: unitPriceXrp,
          onchainTx: receipt?.hash,
          onchainOut: outQty,
        },
        unitPriceXrp
      )

      close()
    } catch (e) {
      console.error(e)
      setError(e?.reason || e?.message || "Submission failed")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="w-full">
      <div className="grid grid-cols-2 gap-3">
        <button
          className="w-full px-4 py-3 rounded-xl shadow text-white font-semibold bg-[#00a300] hover:opacity-90 active:opacity-80 transition"
          onClick={() => onClick("buy")}
        >
          Buy
        </button>
        <button
          className="w-full px-4 py-3 rounded-xl shadow text-white font-semibold bg-red-600 hover:opacity-90 active:opacity-80 transition"
          onClick={() => onClick("sell")}
        >
          Sell
        </button>
      </div>

      <Modal open={open} onClose={close} title={mode === "buy" ? "Buy Tokens" : "Sell Tokens"}>
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm text-gray-600">
            <span>Unit Price</span>
            <span className="font-medium">
              {Number.isFinite(unitPriceXrp) ? unitPriceXrp.toFixed(6) : "—"} Flow{" "}
              {Number.isFinite(unitPriceUsd) ? `(~$${unitPriceUsd.toFixed(4)})` : ""}
            </span>
          </div>

          <div>
            <label className="block text-sm text-gray-600 mb-1">Amount</label>
            <input
              type="number"
              min="0"
              step="0.000001"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-black/10"
              placeholder="Enter amount"
            />
          </div>

          <div className="rounded-lg bg-gray-50 p-3 text-sm">
            <div className="flex items-center justify-between">
              <span>Total (Flow)</span>
              <span className="font-semibold">
                {Number.isFinite(parsedAmt * (unitPriceXrp || 0))
                  ? (parsedAmt * (unitPriceXrp || 0)).toFixed(6)
                  : "—"}
              </span>
            </div>
            <div className="flex items-center justify-between mt-1">
              <span>Total (USD)</span>
              <span className="font-semibold">
                {Number.isFinite(parsedAmt * (unitPriceUsd || 0))
                  ? `$${(parsedAmt * (unitPriceUsd || 0)).toFixed(4)}`
                  : "—"}
              </span>
            </div>
          </div>

          {error ? <p className="text-sm text-red-600 break-all">{error}</p> : null}

          <div className="flex gap-3 pt-2">
            <button
              className="flex-1 px-4 py-2 rounded-lg border border-gray-300 hover:bg-gray-50 transition"
              onClick={close}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              className={`flex-1 px-4 py-2 rounded-lg text-white font-semibold transition ${
                mode === "buy" ? "bg-[#00a300]" : "bg-red-600"
              } ${submitting ? "opacity-70" : "hover:opacity-90 active:opacity-80"}`}
              onClick={submit}
              disabled={submitting}
            >
              {submitting ? "Processing..." : mode === "buy" ? "Confirm Buy" : "Confirm Sell"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

/* ───────────────────────────── 简易 Modal 组件（无依赖） ───────────────────────────── */
function Modal({ open, onClose, title, children }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[60]">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <h3 className="text-base font-semibold">{title}</h3>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
          <div className="p-4">{children}</div>
        </div>
      </div>
    </div>
  )
}
