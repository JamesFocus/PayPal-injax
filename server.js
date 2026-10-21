require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const fs = require("fs");
const path = require("path");
const paypal = require("@paypal/checkout-server-sdk");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "payments.json");
const CURRENCY = (process.env.CURRENCY || "USD").toUpperCase();
const MIN_PAYMENT = Number(process.env.MIN_PAYMENT || 1);
const MAX_PAYMENT = Number(process.env.MAX_PAYMENT || 10000);

if (!["sandbox", "live"].includes(process.env.PAYPAL_MODE || "sandbox")) {
  throw new Error("PAYPAL_MODE must be sandbox or live");
}
fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, "[]", "utf8");

function readPayments() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); } catch { return []; }
}
function writePayments(items) {
  const tmp = DB_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(items, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, DB_FILE);
}
function configured() {
  return Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET &&
    !process.env.PAYPAL_CLIENT_ID.startsWith("replace_") &&
    !process.env.PAYPAL_CLIENT_SECRET.startsWith("replace_"));
}
function client() {
  const env = process.env.PAYPAL_MODE === "live"
    ? new paypal.core.LiveEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET)
    : new paypal.core.SandboxEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET);
  return new paypal.core.PayPalHttpClient(env);
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "100kb" }));
app.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/config", (_req, res) => res.json({
  clientId: configured() ? process.env.PAYPAL_CLIENT_ID : "",
  currency: CURRENCY,
  storeName: process.env.STORE_NAME || "Calduty Store",
  minPayment: MIN_PAYMENT,
  maxPayment: MAX_PAYMENT,
  configured: configured()
}));

app.post("/api/orders", async (req, res) => {
  try {
    if (!configured()) return res.status(503).json({ error: "PayPal is not configured. The store administrator must complete setup." });
    const amount = Number(req.body.amount);
    if (!Number.isFinite(amount) || amount < MIN_PAYMENT || amount > MAX_PAYMENT ||
        Math.round(amount * 100) !== amount * 100) {
      return res.status(400).json({ error: `Enter ${MIN_PAYMENT.toFixed(2)}–${MAX_PAYMENT.toFixed(2)} ${CURRENCY}, with at most two decimal places.` });
    }
    const request = new paypal.orders.OrdersCreateRequest();
    request.prefer("return=representation");
    request.requestBody({
      intent: "CAPTURE",
      purchase_units: [{
        reference_id: "calduty-store-payment",
        description: "Calduty store purchase",
        amount: { currency_code: CURRENCY, value: amount.toFixed(2) }
      }],
      application_context: {
        brand_name: (process.env.STORE_NAME || "Calduty Store").slice(0, 127),
        user_action: "PAY_NOW",
        shipping_preference: "NO_SHIPPING"
      }
    });
    const result = await client().execute(request);
    const payments = readPayments();
    payments.push({
      orderId: result.result.id, amount: amount.toFixed(2), currency: CURRENCY,
      status: "CREATED", createdAt: new Date().toISOString(),
      capturedAt: null, captureId: null, payerEmail: null
    });
    writePayments(payments);
    res.json({ id: result.result.id });
  } catch (err) {
    console.error("Create order failed:", err.message);
    res.status(502).json({ error: "Could not create PayPal order. Please try again." });
  }
});

app.post("/api/orders/:id/capture", async (req, res) => {
  try {
    if (!configured()) return res.status(503).json({ error: "PayPal is not configured." });
    const orderId = String(req.params.id || "");
    const payments = readPayments();
    const saved = payments.find(p => p.orderId === orderId);
    if (!saved) return res.status(404).json({ error: "Order not found." });
    if (saved.status === "COMPLETED") {
      return res.json({ status: "COMPLETED", message: "Payment already confirmed.", receipt: receipt(saved) });
    }
    const request = new paypal.orders.OrdersCaptureRequest(orderId);
    request.requestBody({});
    const response = await client().execute(request);
    const result = response.result;
    const unit = result.purchase_units && result.purchase_units[0];
    const capture = unit && unit.payments && unit.payments.captures && unit.payments.captures[0];
    if (result.status !== "COMPLETED" || !capture || capture.status !== "COMPLETED") {
      return res.status(409).json({ error: "PayPal has not confirmed a completed payment. Do not fulfil the order yet." });
    }
    if (capture.amount.currency_code !== saved.currency || capture.amount.value !== saved.amount) {
      console.error("Amount/currency mismatch for PayPal order", orderId);
      return res.status(409).json({ error: "Confirmed payment does not match the expected amount. Contact the store." });
    }
    saved.status = "COMPLETED";
    saved.capturedAt = new Date().toISOString();
    saved.captureId = capture.id;
    saved.payerEmail = result.payer && result.payer.email_address ? result.payer.email_address : null;
    writePayments(payments);
    console.log(`CALDUTY PAYMENT COMPLETED: ${saved.amount} ${saved.currency}; order ${saved.orderId}`);
    res.json({ status: "COMPLETED", message: "Payment confirmed. The store has been notified.", receipt: receipt(saved) });
  } catch (err) {
    console.error("Capture failed:", err.message);
    res.status(502).json({ error: "Could not confirm payment with PayPal. Check order status before retrying." });
  }
});
function receipt(p) {
  return { orderId: p.orderId, amount: p.amount, currency: p.currency, status: p.status, capturedAt: p.capturedAt };
}

// Owner API feed. Set ADMIN_TOKEN in .env; never put this token in frontend code.
app.get("/api/admin/payments", (req, res) => {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected || req.get("x-admin-token") !== expected) {
    return res.status(401).json({ error: "Admin authentication required." });
  }
  res.json(readPayments().slice().reverse().map(p => ({
    orderId: p.orderId, amount: p.amount, currency: p.currency, status: p.status,
    createdAt: p.createdAt, capturedAt: p.capturedAt, captureId: p.captureId, payerEmail: p.payerEmail
  })));
});

// Optional PayPal webhook with server-side signature verification.
app.post("/api/paypal/webhook", async (req, res) => {
  try {
    if (!configured() || !process.env.PAYPAL_WEBHOOK_ID) {
      return res.status(503).json({ error: "Webhook is not configured." });
    }
    const verify = new paypal.notifications.WebhookEventVerifyRequest();
    verify.requestBody({
      auth_algo: req.get("paypal-auth-algo"),
      cert_url: req.get("paypal-cert-url"),
      transmission_id: req.get("paypal-transmission-id"),
      transmission_sig: req.get("paypal-transmission-sig"),
      transmission_time: req.get("paypal-transmission-time"),
      webhook_id: process.env.PAYPAL_WEBHOOK_ID,
      webhook_event: req.body
    });
    const verification = await client().execute(verify);
    if (verification.result.verification_status !== "SUCCESS") {
      return res.status(400).json({ error: "Webhook signature verification failed." });
    }
    console.log("Verified PayPal webhook event:", req.body.event_type);
    res.sendStatus(200);
  } catch (err) {
    console.error("Webhook verification failed:", err.message);
    res.status(400).json({ error: "Could not verify webhook." });
  }
});

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "calduty" }));
app.listen(PORT, () => console.log(`Calduty running at ${process.env.BASE_URL || `http://localhost:${PORT}`}`));
