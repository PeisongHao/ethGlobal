import React, { useEffect, useMemo, useState } from "react"
import { useLocation, useParams } from "react-router-dom"
import axios from "axios"
import TopBar from "../../components/TopBar/TopBar"
import SideBar from "../../components/SideBar/SideBar"
import TokenHeader from "../../components/Trading/TokenHeader"
import TokenImage from "../../components/Trading/TokenImage"
import TokenStats from "../../components/Trading/TokenStats"
import PriceChart from "../../components/Trading/PriceChart"
import OrderHistory from "../../components/Trading/OrderHistory"
import BuySellPanel from "../../components/Trading/BuySellPanel"
import {
  Contract,
  JsonRpcProvider,
  formatUnits,
  id as keccakTopic,
  Interface
} from "ethers"

const CONTRACT_ADDRESS = process.env.REACT_APP_CONTRACT_ADDRESS
let RPC_URL = process.env.REACT_APP_RPC_URL || "https://testnet.evm.nodes.onflow.org"

const PRICE_ABI = [
  "function getPrice() view returns (uint256)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "event Swap(address indexed sender, uint256 amountIn, address tokenIn, uint256 amountOut, address tokenOut)"
]
const ERC20_ABI = [
  "function decimals() view returns (uint8)"
]

// 你之前的 buy/sell 约定
const BUY_TOKEN_IN  = "0xd9a7ebca0a89a243d60333ae06079e5d5d271568".toLowerCase()
const SELL_TOKEN_IN = "0x3f44bd6b6a8a2c6443ddda37dc6ab00752e55c4f".toLowerCase()

// 解析 Swap 事件的 topic0
const SWAP_TOPIC0 = keccakTopic("Swap(address,uint256,address,uint256,address)")

