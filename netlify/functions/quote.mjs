// The customer's price page (/quote/) talks to this. It only works with the private link
// the shop sends them (order id + key), and only after the shop has set a price.
// If card payments are turned on (STRIPE_SECRET_KEY), "Yes" sends them to Stripe to pay.
import { getStore } from "@netlify/blobs";
import { paymentsOn, stripe, syncPayment } from "../lib/stripe.mjs";

const ID_PATTERN = /^\d{14}-[a-z0-9]{6}$/;

// What the customer is allowed to see about their own order
const forCustomer = (o) => ({
  id: o.id,
  name: o.name,
  createdAt: o.createdAt,
  items: o.items || [],
  quote: o.quote || null,
  response: o.response || null,
  paid: o.paid || null,
  canPay: paymentsOn() && !!(o.quote && o.quote.amountCents),
  status: o.status,
  mockups: (o.uploads || []).filter((u) => u.kind === "mockup").map((u) => ({ key: u.key, name: u.name }))
});

const orderSummary = (o) => (o.items || [])
  .map((it) => (it.total || "") + " " + (it.product || ""))
  .join(", ")
  .slice(0, 400);

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
    // Coming back from Stripe: check whether the payment went through
    let justPaid = false;
    if (url.searchParams.get("session_id") || (order.payment && !order.paid)) {
      try {
        justPaid = await syncPayment(order);
        if (justPaid) await orders.setJSON(id, order);
      } catch (err) { /* Stripe hiccup: show the page anyway */ }
    }
    return Response.json({ ...forCustomer(order), justPaid });
  }

  if (req.method === "POST") {
    let body;
    try { body = await req.json(); } catch { return new Response("Bad request", { status: 400 }); }
    if (order.status === "done" || order.paid) return Response.json(forCustomer(order));

    // "Yes, pay now": record the yes, then open a Stripe checkout for the quoted amount
    if (body.action === "pay") {
      if (!paymentsOn() || !order.quote.amountCents) return new Response("Card payments aren't set up yet", { status: 400 });
      order.response = { answer: "accept", message: String(body.message || "").trim().slice(0, 1000), at: new Date().toISOString() };
      if (order.status !== "paid") order.status = "approved";
      const back = url.origin + "/quote/?id=" + encodeURIComponent(id) + "&k=" + encodeURIComponent(k);
      const session = await stripe("checkout/sessions", {
        mode: "payment",
        client_reference_id: id,
        "metadata[order_id]": id,
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": "usd",
        "line_items[0][price_data][unit_amount]": String(order.quote.amountCents),
        "line_items[0][price_data][product_data][name]": "Tiki T's custom order",
        "line_items[0][price_data][product_data][description]": orderSummary(order) || "Custom printed order",
        success_url: back + "&session_id={CHECKOUT_SESSION_ID}",
        cancel_url: back
      });
      order.payment = { sessionId: session.id, startedAt: new Date().toISOString() };
      await orders.setJSON(id, order);
      return Response.json({ url: session.url });
    }

    if (!["accept", "decline"].includes(body.answer)) return new Response("Bad answer", { status: 400 });
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
