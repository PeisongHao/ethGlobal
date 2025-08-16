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
// import config from "../config/config"

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
  const [flowUsd, setFlowUsd] = useState(0);

  // —— 轮询链上数据（每 60s） ——————————————————————————
  const fetchOnchain = async () => {
    try {
      // TODO: 用你的后端 / 链上查询替换下面两个请求
      // const responseHistory = await axios.post(`${config.BACKEND_ENDPOINT}/api/onchain/trades`, { token: config_t.tokenId })
      // const responseInfo    = await axios.post(`${config.BACKEND_ENDPOINT}/api/search`, { token: config_t.tokenId })
      // setOrderHistory(responseHistory.data.trades || [])
      // setCardInfo(responseInfo.data || null)

      // —— 占位：避免空页面（请替换为真实数据）——
      setOrderHistory((h) => h.slice(-200))
      setCardInfo((ci) =>
        ci || {
          price_rate: Number(info.price_rate || 1),
          price_pct: Number(info.price_pct || 0),
          pcs_list: Array.isArray(info.pcs_list) ? info.pcs_list : [],
          type: info.type || "—",
        }
      )
    } catch (err) {
      console.error("fetchOnchain error:", err)
    }
  }

  useEffect(() => {
    fetchOnchain()
    const iv = setInterval(fetchOnchain, 60_000)
    return () => clearInterval(iv)
  }, [config_t.tokenId])

    // —— 实时拉取 XRP→USD（你也可以换成 FLOW 价格源）——
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
      .filter((o) => {
        const t = new Date(o.time).getTime()
        return t > cutoff && t <= nowTs
      })
      .reduce((sum, o) => sum + (o.quantity || o.amount || 0), 0)
  }, [orderHistory])

  const currentPriceXrp = cardInfo?.price_rate ?? 0
  const usdPrice = (cardInfo?.price_rate ?? 0) * flowUsd

  return (
    <div className="flex flex-col h-screen bg-gradient-to-br from-gray-100 via-gray-50 to-gray-200 text-neutral-800">
      {/* Top bar */}
      <div className="mb-2">
        <TopBar />
      </div>

      {/* Page Content */}
      <div className="flex flex-1 gap-2 min-h-0 h-full">
        {/* Sidebar */}
        <SideBar currentPage="marketplace" />

        {/* Main content */}
        <div className="flex-1 flex flex-row h-full min-h-0 overflow-hidden p-6 bg-white rounded-2xl shadow-lg">
          {/* ← LEFT PANEL (40%) */}
          <div className="w-2/5 flex flex-col p-2 h-full min-h-0">
            <TokenHeader title={config_t.title} grade={config_t.grade} tokenId={config_t.tokenId} />
            <div className="flex-1 min-h-0 flex pt-7">
              <TokenImage imageUrl={config_t.imageUrl} alt={`${cardInfo?.type ?? "—"} art`} />
            </div>
          </div>

          {/* 分隔条 */}
          <div className="mx-4 w-2 bg-gray-100 rounded-md" />

          {/* → RIGHT COLUMN */}
          <div className="flex-1 flex flex-col space-y-4 overflow-y-auto">
            {/* 卡片信息（保留你的 TokenStats 组件） */}
            <TokenStats
              tokenId={tokenId}
              price={currentPriceXrp}
              usdPrice={usdPrice}
              change24h={cardInfo?.price_pct ?? 0}
              marketCap={cardInfo ? (cardInfo.pcs_list?.length || 0) * 1000 * currentPriceXrp : 0}
              supply={cardInfo ? (cardInfo.pcs_list?.length || 0) * 1000 : 0}
              volume24h={volume24h}
            />

            {/* 价格图 */}
            <PriceChart tokenId={tokenId} trades={orderHistory}className="flex-1 min-h-0" height={250}/>

            {/* 买 / 卖（弹窗） */}
            <BuySellPanel
              tokenId={tokenId}
              unitPriceXrp={currentPriceXrp}
              unitPriceUsd={usdPrice}
              onSubmitted={(newOrder, updatedPrice) => {
                // 成功后：插入历史 & 更新价格（可根据后端返回调节）
                setOrderHistory((h) => [...h, newOrder])
                if (updatedPrice) {
                  setCardInfo((ci) => (ci ? { ...ci, price_rate: updatedPrice } : ci))
                }
              }}
            />

            {/* 用户的购买历史 */}
            <OrderHistory tokenId={tokenId} orders={orderHistory} />
          </div>
        </div>
      </div>
    </div>
  )
}