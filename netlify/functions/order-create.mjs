// Saves a new quote request from the website so it shows up on the admin Orders page.
// The customer's files (artwork and shirt mockups) are sent afterwards to order-file.
import { getStore } from "@netlify/blobs";

const MAX_ORDER_BYTES = 200 * 1024;

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const raw = await req.text();
  if (raw.length > MAX_ORDER_BYTES) return new Response("Order is too large", { status: 413 });
  let data;
  try { data = JSON.parse(raw); } catch { return new Response("Bad request", { status: 400 }); }
  if (!data || typeof data !== "object" || !String(data.name || "").trim()) {
    return new Response("Missing name", { status: 400 });
  }
  const now = new Date();
  const id = now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14) + "-" + Math.random().toString(36).slice(2, 8);
  const order = { ...data, id, createdAt: now.toISOString(), status: "new", uploads: [] };
  await getStore("orders").setJSON(id, order);
  return Response.json({ id });
};