export default function TradingPage() {
  const { tokenId } = useParams()
  const location = useLocation()
  const info = location.state?.token || {}

  const config_t = {
    tokenId: info.id,
    title: info.name,
    grade: "0 / 10",
    imageUrl: info.image,
  }

  const [cardInfo, setCardInfo] = useState(null)
  const [orderHistory, setOrderHistory] = useState([])
  const [flowUsd, setFlowUsd] = useState(0)

  const provider = new JsonRpcProvider(RPC_URL)
  const pair = new Contract(CONTRACT_ADDRESS, PRICE_ABI, provider)
  const iFace = new Interface(PRICE_ABI)

  // 读取价格
  const fetchPrice = async () => {
    const code = await provider.getCode(CONTRACT_ADDRESS)
    if (!code || code === "0x") {
      throw new Error(`No contract code at ${CONTRACT_ADDRESS} on Flow EVM Testnet (chainId 545)`)
    }
    const raw = await pair.getPrice()
    const asStr = formatUnits(raw, 18)
    const asNum = parseFloat(asStr)
    const priceRounded6 = Math.round(asNum * 1e6) / 1e6

    setCardInfo(ci => ({
      price_rate: priceRounded6,
      price_raw: asStr,
      price_pct: ci?.price_pct ?? 0,
      pcs_list: ci?.pcs_list ?? (Array.isArray(info.pcs_list) ? info.pcs_list : []),
      type: ci?.type ?? "pokemon",
    }))
  }
  // 分段拉取 logs，避免一次跨越 >10,000 区块
  async function fetchLogsChunked(provider, baseFilter, fromBlock, toBlock, step = 9000) {
    const logs = []
    let start = fromBlock
    while (start <= toBlock) {
      const end = Math.min(start + step, toBlock)
      const chunk = await provider.getLogs({
        ...baseFilter,
        fromBlock: start,
        toBlock: end,
      })
      logs.push(...chunk)
      start = end + 1
    }
    return logs
  }

  const LOOKBACK_BLOCKS = Number(process.env.REACT_APP_LOOKBACK_BLOCKS || 45000) // 自定义回溯范围

const fetchHistory = async () => {
  // 拿 token0/token1 地址与小数位
  const [t0, t1] = await Promise.all([pair.token0(), pair.token1()])
  const token0 = t0.toLowerCase()
  const token1 = t1.toLowerCase()

  const erc0 = new Contract(token0, ERC20_ABI, provider)
  const erc1 = new Contract(token1, ERC20_ABI, provider)
  const [dec0, dec1] = await Promise.all([erc0.decimals(), erc1.decimals()])

  const tip = await provider.getBlockNumber()
  const fromBlock = Math.max(0, tip - LOOKBACK_BLOCKS)

  // ⭐ 关键：按 9000 区块为一段分页拉取
  const baseFilter = { address: CONTRACT_ADDRESS, topics: [SWAP_TOPIC0] }
  const logs = await fetchLogsChunked(provider, baseFilter, fromBlock, tip, 9000)

  // 批量拿区块时间戳（简单缓存）
  const tsCache = new Map()
  const tsOf = async (bn) => {
    if (tsCache.has(bn)) return tsCache.get(bn)
    const b = await provider.getBlock(bn)
    tsCache.set(bn, b?.timestamp || 0)
    return tsCache.get(bn)
  }

  const items = []
  for (const log of logs) {
    let ev
    try { ev = iFace.parseLog(log) } catch { continue }
    if (!ev || ev.name !== "Swap") continue

    const { amountIn, tokenIn, amountOut, tokenOut } = ev.args
    const inAddr  = String(tokenIn).toLowerCase()
    const outAddr = String(tokenOut).toLowerCase()

    const inDec  = inAddr === token0 ? dec0 : dec1
    const outDec = outAddr === token0 ? dec0 : dec1

    const qtyIn  = parseFloat(formatUnits(amountIn, inDec))
    const qtyOut = parseFloat(formatUnits(amountOut, outDec))

    // 以 token0 计价的单价（与合约 getPrice 一致）
    const unitPrice =
      inAddr === token0
        ? (qtyOut > 0 ? qtyOut / qtyIn : 0)
        : (qtyOut > 0 ? qtyIn / qtyOut : 0)

    const ts = await tsOf(log.blockNumber)
    const side =
      inAddr === BUY_TOKEN_IN ? "Buy" :
      inAddr === SELL_TOKEN_IN ? "Sell" : "Swap"

    items.push({
      _k: `${log.transactionHash}:${log.logIndex}`,
      token: tokenId,
      side,
      amount: qtyIn,
      quantity: qtyIn,
      unitPrice,
      value: unitPrice * qtyIn,
      status: "Filled",
      time: new Date(ts * 1000).toISOString(),
      txHash: log.transactionHash,
    })
  }

  items.sort((a, b) => (a.time < b.time ? 1 : -1))
  setOrderHistory(items)
}


  // 定时拉价格 & 历史
  useEffect(() => {
    ;(async () => {
      await fetchPrice()
      await fetchHistory()
    })()
    const ivPrice = setInterval(fetchPrice, 30_000)
    const ivHist  = setInterval(fetchHistory, 60_000)
    return () => {
      clearInterval(ivPrice)
      clearInterval(ivHist)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config_t.tokenId])

  // FLOW→USD
  useEffect(() => {
    const fetchFlowUsd = async () => {
      try {
        const resp = await axios.get("https://api.coingecko.com/api/v3/simple/price", {
          params: { ids: "flow", vs_currencies: "usd" },
        })
        setFlowUsd(resp.data?.flow?.usd ?? 0)
      } catch (err) {
        console.error("Failed to fetch FLOW→USD price:", err)
      }
    }
    fetchFlowUsd()
    const iv = setInterval(fetchFlowUsd, 60_000)
    return () => clearInterval(iv)
  }, [])

  const volume24h = useMemo(() => {
    if (!orderHistory?.length) return 0
    const nowTs = Date.now()
    const cutoff = nowTs - 24 * 60 * 60 * 1000
    return orderHistory
      .filter(o => {
        const t = new Date(o.time).getTime()
        return t > cutoff && t <= nowTs
      })
      .reduce((sum, o) => sum + (o.quantity || o.amount || 0), 0)
  }, [orderHistory])

  const currentPriceXrp = cardInfo?.price_rate ?? 0
  const usdPrice = (cardInfo?.price_rate ?? 0) * flowUsd

  return (
    <div className="flex flex-col h-screen bg-gradient-to-br from-gray-100 via-gray-50 to-gray-200 text-neutral-800">
      <div className="mb-2">
        <TopBar />
      </div>

      <div className="flex flex-1 gap-2 min-h-0 h-full">
        <SideBar currentPage="marketplace" />

        <div className="flex-1 flex flex-row h-full min-h-0 overflow-hidden p-6 bg-white rounded-2xl shadow-lg">
          {/* ← LEFT PANEL (40%) */}
          <div className="w-2/5 flex flex-col p-2 h-full min-h-0">
            <TokenHeader title={config_t.title} grade={config_t.grade} tokenId={config_t.tokenId} />
            <div className="flex-1 min-h-0 flex pt-7">
              <TokenImage imageUrl={config_t.imageUrl} alt={`${cardInfo?.type ?? "—"} art`} />
            </div>
          </div>

          <div className="mx-4 w-2 bg-gray-100 rounded-md" />

          {/* → RIGHT COLUMN */}
          <div className="flex-1 flex flex-col space-y-4 overflow-y-auto">
            <TokenStats
              tokenId={tokenId}
              price={currentPriceXrp}
              usdPrice={usdPrice}
              change24h={cardInfo?.price_pct ?? 0}
              marketCap={cardInfo ? (cardInfo.pcs_list?.length || 0) * 1000 * currentPriceXrp : 0}
              supply={cardInfo ? (cardInfo.pcs_list?.length || 0) * 1000 : 0}
              volume24h={volume24h}
            />

            <PriceChart tokenId={tokenId} trades={orderHistory} className="flex-1 min-h-0" height={250} />

            <BuySellPanel
              tokenId={tokenId}
              unitPriceXrp={currentPriceXrp}
              unitPriceUsd={usdPrice}
              onSubmitted={(newOrder, updatedPrice) => {
                setOrderHistory((h) => [newOrder, ...h]) // 即刻把最新成交放最前
                if (updatedPrice != null) {
                  setCardInfo((ci) => (ci ? { ...ci, price_rate: updatedPrice } : ci))
                }
              }}
            />

            <OrderHistory tokenId={tokenId} orders={orderHistory} />
          </div>
        </div>
      </div>
    </div>
  )
}
