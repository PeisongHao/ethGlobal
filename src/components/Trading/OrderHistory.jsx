import React, { useContext, useMemo } from "react"
import { FlowWalletContext } from "../../context/WalletContext"

const EXPLORER_BASE = "https://evm-testnet.flowscan.io"

export default function OrderHistory({
  tokenId,
  orders,
  className = "",
  baseSymbol = "Flow",
}) {
  const { flowAddress } = useContext(FlowWalletContext)

  // ---------- 格式化器 ----------
  const fmtAmt = useMemo(
    () => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 }),
    []
  )
  const fmtPrice = useMemo(
    () => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 }),
    []
  )
  const fmtVal = useMemo(
    () => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 }),
    []
  )

  // ---------- 归一化 + 过滤我的订单 ----------
  const rows = useMemo(() => {
    const list = Array.isArray(orders) ? [...orders] : []

    // 是否具备可过滤的参与方字段
    const hasParty = list.some(
      (o) => o?.buyer || o?.seller || o?.sender
    )

    // 过滤“我的订单”——优先用 buyer/seller，其次 sender（Swap 事件里的 sender）
    const filtered = hasParty && flowAddress
      ? list.filter(o =>
          (o?.buyer && String(o.buyer).toLowerCase() === String(flowAddress).toLowerCase()) ||
          (o?.seller && String(o.seller).toLowerCase() === String(flowAddress).toLowerCase()) ||
          (o?.sender && String(o.sender).toLowerCase() === String(flowAddress).toLowerCase())
        )
      : list

    // 时间倒序
    filtered.sort((a, b) => {
      const ta = new Date(a.time || 0).getTime()
      const tb = new Date(b.time || 0).getTime()
      return tb - ta
    })

    // 归一化到统一渲染模型
    return filtered.map((o, i) => {
      const amount = safeNum(o.quantity ?? o.amount)              // 输入数量
      const unitPrice = safeNum(
        o.unitPrice ?? (isFiniteNum(o.value) && isFiniteNum(amount) && amount !== 0 ? o.value / amount : undefined)
      )
      const value = safeNum(o.value ?? (isFiniteNum(unitPrice) ? unitPrice * amount : undefined))
      const side =
        o.side ||
        (o?.buyer ? "Buy" : o?.seller ? "Sell" : "Swap")
      const status = o.status || "Filled"
      const when = o.time ? new Date(o.time) : null
      const key =
        o._k ||
        o.txHash ||
        `${o.time || ""}-${i}`

      return {
        key,
        token: o.token ?? tokenId,
        side,
        amount,
        unitPrice,
        value,
        status,
        timeISO: when ? when.toISOString() : "",
        timeLabel: when ? when.toLocaleString() : "—",
        txHash: o.txHash,
      }
    })
  }, [orders, flowAddress, tokenId])

  return (
    <div className={`flex-1 overflow-y-auto bg-gray-50 rounded-xl p-4 ${className}`}>
      <h3 className="text-lg font-bold mb-2">Order History</h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left border-b">
            <Th>Time</Th>
            <Th>Side</Th>
            <Th>Amount</Th>
            <Th>Unit&nbsp;Price</Th>
            <Th>Value&nbsp;({baseSymbol})</Th>
            <Th>Tx</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b last:border-none">
              <Td title={r.timeISO || ""}>{r.timeLabel}</Td>
              <Td className={r.side === "Buy" ? "text-[#00a300] font-semibold" : r.side === "Sell" ? "text-red-500 font-semibold" : ""}>
                {r.side}
              </Td>
              <Td>{isFiniteNum(r.amount) ? fmtAmt.format(r.amount) : "—"}</Td>
              <Td>{isFiniteNum(r.unitPrice) ? fmtPrice.format(r.unitPrice) : "—"}</Td>
              <Td>{isFiniteNum(r.value) ? fmtVal.format(r.value) : "—"}</Td>
              <Td>
                {r.txHash ? (
                  <a
                    href={`${EXPLORER_BASE}/tx/${r.txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    {shortHash(r.txHash)}
                  </a>
                ) : "—"}
              </Td>
              <Td>
                <span
                  className={`px-2 py-0.5 rounded-md text-xs
                    ${r.status === "Filled"
                      ? "bg-orange-100 text-[#ff7700]"
                      : "bg-pink-100 text-pink-500"}`}
                >
                  {r.status}
                </span>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* helpers */
const Th = ({ children }) => <th className="py-1.5 pr-4 font-semibold">{children}</th>
const Td = ({ children, className = "" }) => (
  <td className={`py-2.5 pr-4 align-top ${className}`}>{children}</td>
)

function isFiniteNum(v) {
  const n = typeof v === "string" ? parseFloat(v) : v
  return Number.isFinite(n)
}
function safeNum(v, fallback = undefined) {
  if (v == null) return fallback
  const n = typeof v === "string" ? parseFloat(v) : v
  return Number.isFinite(n) ? n : fallback
}
function shortHash(h) {
  if (!h) return ""
  const s = String(h)
  return s.length > 10 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s
}
