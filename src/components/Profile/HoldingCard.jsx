/* eslint-disable no-console */
import React, { useState, useContext } from "react"
import { FlowWalletContext } from "../../context/WalletContext";
import { useNavigate } from "react-router-dom";

// —— 新增：ethers & 链接配置、最小 ABI
import {
  BrowserProvider,
  Contract,
  parseUnits,
  formatUnits,
  MaxUint256,
} from "ethers";

const RPC_URL = process.env.REACT_APP_RPC_URL || "https://testnet.evm.nodes.onflow.org";
// 你的 UsdcLendingVault 地址（.env: REACT_APP_VAULT）
const VAULT_ADDRESS = (process.env.REACT_APP_VAULT || "").trim();
// USDC 的小数位（一般 6；.env: REACT_APP_USDC_DECIMALS）
const USDC_DECIMALS = Number(process.env.REACT_APP_USDC_DECIMALS || 6);
// Flow EVM Testnet
const EVM_FLOW_TESTNET_CHAIN_HEX = "0x221";

// Vault 只需用到的函数
const VAULT_ABI = [
  "function previewAdditionalCollateral(address collateralToken, uint256 borrowAmountUSDC) view returns (uint256)",
  "function borrowWithCollateral(address collateralToken, uint256 borrowAmountUSDC) returns (uint256 collateralPulled)",
  "function collateralPos(address) view returns (address token, uint256 amount)",   // 新增：校验是否切换抵押物
];

// 最小 ERC20 ABI：需要 balanceOf 来做余额检查
const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",   // 新增
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
];

// 保证链在 Flow EVM Testnet
async function ensureFlowEvm() {
  if (!window.ethereum) throw new Error("No wallet detected. Please install MetaMask.");
  const chainId = await window.ethereum.request({ method: "eth_chainId" });
  if (chainId !== EVM_FLOW_TESTNET_CHAIN_HEX) {
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: EVM_FLOW_TESTNET_CHAIN_HEX }],
      });
    } catch {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: EVM_FLOW_TESTNET_CHAIN_HEX,
          chainName: "Flow EVM Testnet",
          nativeCurrency: { name: "FLOW", symbol: "FLOW", decimals: 18 },
          rpcUrls: [RPC_URL],
          blockExplorerUrls: ["https://evm-testnet.flowscan.io"],
        }],
      });
    }
  }
}

