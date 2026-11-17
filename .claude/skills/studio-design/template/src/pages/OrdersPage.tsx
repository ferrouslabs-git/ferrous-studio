import { ORDERS } from "../data";
import { useGo } from "../lib/nav";

export function OrdersPage() {
  const go = useGo();
  return (
    <div className="page">
      <h1>Orders</h1>
      <table className="table">
        <thead>
          <tr>
            <th>Order</th>
            <th>Customer</th>
            <th>Total</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {ORDERS.map((order) => (
            <tr key={order.id} onClick={() => go("page-order")}>
              <td>{order.id}</td>
              <td>{order.customer}</td>
              <td>{order.total}</td>
              <td>
                <span className="badge">{order.status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
