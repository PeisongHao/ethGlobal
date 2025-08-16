import React, { useContext } from "react"
import { FlowWalletContext } from "../../context/WalletContext"; 

export default function OrderHistory({tokenId,orders,className = "" }) {
  const { flowAddress } = useContext(FlowWalletContext);
  const myOrders = orders.filter(order =>
    order.buyer === flowAddress || order.seller === flowAddress
  );
  myOrders.sort((a, b) => {
    return new Date(b.time) - new Date(a.time);
  });
  const demoOrders = myOrders.map(order => ({
    token: tokenId,
    side: order.buyer === flowAddress ? "Buy" : "Sell",
    amount: order.quantity,
    value: order.price,
    status: "Filled"
  }));

  return (
    <div
      className={`flex-1 overflow-y-auto bg-gray-50 rounded-xl p-4 ${className}`}
    >
      <h3 className="text-lg font-bold mb-2">Order History</h3>
      <table className="w-full text-md">
        <thead>
          <tr className="text-left border-b">
            <Th>Token</Th>
            <Th>Type</Th>
            <Th>Amount</Th>
            <Th>Value XRP</Th>
            <Th>Status</Th>
          </tr>
        </thead>

        <tbody>
          {demoOrders.map((o, i) => (
            <tr key={i} className="border-b last:border-none">
              <Td>{o.token}</Td>
              <Td className={o.side === "Buy" ? "text-[#00a300]" : "text-red-500"}>
                {o.side}
              </Td>
              <Td>{o.amount}</Td>
              <Td>{o.value.toFixed(2)}</Td>
              <Td>
                <span
                  className={`px-2 py-0.5 rounded-md text-md
                    ${o.status === "Filled"
                      ? "bg-orange-100 text-[#ff7700]"
                      : "bg-pink-100 text-pink-500"}`}
                >
                  {o.status}
                </span>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* internal helpers */
const Th = ({ children }) => <th className="py-1 pr-4 font-semibold">{children}</th>
const Td = ({ children, className = "" }) => (
  <td className={`py-2 pr-4 align-top ${className}`}>{children}</td>
)