const HoldingCard = ({ token }) => {
  const navigate = useNavigate();
  const handleTrade   = () => navigate(`/trade/${token.name}`,   { state: { token } })
  const handleRedeem  = () => navigate(`/redeem/${token.symbol}`, { state: { token } })
  const { flowAddress } = useContext(FlowWalletContext);
  
  const canRedeem = token.amount >= 1000;
  const pct = Math.min(token.amount / 1000, 1) * 100;

  // ---------- lending modal state ----------
  const [showModal, setShowModal] = useState(false);
  const [lendAmount, setLendAmount] = useState("");
  const [error, setError] = useState("");
  // "idle" | "submitting" | "success"
  const [submitState, setSubmitState] = useState("idle");
  const [submittedXRP, setSubmittedXRP] = useState(0);

  // ---------- staking modal state ----------
  const [showStakeModal, setShowStakeModal] = useState(false);
  const [stakeAmount, setStakeAmount] = useState("");
  const [stakeError, setStakeError] = useState("");
  // "idle" | "submitting" | "success"
  const [stakeState, setStakeState] = useState("idle");
  const [stakedAmount, setStakedAmount] = useState(0);

  const maxAmount = Number(token?.amount ?? 0);
  const valuePerToken = Number(token.value) || 0;

  // lending calc（仍按 70% LTV 预估展示；实际以合约/Oracle为准）
  const numericLend = Number(lendAmount);
  const isNumberLend = Number.isFinite(numericLend);
  const withinBalanceLend = isNumberLend && numericLend > 0 && numericLend <= maxAmount;
  const estimatedXRP = isNumberLend ? numericLend * valuePerToken * 0.7 : 0;

  // staking calc
  const numericStake = Number(stakeAmount);
  const isNumberStake = Number.isFinite(numericStake);
  const withinBalanceStake = isNumberStake && numericStake > 0 && numericStake <= maxAmount;

  const formatXRP = (n) => Number(n || 0).toFixed(4);
  const formatToken = (n) => Number(n || 0).toFixed(6);

  const resetModal = () => {
    setLendAmount("");
    setError("");
    setSubmitState("idle");
    setSubmittedXRP(0);
  };
  const openModal = () => { resetModal(); setShowModal(true); };
  const closeModal = () => { setShowModal(false); };

  const resetStakeModal = () => {
    setStakeAmount("");
    setStakeError("");
    setStakeState("idle");
    setStakedAmount(0);
  };
  const openStake = () => { resetStakeModal(); setShowStakeModal(true); };
  const closeStake = () => { setShowStakeModal(false); };

  // -------- LENDING SUBMIT（与 Vault 交互） --------
  const handleSubmit = async (chosenTokenAmount) => {
  if (!flowAddress) { alert("Wallet not connected"); return; }
  if (!VAULT_ADDRESS) { setError("Vault address not configured (REACT_APP_VAULT)."); return; }
  if (!token?.id) { setError("Missing collateral token address on this card."); return; }

  try {
    setSubmitState("submitting");
    setError("");

    await ensureFlowEvm();
    const provider = new BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();

    const collateralAddr = token.id; // 这张卡对应的 ERC20 抵押物
    const vault = new Contract(VAULT_ADDRESS, VAULT_ABI, signer);
    const collateral = new Contract(collateralAddr, ERC20_ABI, signer);

    // 1) UI 里“想借多少 USDC”（按你现有展示逻辑：数量 * 单价 * 0.7）
    const borrowFloat = Number(chosenTokenAmount) * Number(valuePerToken) * 0.7;
    if (!Number.isFinite(borrowFloat) || borrowFloat <= 0) {
      throw new Error("Borrow amount computed invalid. Please check input.");
    }
    const borrowAmountUSDC = parseUnits(String(borrowFloat), USDC_DECIMALS);

    // 2) 不允许在有仓位时切换抵押物（你的合约有这个限制）
    try {
      const cp = await vault.collateralPos(flowAddress);
      const currentColl = String(cp[0] || "").toLowerCase();
      if (currentColl && currentColl !== "0x0000000000000000000000000000000000000000" && currentColl !== collateralAddr.toLowerCase()) {
        throw new Error("You already use another collateral token. Please repay first.");
      }
    } catch (_) {}

    // 3) 读取抵押物 decimals，把“你愿意抵押的数量”换成最小单位
    const collDecimals = await collateral.decimals();
    const userInputUnits = parseUnits(String(chosenTokenAmount), collDecimals);

    // 4) 预估本次需要“新增抵押”的单位数（单位=抵押物原始单位）
    //    这是关键：用它来对比余额和 allowance，避免链上回退。
    let requiredUnits = 0n;
    try {
      requiredUnits = await vault.previewAdditionalCollateral(collateralAddr, borrowAmountUSDC);
    } catch {
      // 少数实现没有这个 view；此时我们保守地用“你愿意抵押的数量”去做额度校验
      requiredUnits = userInputUnits;
    }

    // 5) 余额检查：你是否至少有 requiredUnits
    const walletBal = await collateral.balanceOf(flowAddress);
    if (walletBal < requiredUnits) {
      const need = Number(formatUnits(requiredUnits, collDecimals)).toFixed(6);
      const have = Number(formatUnits(walletBal, collDecimals)).toFixed(6);
      throw new Error(`Insufficient ${token.symbol} balance: need ~${need}, you have ${have}.`);
    }

    // 6) allowance 检查：不足就一次性授权 MaxUint256（避免每次都授权）
    const allowance = await collateral.allowance(flowAddress, VAULT_ADDRESS);
    if (allowance < requiredUnits) {
      const txA = await collateral.approve(VAULT_ADDRESS, MaxUint256);
      await txA.wait();
    }

    // 7) 正式借款
    const tx = await vault.borrowWithCollateral(collateralAddr, borrowAmountUSDC);
    await tx.wait();

    setSubmittedXRP(borrowFloat);
    setSubmitState("success");
    // TODO：这里触发你的全局刷新（余额/仓位）
  } catch (err) {
    console.error("borrow failed:", err);
    const msg = err?.reason || err?.data?.message || err?.message || "There was an error submitting your offer.";
    setError(msg);
    setSubmitState("idle");
  }
};



  const handleConfirm = async () => {
    setError("");
    if (!isNumberLend || numericLend <= 0) { setError("Please enter a valid number greater than 0."); return; }
    if (numericLend > maxAmount) { setError(`You only have ${maxAmount} ${token.symbol}.`); return; }
    await handleSubmit(numericLend);
  };

  // -------- STAKE SUBMIT (local only) --------
  const handleStakeConfirm = async () => {
    setStakeError("");
    if (!isNumberStake || numericStake <= 0) { setStakeError("Please enter a valid number greater than 0."); return; }
    if (numericStake > maxAmount) { setStakeError(`You only have ${maxAmount} ${token.symbol}.`); return; }

    try {
      setStakeState("submitting");
      await new Promise((r) => setTimeout(r, 900));
      setStakedAmount(numericStake);
      setStakeState("success");
    } catch (e) {
      setStakeError("Something went wrong. Please try again.");
      setStakeState("idle");
    }
  };

  const canBackdropClose = submitState !== "submitting";
  const canStakeBackdropClose = stakeState !== "submitting";

  return (
    <div
      className="
        group relative w-full bg-white rounded-2xl shadow-md border-4 border-x-white border-b-white border-t-gray-100
        px-4 pt-5 pb-3 flex flex-col items-center hover:border-4 hover:border-orange-400 transition duration-100
      "
    >
      {/* progress stripe */}
      <div className="absolute top-0 left-0 w-full h-[5px] rounded-full bg-neutral-300 group-hover:opacity-0 transition duration-100">
        <div
          className={`h-full rounded-full ${pct < 100 ? "bg-gradient-to-r from-pink-300 to-pink-400" : "bg-gradient-to-r from-[#ff5e00] to-[#ff9600]"}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* image */}
      <div className="w-full aspect-[4/3] mb-4">
        <img src={token.image} alt={token.name} className="w-full h-full object-cover rounded-lg" />
      </div>

      {/* info */}
      <h3 className="text-lg font-semibold text-neutral-800">{token.name}</h3>
      <p className="mt-2 text-md font-semibold text-neutral-700">{token.amount} {token.symbol}</p>
      <p className={`mt-1 text-md font-semibold ${token.change >= 0 ? "text-[#00a300]" : "text-red-500"}`}>
        {valuePerToken.toFixed(2)} USDC {token.change}%
      </p>

      {/* hover actions */}
      <div className="absolute inset-0 rounded-xl bg-black/30 hidden group-hover:flex flex-col items-center justify-center gap-3 transition duration-100">
        <button
          onClick={openModal}
          className="w-[230px] px-10 py-2 rounded-md bg-gradient-to-r from-[#ff7700] to-[#ff03b8]
                     text-white font-semibold hover:brightness-110"
        >
          Lending
        </button>

        <button
          onClick={openStake}
          className="w-[230px] px-10 py-2 rounded-md bg-gradient-to-r from-[#ff7700] to-[#ff03b8]
                     text-white font-semibold hover:brightness-110"
        >
          Stake
        </button>

        <button
          onClick={handleTrade}
          className="w-[230px] px-10 py-2 rounded-md bg-gradient-to-r from-[#ff7700] to-[#ff03b8]
                     text-white font-semibold hover:brightness-110"
        >
          Trade
        </button>

        {canRedeem ? (
          <button
            onClick={handleRedeem}
            className="w-[220px] px-7 py-2 rounded-md border-2 border-pink-500
                       bg-white backdrop-blur text-pink-500 font-semibold hover:bg-pink-100"
          >
            Redeem
          </button>
        ) : (
          <span className="p-2 text-md text-neutral-700 font-semibold rounded-md bg-white/90">
            Need 1000 tokens to redeem
          </span>
        )}
      </div>

      {/* --- Lending Modal --- */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => { if (canBackdropClose) closeModal(); }}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {submitState === "idle" && (
              <>
                <div className="flex items-start justify-between">
                  <h2 className="text-xl font-semibold text-neutral-900">Lend {token.symbol}</h2>
                  <button
                    onClick={closeModal}
                    className="rounded-md px-2 py-1 text-neutral-500 hover:bg-neutral-100"
                    aria-label="Close"
                  >
                    ✕
                  </button>
                </div>

                <p className="mt-2 text-sm text-neutral-600">
                  You have <span className="font-semibold">{maxAmount}</span> {token.symbol}.
                </p>

                <label className="mt-4 block text-sm font-medium text-neutral-800">
                  Amount to lend ({token.symbol})
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.000001"
                  placeholder={`Max: ${maxAmount}`}
                  value={lendAmount}
                  onChange={(e) => setLendAmount(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-400"
                />

                <div className="mt-3 text-sm text-neutral-700">
                  <div className="flex justify-between">
                    <span>Estimated you can borrow (70%):</span>
                    <span className="font-semibold">{formatXRP(estimatedXRP)} USDC</span>
                  </div>
                  <div className="mt-1 flex justify-between text-neutral-500">
                    <span>Price per token:</span>
                    <span>{valuePerToken.toFixed(6)} USDC</span>
                  </div>
                  <div className="mt-1 flex justify-between text-neutral-500">
                    <span>Remaining after lend:</span>
                    <span>{isNumberLend ? Math.max(0, maxAmount - numericLend) : maxAmount} {token.symbol}</span>
                  </div>
                </div>

                {error && (
                  <div className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
                )}

                <div className="mt-6 flex gap-3">
                  <button
                    onClick={() => setLendAmount(String(maxAmount))}
                    className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium hover:bg-neutral-50"
                    type="button"
                  >
                    Max
                  </button>

                  <div className="flex-1" />

                  <button
                    onClick={closeModal}
                    className="rounded-md px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-100"
                    type="button"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={async () => {
                      setError("");
                      if (!isNumberLend || numericLend <= 0) { setError("Please enter a valid number greater than 0."); return; }
                      if (numericLend > maxAmount) { setError(`You only have ${maxAmount} ${token.symbol}.`); return; }
                      await handleSubmit(numericLend);
                    }}
                    disabled={!withinBalanceLend}
                    className={`rounded-md px-4 py-2 text-sm font-semibold text-white
                      ${withinBalanceLend
                        ? "bg-gradient-to-r from-[#ff7700] to-[#ff03b8] hover:brightness-110"
                        : "bg-neutral-300 cursor-not-allowed"}`}
                    type="button"
                  >
                    Confirm
                  </button>
                </div>
              </>
            )}

            {submitState === "submitting" && (
              <div className="flex flex-col items-center justify-center py-10">
                <div className="w-10 h-10 rounded-full border-4 border-neutral-200 border-t-pink-500 animate-spin" />
                <p className="mt-4 text-sm text-neutral-700">Submitting, please wait...</p>
              </div>
            )}

            {submitState === "success" && (
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
                    Successfully borrowed <span className="font-semibold">{formatXRP(submittedXRP)} USDC</span>.
                  </p>
                  <p className="mt-1 text-xs text-neutral-500">
                    The funds should arrive in your wallet within a few minutes.
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

      {/* --- Stake Modal --- */}
      {showStakeModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => { if (canStakeBackdropClose) closeStake(); }}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {stakeState === "idle" && (
              <>
                <div className="flex items-start justify-between">
                  <h2 className="text-xl font-semibold text-neutral-900">Stake {token.symbol}</h2>
                  <button
                    onClick={closeStake}
                    className="rounded-md px-2 py-1 text-neutral-500 hover:bg-neutral-100"
                    aria-label="Close"
                  >
                    ✕
                  </button>
                </div>

                <p className="mt-2 text-sm text-neutral-600">
                  You can stake up to <span className="font-semibold">{maxAmount}</span> {token.symbol}.
                </p>

                <label className="mt-4 block text-sm font-medium text-neutral-800">
                  Amount to stake ({token.symbol})
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.000001"
                  placeholder={`Max: ${maxAmount}`}
                  value={stakeAmount}
                  onChange={(e) => setStakeAmount(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-400"
                />

                <div className="mt-3 text-sm text-neutral-700">
                  <div className="flex justify-between text-neutral-500">
                    <span>Remaining after stake:</span>
                    <span>{isNumberStake ? Math.max(0, maxAmount - numericStake) : maxAmount} {token.symbol}</span>
                  </div>
                </div>

                {stakeError && (
                  <div className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{stakeError}</div>
                )}

                <div className="mt-6 flex gap-3">
                  <button
                    onClick={() => setStakeAmount(String(maxAmount))}
                    className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium hover:bg-neutral-50"
                    type="button"
                  >
                    Max
                  </button>

                  <div className="flex-1" />

                  <button
                    onClick={closeStake}
                    className="rounded-md px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-100"
                    type="button"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleStakeConfirm}
                    disabled={!withinBalanceStake}
                    className={`rounded-md px-4 py-2 text-sm font-semibold text-white
                      ${withinBalanceStake
                        ? "bg-gradient-to-r from-[#ff7700] to-[#ff03b8] hover:brightness-110"
                        : "bg-neutral-300 cursor-not-allowed"}`}
                    type="button"
                  >
                    Confirm
                  </button>
                </div>
              </>
            )}

            {stakeState === "submitting" && (
              <div className="flex flex-col items-center justify-center py-10">
                <div className="w-10 h-10 rounded-full border-4 border-neutral-200 border-t-pink-500 animate-spin" />
                <p className="mt-4 text-sm text-neutral-700">Submitting, please wait...</p>
              </div>
            )}

            {stakeState === "success" && (
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
                    Successfully staked{" "}
                    <span className="font-semibold">{formatToken(stakedAmount)} {token.symbol}</span>.
                  </p>
                  <p className="mt-1 text-xs text-neutral-500">
                    Your position is now active.
                  </p>
                </div>

                <div className="mt-6 flex justify-end">
                  <button
                    onClick={closeStake}
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
  );
};

export default HoldingCard;
