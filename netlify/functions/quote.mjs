// The customer's price page (/quote/) talks to this. It only works with the private link
// the shop sends them (order id + key), and only after the shop has set a price.
import { getStore } from "@netlify/blobs";

const ID_PATTERN = /^\d{14}-[a-z0-9]{6}$/;

// What the customer is allowed to see about their own order
const forCustomer = (o) => ({
  id: o.id,
  name: o.name,
  createdAt: o.createdAt,
  items: o.items || [],
  quote: o.quote || null,
  response: o.response || null,
  status: o.status,
  mockups: (o.uploads || []).filter((u) => u.kind === "mockup").map((u) => ({ key: u.key, name: u.name }))
});

export default async (req) => {
  const url = new URL(req.url);
  const id = url.searchParams.get("id") || "";
  const k = url.searchParams.get("k") || "";
  const notFound = () => new Response("We couldn't find that quote. Please check the link.", { status: 404 });
  if (!ID_PATTERN.test(id) || !/^[a-f0-9]{32}$/.test(k)) return notFound();

  const orders = getStore({ name: "orders", consistency: "strong" });
  const order = await orders.get(id, { type: "json" });
  if (!order || order.key !== k || !order.quote) return notFound();

  if (req.method === "GET") {
    const fileKey = url.searchParams.get("file");
    if (fileKey) {
      const upload = (order.uploads || []).find((u) => u.key === fileKey && u.kind === "mockup");
      if (!upload) return notFound();
      const data = await getStore({ name: "order-files", consistency: "strong" }).get(fileKey, { type: "arrayBuffer" });
      if (!data) return notFound();
      return new Response(data, { headers: { "Content-Type": upload.type || "image/png", "Cache-Control": "private, max-age=300" } });
    }
    return Response.json(forCustomer(order));
  }

  if (req.method === "POST") {
    let body;
    try { body = await req.json(); } catch { return new Response("Bad request", { status: 400 }); }
    if (!["accept", "decline"].includes(body.answer)) return new Response("Bad answer", { status: 400 });
    if (order.status === "done") return Response.json(forCustomer(order));
    order.response = {
      answer: body.answer,
      message: String(body.message || "").trim().slice(0, 1000),
      at: new Date().toISOString()
    };
    order.status = body.answer === "accept" ? "approved" : "declined";
    await orders.setJSON(id, order);
    return Response.json(forCustomer(order));
  }

  return new Response("Method not allowed", { status: 405 });
};
