import React, { useState } from "react"

export default function BuySellPanel({ tokenId, unitPriceXrp, unitPriceUsd, onSubmitted }) {
  const [mode, setMode] = useState(null)
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const parsedAmt = Number(amount) || 0
  const totalXrp = parsedAmt * (unitPriceXrp || 0)
  const totalUsd = parsedAmt * (unitPriceUsd || 0)

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
    if (!parsedAmt || parsedAmt <= 0) {
      setError("Please enter a valid amount.")
      return
    }
    setSubmitting(true)
    setError("")
    try {
      // TODO: 替换为你的后端下单接口
      // const resp = await axios.post(`${config.BACKEND_ENDPOINT}/api/trade`, {
      //   tokenId,
      //   side: mode,
      //   amount: parsedAmt,
      // })
      // const ok = resp.data?.success
      // if (!ok) throw new Error(resp.data?.message || "Trade failed")

      // 占位：模拟成功
      const nowIso = new Date().toISOString()
      onSubmitted?.(
        {
          token: tokenId,
          side: mode === "buy" ? "Buy" : "Sell",
          amount: parsedAmt,
          value: totalXrp,
          status: "Filled",
          time: nowIso,
          quantity: parsedAmt,
          unitPrice: unitPriceXrp,
        },
        unitPriceXrp // 可替换为后端返回的新价格
      )
      close()
    } catch (e) {
      setError(e?.message || "Submission failed")
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

      {/* Modal */}
      <Modal open={open} onClose={close} title={mode === "buy" ? "Buy Tokens" : "Sell Tokens"}>
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm text-gray-600">
            <span>Unit Price</span>
            <span className="font-medium">
              {unitPriceXrp?.toFixed(6)} Flow {unitPriceUsd ? `(~$${unitPriceUsd.toFixed(4)})` : ""}
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
              <span className="font-semibold">{Number.isFinite(totalXrp) ? totalXrp.toFixed(6) : "—"}</span>
            </div>
            <div className="flex items-center justify-between mt-1">
              <span>Total (USD)</span>
              <span className="font-semibold">{Number.isFinite(totalUsd) ? `$${totalUsd.toFixed(4)}` : "—"}</span>
            </div>
          </div>

          {error ? <p className="text-sm text-red-600">{error}</p> : null}

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
