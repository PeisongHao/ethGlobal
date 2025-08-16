import React, { useEffect, useMemo, useRef, useState } from "react"
import ReactApexChart from "react-apexcharts"
import dayjs from "dayjs"

/** ===== 参数 ===== */
const BUCKET_MS = 3000       // 3s/根
const WINDOW_BARS = 20       // 最近 1 分钟（20 根）
const TICK_MS = 1000         // 每秒 1 笔
const ANCHOR = 10            // 均值回归锚点
const REVERSION = 0.18       // 回归力度
const VOL_PCT = 0.006        // 相对波动
const FLOOR_PRICE = 0.01

export default function PriceChart({
  tokenId,
  trades = [],
  className = "",
  height = 280              // 👈 默认更小；可传 200~280 自调
}) {
  /** 价格种子：过去60秒每秒一笔 */
  const [lastPrice, setLastPrice] = useState(() => ANCHOR)
  const [candles, setCandles] = useState(() => {
    const now = dayjs()
    let p = ANCHOR
    const ticks = []
    for (let i = 59; i >= 0; i--) {
      p = evolvePriceOU(p)
      ticks.push({ time: now.subtract(i, "second").toDate(), price: p })
    }
    return ticksTo3sCandles(ticks)
  })

  // 只创建一个 interval（避免 StrictMode 双跑），增量更新最后一根/追加新根
  const timerRef = useRef(null)
  useEffect(() => {
    if (timerRef.current) return
    timerRef.current = setInterval(() => {
      setCandles(prev => {
        // 1) 生成下一笔
        const p0 = prev.length ? prev[prev.length - 1].y[3] : lastPrice
        const p1 = evolvePriceOU(p0)
        setLastPrice(p1)

        const now = new Date()
        const bStart = Math.floor(now.getTime() / BUCKET_MS) * BUCKET_MS

        if (!prev.length) {
          return [{ x: new Date(bStart), y: [p1, p1, p1, p1] }]
        }

        const last = prev[prev.length - 1]
        const lastStart = last.x.getTime()

        if (bStart === lastStart) {
          // 落在当前桶：只更新最后一根 H/L/C（不重挂组件，不闪）
          const [o, h, l] = last.y
          const nh = Math.max(h, p1)
          const nl = Math.min(l, p1)
          const updated = { x: last.x, y: [o, nh, nl, p1] }
          const out = [...prev]
          out[out.length - 1] = updated
          return out
        } else {
          // 跨桶：追加新根（open = 上一根收盘，避免全红）
          const prevClose = last.y[3]
          const open = prevClose
          const high = Math.max(open, p1)
          const low  = Math.min(open, p1)
          const close = p1
          const out = [...prev, { x: new Date(bStart), y: [open, high, low, close] }]
          if (out.length > WINDOW_BARS) out.splice(0, out.length - WINDOW_BARS) // 只留 1 分钟
          return out
        }
      })
    }, TICK_MS)

    return () => {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  /** 系列与配置（稳定引用，避免不必要重绘/闪烁） */
  const series = useMemo(() => [
    { name: `${tokenId || "Token"} / XRP`, data: candles }
  ], [candles, tokenId])

  const options = useMemo(() => ({
    chart: {
      id: `ohlc-3s-${tokenId || "token"}`,
      type: "candlestick",
      height,                              // 👈 跟随传入高度
      toolbar: { show: false },
      animations: {
        enabled: true,
        easing: "linear",
        speed: 200,
        dynamicAnimation: { enabled: false } // 不做数据重排动画，减少视觉跳动
      },
      parentHeightOffset: 0
    },
    grid: {
      padding: { top: 4, right: 4, bottom: 4, left: 0 } // 👈 压缩内边距
    },
    xaxis: {
      type: "datetime",
      labels: { datetimeUTC: false, style: { fontSize: "10px" } }, // 👈 更小的字
      range: 60_000 // 固定只显示最近 1 分钟，平滑右移
    },
    yaxis: {
      tooltip: { enabled: true },
      labels: { formatter: v => (typeof v === "number" ? v.toFixed(2) : ""), style: { fontSize: "10px" } }
    },
    tooltip: {
      theme: "light",
      x: { show: false }
    },
    theme: { mode: "light" },
    plotOptions: {
      candlestick: {
        colors: { upward: "#26de81", downward: "#ff3b30" },
        wick: { useFillColor: true }
      }
    }
  }), [tokenId, height])

  return (
    <div className={`p-3 rounded-xl border border-gray-200 overflow-hidden ${className}`}> {/* 👈 padding 更小 & 隐藏溢出 */}
      <div className="flex items-center justify-between mb-1">
        <div className="text-xs font-semibold text-gray-700">{tokenId || "Token"} / Flow</div>
        <div className="text-[10px] text-gray-400">3s bars · last 1 min</div>
      </div>

      <ReactApexChart
        options={options}
        series={series}
        type="candlestick"
        height={height}   // 👈 这里用同一个 height
        width="100%"
      />
    </div>
  )
}

/* ================= Helpers ================ */

// 离散 OU：均值回归 + 相对噪声
function evolvePriceOU(price) {
  const dt = TICK_MS / 1000
  const drift = REVERSION * (ANCHOR - price) * dt
  const shock = (VOL_PCT * price) * randn() * Math.sqrt(dt)
  const next = price + drift + shock
  const safe = Math.max(FLOOR_PRICE, Number(next.toFixed(6)))
  return Number.isFinite(safe) ? safe : price
}

function randn() {
  let u = 0, v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

// 初始化：把秒级 ticks 转 3s K 线
function ticksTo3sCandles(ticks) {
  if (!Array.isArray(ticks) || !ticks.length) return []
  const sorted = [...ticks].sort((a, b) => new Date(a.time) - new Date(b.time))
  const out = []
  let prevClose = null

  for (const t of sorted) {
    const ms = new Date(t.time).getTime()
    const bStart = Math.floor(ms / BUCKET_MS) * BUCKET_MS
    const last = out[out.length - 1]

    if (last && last.x.getTime() === bStart) {
      const [o, h, l] = last.y
      const nh = Math.max(h, t.price)
      const nl = Math.min(l, t.price)
      last.y = [o, nh, nl, t.price]
    } else {
      const open = prevClose ?? t.price
      const high = Math.max(open, t.price)
      const low  = Math.min(open, t.price)
      out.push({ x: new Date(bStart), y: [open, high, low, t.price] })
    }
    prevClose = t.price
  }

  // 只留最近 1 分钟（20 根）
  if (out.length > WINDOW_BARS) return out.slice(out.length - WINDOW_BARS)
  return out
}
