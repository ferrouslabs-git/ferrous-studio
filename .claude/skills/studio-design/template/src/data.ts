// Sample data. An element whose `data.dataset` names one of the brief's
// `wireframe.datasets` takes its values from there; an element with
// `data.samples` carries its own. Keep the values the wireframe gives --
// they are what the people reviewing it expect to see.
export const ORDER_STATUSES = ["New", "Packed", "Shipped", "Delivered"];

export interface Order {
  id: string;
  customer: string;
  total: string;
  status: string;
}

export const ORDERS: Order[] = [
  { id: "SO-1042", customer: "Harlow & Finch", total: "£1,240.00", status: "Packed" },
  { id: "SO-1041", customer: "Northgate Supply", total: "£318.50", status: "Shipped" },
  { id: "SO-1040", customer: "Mere Lane Studio", total: "£92.00", status: "New" },
  { id: "SO-1039", customer: "Calder Works", total: "£2,075.25", status: "Delivered" },
];
