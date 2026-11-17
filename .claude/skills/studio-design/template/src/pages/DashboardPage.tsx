import { ORDERS } from "../data";
import { useGo } from "../lib/nav";

export function DashboardPage() {
  const go = useGo();
  return (
    <div className="page">
      <h1>Dashboard</h1>
      <div className="stats">
        <article className="stat">
          <span className="stat-label">Open orders</span>
          <strong>{ORDERS.filter((order) => order.status !== "Delivered").length}</strong>
        </article>
        <article className="stat">
          <span className="stat-label">Orders this week</span>
          <strong>{ORDERS.length}</strong>
        </article>
      </div>
      <button className="button" onClick={() => go("page-orders")}>
        View orders
      </button>
    </div>
  );
}
