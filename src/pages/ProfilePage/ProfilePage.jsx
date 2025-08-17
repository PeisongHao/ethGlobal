/* eslint-disable no-console */
import React, { useContext, useState, useEffect, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { FlowWalletContext } from "../../context/WalletContext";
import TopBar from "../../components/TopBar/TopBar";
import SideBar from "../../components/SideBar/SideBar";
import ProfileHeader from "../../components/Profile/ProfileHeader";
import HoldingsGrid from "../../components/Profile/HoldingsGrid";
import LoansPanel from "../../components/Profile/LoansPanel";

import {
  Alert,
  AlertTitle,
  AlertDescription,
  AlertActions,
} from "../../components/tailwind_utils/alert";

import bulbasaur from "../../assets/bulbasaur.png";
import h1 from "../../assets/h1.png";

const SIG = {
  balanceOf: "0x70a08231", // balanceOf(address)
  decimals: "0x313ce567", // decimals()
};
const pad32 = (hex) => (hex || "").replace(/^0x/, "").padStart(64, "0");
const addrTo32 = (addr) =>
  pad32((addr || "").toLowerCase().replace(/^0x/, "").padStart(40, "0"));

async function ethCall(to, data) {
  const provider = window.ethereum;
  if (!provider) throw new Error("MetaMask not found");
  return provider.request({
    method: "eth_call",
    params: [{ to, data }, "latest"],
  });
}

function hexToNumber(hex) {
  if (!hex) return 0;
  const n = parseInt(hex, 16);
  return Number.isFinite(n) ? n : 0;
}

function formatByDecimals(rawInt, decimals = 18) {
  const base = Math.pow(10, decimals || 0);
  const num = base > 0 ? rawInt / base : rawInt;
  return Number(num).toFixed(4);
}

const ProfilePage = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const { flowAddress, flowBalance } = useContext(FlowWalletContext);
  const showRedeemHistory = () => navigate("/redeemhistory");

  // --- Tabs: ?tab=loans | listings
  const getInitialTab = () => {
    const params = new URLSearchParams(location.search);
    const urlTab = params.get("tab");
    return urlTab === "loans" ? "loans" : "listings";
  };
  const [activeTab, setActiveTab] = useState(getInitialTab);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    params.set("tab", activeTab);
    navigate({ search: params.toString() }, { replace: true });
  }, [activeTab, navigate, location.search]);

  // ---- 页面数据
  const [allCards, setAllCards] = useState([]);
  const [ownedCards, setOwnedCards] = useState([]); // 由 ERC-20 余额 > 0 的卡片组成
  const [openAlert, setOpenAlert] = useState(false);

  // 概览统计（用 ownedCards 长度替代原 tokenLines 统计）
  const stats = useMemo(
    () => ({
      netWorth: 25100, // TODO: 替换为真实值
      xrpBalance: flowBalance,
      unique: ownedCards.length,
      total: 34, // TODO
      listed: ownedCards.length,
      volume: 12650, // TODO
      earnings: 4200, // TODO
    }),
    [flowBalance, ownedCards.length]
  );

  // 模拟/或从后端获取卡片基础信息（包含 ERC-20 合约地址：id）
  const getAllCard = async () => {
    try {
      const formattedTokens = [
        {
          name: "Bulbasaur",
          price: 10.5,
          change: 2.1,
          image: bulbasaur,
          id: "0x3f44Bd6B6A8a2c6443ddDa37Dc6AB00752e55c4F", // ERC-20 合约地址
          type: "pokemon",
        },
        {
          name: "Raichu",
          price: 25.0,
          change: -1.3,
          image: h1,
          id: "0x3f44Bd6B6A8a2c6443ddDa37Dc6AB00752e55c4F", // ERC-20 合约地址
          type: "pokemon",
        },
      ];
      setAllCards(formattedTokens);
    } catch (err) {
      console.error("Error get the info", err);
      setAllCards([]);
    }
  };

  // ✅ 关键逻辑：对 allCards 中的每个 ERC-20 合约地址查余额（balanceOf）+ 小数位（decimals）
  const filterOwnedCards = async () => {
    if (!flowAddress || !Array.isArray(allCards) || allCards.length === 0) {
      setOwnedCards([]);
      return;
    }

    try {
      const uniqueAddrs = Array.from(
        new Set(
          allCards
            .map((c) => c.id)
            .filter(Boolean)
            .map((a) => a.toLowerCase())
        )
      );

      const perToken = await Promise.all(
        uniqueAddrs.map(async (token) => {
          const dataBal = SIG.balanceOf + addrTo32(flowAddress);
          const [balHex, decHex] = await Promise.all([
            ethCall(token, dataBal),
            ethCall(token, SIG.decimals).catch(() => "0x12"), // 默认 18
          ]);

          const bal = hexToNumber(balHex);
          const decimals = hexToNumber(decHex) || 18;
          return { token, bal, decimals };
        })
      );

      const rows = allCards
        .map((card) => {
          const rec = perToken.find((t) => t.token === card.id.toLowerCase());
          if (!rec || rec.bal === 0) return null;
          return {
            name: card.name,
            symbol: card.type,
            amount: formatByDecimals(rec.bal, rec.decimals), // 人类可读
            value: card.price,
            change: card.change,
            image: card.image,
            id: card.id,
            type: card.type,
          };
        })
        .filter(Boolean);

      setOwnedCards(rows);
    } catch (e) {
      console.error("filterOwnedCards error:", e);
      setOwnedCards([]);
    }
  };

  // 拉卡片列表
  useEffect(() => {
    getAllCard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 地址或卡片变化时重新过滤
  useEffect(() => {
    filterOwnedCards();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allCards, flowAddress]);

  // UI helpers
  const TabButton = ({ id, label }) => {
    const active = activeTab === id;
    return (
      <button
        onClick={() => setActiveTab(id)}
        role="tab"
        aria-selected={active}
        className={[
          "flex-1 px-4 py-2 text-sm font-medium rounded-xl transition",
          active
            ? "bg-gradient-to-r from-[#ff7700] to-[#ff03ea] text-white shadow"
            : "text-neutral-600 hover:bg-neutral-100",
        ].join(" ")}
      >
        {label}
      </button>
    );
  };

  return (
    <div className="flex flex-col h-screen bg-gradient-to-br from-gray-100 via-gray-50 to-gray-200 text-neutral-800">
      {/* top nav */}
      <div className="mb-2">
        <TopBar />
      </div>

      <div className="flex flex-1 gap-4 min-h-0">
        <SideBar currentPage="profile" />

        {/* right-hand content */}
        <div className="flex-1 flex flex-col min-h-0 space-y-6">
          {/* profile header */}
          <ProfileHeader
            walletAddress={flowAddress}
            stats={stats}
            handleRedeem={() => setOpenAlert(true)}
          />

          {/* Unified Card with Tabs */}
          <section className="bg-white/70 backdrop-blur rounded-2xl shadow-sm border border-black/5 flex-1 min-h-0 flex flex-col">
            {/* Tabs header */}
            <header className="px-5 pt-4 border-b border-black/5">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold tracking-tight">Portfolio</h2>
              </div>

              {/* segmented tabs */}
              <div
                role="tablist"
                aria-label="Portfolio sections"
                className="mt-3 grid grid-cols-2 gap-2 bg-white/60 p-1 rounded-xl border border-black/5"
              >
                <TabButton id="listings" label={`Listings (${ownedCards.length})`} />
                <TabButton id="loans" label="Loans" />
              </div>
            </header>

            {/* Tab panels */}
            <div className="p-5 overflow-y-auto min-h-0 flex-1">
              {activeTab === "listings" && (
                <div role="tabpanel" className="min-h-0">
                  <p className="text-sm text-neutral-500 mb-3">
                    Balances are fetched via MetaMask eth_call (balanceOf/decimals) on Flow EVM
                    Testnet for the ERC-20 addresses listed in your cards.
                  </p>
                  <HoldingsGrid holdings={ownedCards} />
                </div>
              )}

              {activeTab === "loans" && (
                <div role="tabpanel" className="min-h-0">
                  <p className="text-sm text-neutral-500 mb-3">Active & completed</p>
                  <LoansPanel walletAddress={flowAddress} />
                </div>
              )}
            </div>
          </section>
        </div>
      </div>

      {/* redeem-card alert */}
      {openAlert && (
        <Alert
          open={openAlert}
          onClose={() => setOpenAlert(false)}
          className="rounded-2xl shadow-sm !max-w-2xl"
        >
          <AlertTitle className="!text-xl !text-center !text-[#ff7700]">
            Redemption Guidelines
          </AlertTitle>
          <AlertDescription className="!text-lg !text-neutral-700 pt-4 pb-5">
            Click on the card you would like to redeem to explore redemption options. <br />
            A card can be redeemed with 1000 tokens.
          </AlertDescription>
          <AlertActions className="flex justify-center">
            <button
              onClick={showRedeemHistory}
              className="px-6 py-2 rounded-lg bg-gradient-to-r from-[#ff7700] to-[#ff03ea] text-white font-semibold hover:brightness-110 transition duration-200"
            >
              View My Redemption History
            </button>
          </AlertActions>
        </Alert>
      )}
    </div>
  );
};

export default ProfilePage;
