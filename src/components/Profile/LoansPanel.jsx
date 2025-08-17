// LoansPanelBackend.jsx (frontend-only, ethers v6, Flow EVM Testnet)
import React, { useEffect, useMemo, useState } from "react"
import { BrowserProvider, JsonRpcProvider, Contract, Interface, formatUnits, id as keccakTopic } from "ethers"

// ---------- ENV & 常量 ----------
const RPC_URL = process.env.REACT_APP_RPC_URL || "https://testnet.evm.nodes.onflow.org"
const LOAN_CONTRACT = (process.env.REACT_APP_LOAN_CONTRACT || "").trim()
const LOOKBACK_BLOCKS = Number(process.env.REACT_APP_LOOKBACK_BLOCKS || 45000)
const LOAN_DECIMALS = Number(process.env.REACT_APP_LOAN_DECIMALS || 18)

// 事件签名（可在 .env 调整为你合约的真实签名）
const EV_CREATED_SIG = process.env.REACT_APP_EVENT_CREATED || "LoanCreated(uint256,address,uint256,address,uint256,uint256)"
const EV_REPAID_SIG  = process.env.REACT_APP_EVENT_REPAID  || "LoanRepaid(uint256,address,uint256,uint256)"

const EXPLORER = "https://evm-testnet.flowscan.io"
const EVM_FLOW_TESTNET_CHAIN_HEX = "0x221"

// ABI：只放用到的事件/函数（按需修改）
const LOAN_ABI = [
  `event ${EV_CREATED_SIG}`, // LoanCreated(index, borrower, amount, collateralToken, collateralAmount, timestamp)
  `event ${EV_REPAID_SIG}`,  // LoanRepaid(index, borrower, amount, timestamp)
  "function repay(uint256 index) external"
]

// ---------- 小工具 ----------
const fmtISO = (ts) => new Date(Number(ts) * 1000).toISOString().replace(".000", "")
const fmtBig = (v) => (typeof v === "bigint" ? v.toString() : String(v))
const shorten = (s) => (s?.length > 12 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s)
const humanizeDuration = (fromSec, toSec = Math.floor(Date.now() / 1000)) => {
  let delta = Math.max(0, toSec - Number(fromSec || 0))
  const d = Math.floor(delta / 86400); delta -= d * 86400
  const h = Math.floor(delta / 3600);  delta -= h * 3600
  const m = Math.floor(delta / 60)
  return `${d}d ${h}h ${m}m`
}

// 分段抓 logs，避免 10k 限制
async function fetchLogsChunked(provider, baseFilter, fromBlock, toBlock, step = 9000) {
  const logs = []
  let start = fromBlock
  while (start <= toBlock) {
    const end = Math.min(start + step, toBlock)
    const chunk = await provider.getLogs({ ...baseFilter, fromBlock: start, toBlock: end })
    logs.push(...chunk)
    start = end + 1
  }
  return logs
}

// 保证在 Flow EVM Testnet
async function ensureFlowEvm() {
  if (!window.ethereum) throw new Error("No wallet detected. Please install MetaMask.")
  const chainId = await window.ethereum.request({ method: "eth_chainId" })
  if (chainId !== EVM_FLOW_TESTNET_CHAIN_HEX) {
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: EVM_FLOW_TESTNET_CHAIN_HEX }],
      })
    } catch (e) {
      // 未添加则添加
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: EVM_FLOW_TESTNET_CHAIN_HEX,
          chainName: "Flow EVM Testnet",
          nativeCurrency: { name: "FLOW", symbol: "FLOW", decimals: 18 },
          rpcUrls: [RPC_URL],
          blockExplorerUrls: [EXPLORER]
        }]
      })
    }
  }
}

