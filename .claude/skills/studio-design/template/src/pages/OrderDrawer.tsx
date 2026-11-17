// A page with `presentation: "drawer"`. It renders only its content: the
// drawer chrome and the close behaviour come from lib/Overlay.tsx.
import { ORDERS, ORDER_STATUSES } from "../data";
import { BACK, useGo } from "../lib/nav";

export function OrderDrawer() {
  const go = useGo();
  const order = ORDERS[0];
  return (
    <form className="form" onSubmit={(event) => (event.preventDefault(), go(BACK))}>
      <label>
        Customer
        <input defaultValue={order.customer} />
      </label>
      <label>
        Status
        <select defaultValue={order.status}>
          {ORDER_STATUSES.map((status) => (
            <option key={status}>{status}</option>
          ))}
        </select>
      </label>
      <div className="form-actions">
        <button type="button" className="button button-quiet" onClick={() => go(BACK)}>
          Cancel
        </button>
        <button type="submit" className="button">
          Save
        </button>
      </div>
    </form>
  );
}
