// Small helper for Stripe card payments. The secret key lives in the Netlify environment
// variable STRIPE_SECRET_KEY (never in the website files).
export const paymentsOn = () => !!process.env.STRIPE_SECRET_KEY;

export async function stripe(path, params, method = "POST") {
  const res = await fetch("https://api.stripe.com/v1/" + path, {
    method,
    headers: {
      Authorization: "Bearer " + process.env.STRIPE_SECRET_KEY,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params ? new URLSearchParams(params).toString() : undefined
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data.error && data.error.message) || "Stripe error");
  return data;
}

// Ask Stripe whether this order's checkout was paid. Returns true the moment it's marked paid.
export async function syncPayment(order) {
  if (order.paid || !order.payment || !order.payment.sessionId || !paymentsOn()) return false;
  const session = await stripe("checkout/sessions/" + encodeURIComponent(order.payment.sessionId), null, "GET");
  if (session.payment_status !== "paid" || session.client_reference_id !== order.id) return false;
  order.paid = { at: new Date().toISOString(), amountCents: session.amount_total, sessionId: session.id };
  order.status = "paid";
  return true;
}