// ---------- 组件 ----------
export default function LoansPanel() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [rows, setRows] = useState([])

  const [showModal, setShowModal] = useState(false)
  const [currentLoan, setCurrentLoan] = useState(null)
  const [modalState, setModalState] = useState("idle") // idle | submitting | success
  const [modalMsg, setModalMsg] = useState("")
  const [walletAddress, setWalletAddress] = useState("")

  // 连接钱包（简单版）
  useEffect(() => {
    let stopped = false
    async function connect() {
      try {
        if (!window.ethereum) return
        const accs = await window.ethereum.request({ method: "eth_accounts" })
        if (accs && accs[0] && !stopped) setWalletAddress(accs[0])
        // 监听账户/链变化
        window.ethereum.on?.("accountsChanged", (a) => setWalletAddress(a?.[0] || ""))
        window.ethereum.on?.("chainChanged", () => window.location.reload())
      } catch {}
    }
    connect()
    return () => { stopped = true }
  }, [])

  // 抓“当前钱包”的历史（事件）
  async function fetchLoans() {
    if (!LOAN_CONTRACT) {
      setError("Please set REACT_APP_LOAN_CONTRACT in .env")
      setRows([])
      return
    }
    setLoading(true)
    setError("")

    try {
      const provider = new JsonRpcProvider(RPC_URL)
      const code = await provider.getCode(LOAN_CONTRACT)
      if (!code || code === "0x") throw new Error(`No contract code at ${LOAN_CONTRACT}`)

      const tip = await provider.getBlockNumber()
      const fromBlock = Math.max(0, tip - LOOKBACK_BLOCKS)

      const createdTopic0 = keccakTopic(EV_CREATED_SIG)
      const repaidTopic0  = keccakTopic(EV_REPAID_SIG)

      const base = { address: LOAN_CONTRACT }
      const createdLogs = await fetchLogsChunked(provider, { ...base, topics: [createdTopic0] }, fromBlock, tip, 9000)
      const repaidLogs  = await fetchLogsChunked(provider, { ...base, topics: [repaidTopic0]  }, fromBlock, tip, 9000)

      const iface = new Interface(LOAN_ABI)

      // 组装 created — 仅保留“属于当前钱包”的
      const map = new Map() // index -> loan
      for (const lg of createdLogs) {
        let ev
        try { ev = iface.parseLog(lg) } catch { continue }
        // 兼容不同参数名的 ABI：按顺序取
        const [index, borrower, amount, collateralToken, collateralAmount, ts] = ev.args

        // ✅ 关键：只保留“当前钱包地址”的借贷
        if (walletAddress && String(borrower).toLowerCase() !== walletAddress.toLowerCase()) {
          continue
        }

        // 取事件时间（优先区块时间；若事件自带 timestamp 也可用）
        const block = await provider.getBlock(lg.blockNumber)
        const createdAt = block?.timestamp || Number(ts || 0)

        const principal = parseFloat(formatUnits(amount, LOAN_DECIMALS))
        const collAmt   = collateralAmount != null ? fmtBig(collateralAmount) : "0"

        map.set(Number(index), {
          index: Number(index),
          borrower: String(borrower),
          amount: principal,                 // 人类可读金额（按 LOAN_DECIMALS）
          timestamp: Number(createdAt),
          iso: fmtISO(createdAt),
          repaid: false,
          collateralToken: collateralToken ? String(collateralToken) : "-",
          collateralAmount: collAmt,
          txHashCreated: lg.transactionHash,
        })
      }

      // 标记 repaid（同样只影响当前钱包的）
      for (const lg of repaidLogs) {
        let ev
        try { ev = iface.parseLog(lg) } catch { continue }
        const [index, borrower] = ev.args
        if (walletAddress && String(borrower).toLowerCase() !== walletAddress.toLowerCase()) {
          continue
        }
        const item = map.get(Number(index))
        if (item) item.repaid = true
      }

      const list = Array.from(map.values()).sort((a, b) => b.timestamp - a.timestamp)
      setRows(list)
    } catch (e) {
      setError(e?.message || String(e))
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchLoans() }, [walletAddress])

  const active = rows.filter((r) => !r.repaid)
  const done   = rows.filter((r) =>  r.repaid)

  // 打开弹窗（金额显示为本金；如你的合约需要应还利息，请在后端或合约里计算）
  const openRepay = (loan) => {
    setCurrentLoan(loan)
    setModalState("idle")
    setModalMsg("")
    setShowModal(true)
  }

  const closeModal = () => {
    if (modalState === "submitting") return
    setShowModal(false)
    setCurrentLoan(null)
    setModalMsg("")
  }

  // 还款：调用 repay(index)
  const confirmRepay = async () => {
    if (!currentLoan) return
    try {
      setModalState("submitting")
      setModalMsg("")

      await ensureFlowEvm()
      const provider = new BrowserProvider(window.ethereum)
      const signer = await provider.getSigner()

      const loan = new Contract(LOAN_CONTRACT, LOAN_ABI, signer)
      const tx = await loan.repay(currentLoan.index) // 如你的合约签名不同，请在 LOAN_ABI 中调整
      await tx.wait()

      setModalState("success")
      setModalMsg("Repayment submitted. It may take a few minutes to finalize.")

      // 刷新列表
      await fetchLoans()
    } catch (e) {
      setModalState("idle")
      setModalMsg(e?.reason || e?.message || String(e))
    }
  }

  // ———————————— UI ————————————
  return (
    <div className="w-full max-w-4xl mx-auto">
      <div className="mb-4 flex items-center gap-3">
        <h2 className="text-xl font-semibold">
          My Loans <span className="text-sm text-neutral-500">(Wallet: <span className="font-mono">{shorten(walletAddress) || "—"}</span>)</span>
        </h2>
        <button
          onClick={fetchLoans}
          disabled={loading}
          className={`px-3 py-1 rounded-md text-sm font-semibold text-white ${
            loading
              ? "bg-neutral-400"
              : "bg-gradient-to-r from-[#ff7700] to-[#ff03b8] hover:brightness-110"
          }`}
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {/* 顶部统计 */}
      <div className="mb-4 text-sm text-neutral-700">
        <span className="mr-4">Active: <b>{active.length}</b></span>
        <span>Repaid: <b>{done.length}</b></span>
      </div>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Active */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-lg font-semibold">Active (Unpaid)</h3>
          <span className="text-sm text-neutral-500">{active.length} item(s)</span>
        </div>
        {active.length === 0 ? (
          <div className="rounded-lg border border-neutral-200 p-4 text-sm text-neutral-500">
            No active loans for this wallet.
          </div>
        ) : (
          <ul className="space-y-3">
            {active.map((r) => (
              <li
                key={`active-${r.index}`}
                className="rounded-xl border border-neutral-200 p-4 flex items-center justify-between"
              >
                <div>
                  <div className="text-sm text-neutral-500">Index #{r.index}</div>
                  <div className="text-base font-semibold">
                    Principal: <span className="font-mono">{fmtBig(r.amount)}</span>
                  </div>
                  <div className="text-sm text-neutral-600">Created: {r.iso}</div>
                  <div className="text-sm text-neutral-600">
                    Age: <span className="font-mono">{humanizeDuration(r.timestamp)}</span>
                  </div>
                  <div className="text-sm text-neutral-600">
                    Collateral: <span className="font-mono">{r.collateralToken || "-"}</span>
                    &nbsp;|&nbsp;Amt: <span className="font-mono">{fmtBig(r.collateralAmount)}</span>
                  </div>
                  {r.txHashCreated && (
                    <div className="text-sm">
                      <a
                        href={`${EXPLORER}/tx/${r.txHashCreated}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-600 hover:underline"
                      >
                        View Tx
                      </a>
                    </div>
                  )}
                </div>

                <button
                  onClick={() => openRepay(r)}
                  className="min-w-[120px] rounded-md px-4 py-2 text-sm font-semibold text-white bg-gradient-to-r from-[#ff7700] to-[#ff03b8] hover:brightness-110"
                >
                  Repay
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Repaid */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-lg font-semibold">Repaid</h3>
          <span className="text-sm text-neutral-500">{done.length} item(s)</span>
        </div>
        {done.length === 0 ? (
          <div className="rounded-lg border border-neutral-200 p-4 text-sm text-neutral-500">
            No repaid loans yet.
          </div>
        ) : (
          <ul className="space-y-3">
            {done.map((r) => (
              <li key={`done-${r.index}`} className="rounded-xl border border-neutral-200 p-4">
                <div className="text-sm text-neutral-500">Index #{r.index}</div>
                <div className="text-base font-semibold">
                  Principal: <span className="font-mono">{fmtBig(r.amount)}</span>
                </div>
                <div className="text-sm text-neutral-600">Created: {r.iso}</div>
                <div className="text-sm text-neutral-600">
                  Collateral: <span className="font-mono">{r.collateralToken || "-"}</span>
                  &nbsp;|&nbsp;Amt: <span className="font-mono">{fmtBig(r.collateralAmount)}</span>
                </div>
                {r.txHashCreated && (
                  <div className="text-sm">
                    <a
                      href={`${EXPLORER}/tx/${r.txHashCreated}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-600 hover:underline"
                    >
                      View Tx
                    </a>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Repay Modal（金额显示为本金） */}
      {showModal && currentLoan && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => { if (modalState !== "submitting") closeModal() }}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {modalState !== "success" ? (
              <>
                <div className="flex items-start justify-between">
                  <h2 className="text-xl font-semibold text-neutral-900">
                    Repay Loan #{currentLoan.index}
                  </h2>
                  <button
                    onClick={closeModal}
                    className="rounded-md px-2 py-1 text-neutral-500 hover:bg-neutral-100"
                    aria-label="Close"
                    disabled={modalState === "submitting"}
                  >
                    ✕
                  </button>
                </div>

                <div className="mt-4 space-y-2 text-sm text-neutral-700">
                  <div className="flex justify-between">
                    <span>Created:</span>
                    <span className="font-mono">{currentLoan.iso}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Age:</span>
                    <span className="font-mono">{humanizeDuration(currentLoan.timestamp)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Amount due:</span>
                    <span className="font-mono font-semibold">{fmtBig(currentLoan.amount)}</span>
                  </div>
                </div>

                {modalMsg && (
                  <div className="mt-3 rounded-md bg-yellow-50 px-3 py-2 text-sm text-yellow-700">
                    {modalMsg}
                  </div>
                )}

                <div className="mt-6 flex justify-end gap-3">
                  <button
                    onClick={closeModal}
                    className="rounded-md px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-100"
                    type="button"
                    disabled={modalState === "submitting"}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={confirmRepay}
                    disabled={modalState === "submitting"}
                    className={`rounded-md px-4 py-2 text-sm font-semibold text-white ${
                      modalState === "submitting"
                        ? "bg-neutral-400"
                        : "bg-gradient-to-r from-[#ff7700] to-[#ff03b8] hover:brightness-110"
                    }`}
                    type="button"
                  >
                    {modalState === "submitting" ? "Submitting..." : "Confirm"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="flex flex-col items-center justify-center">
                  <div className="mt-2 mb-3 flex items-center justify-center">
                    <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
                      <svg viewBox="0 0 24 24" className="w-7 h-7 text-green-600">
                        <path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/>
                      </svg>
                    </div>
                  </div>
                  <h3 className="text-lg font-semibold text-neutral-900">Success</h3>
                  <p className="mt-2 text-sm text-neutral-700">
                    Repayment submitted. It may take a few minutes to finalize.
                  </p>
                </div>

                <div className="mt-6 flex justify-end">
                  <button
                    onClick={closeModal}
                    className="rounded-md px-4 py-2 text-sm font-semibold text-white bg-gradient-to-r from-[#ff7700] to-[#ff03b8] hover:brightness-110"
                    type="button"
                  >
                    OK
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
