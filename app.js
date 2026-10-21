const amountInput = document.getElementById("amount");
const totalEl = document.getElementById("total");
const statusEl = document.getElementById("status");
const receiptEl = document.getElementById("receipt");
const buttonContainer = document.getElementById("paypal-button-container");
let config = null;
let buttonsRendered = false;
document.getElementById("year").textContent = new Date().getFullYear();

function money(amount) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: config?.currency || "USD" }).format(Number(amount) || 0);
}
function setStatus(message, type = "") {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
}
function updateTotal() { totalEl.textContent = `${money(amountInput.value)} ${config?.currency || "USD"}`; }
function validAmount() {
  const value = Number(amountInput.value);
  return Number.isFinite(value) && value >= config.minPayment && value <= config.maxPayment &&
    Math.round(value * 100) === value * 100;
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[ch]));
}
async function init() {
  try {
    const response = await fetch("/api/config");
    config = await response.json();
    document.getElementById("currency-label").textContent = config.currency;
    document.getElementById("currency-symbol").textContent = config.currency === "THB" ? "฿" : config.currency === "EUR" ? "€" : "$";
    amountInput.min = config.minPayment;
    amountInput.max = config.maxPayment;
    amountInput.value = Math.max(config.minPayment, 25).toFixed(2);
    updateTotal();
    if (!config.configured) {
      setStatus("Setup required: the store administrator must add PayPal credentials to .env. No real payment can be taken yet.", "error");
      return;
    }
    const script = document.createElement("script");
    script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(config.clientId)}&currency=${encodeURIComponent(config.currency)}&intent=capture`;
    script.onload = renderButtons;
    script.onerror = () => setStatus("PayPal checkout could not load. Check connection and PayPal settings.", "error");
    document.head.appendChild(script);
  } catch {
    setStatus("Could not load checkout settings. Please refresh.", "error");
  }
}
function renderButtons() {
  if (buttonsRendered || !window.paypal) return;
  buttonsRendered = true;
  window.paypal.Buttons({
    style: { layout: "vertical", shape: "rect", label: "paypal", tagline: false },
    onClick: (_data, actions) => {
      if (!validAmount()) {
        setStatus(`Enter an amount from ${config.minPayment.toFixed(2)} to ${config.maxPayment.toFixed(2)} ${config.currency}.`, "error");
        return actions.reject();
      }
      receiptEl.classList.add("hidden");
      setStatus("Continue in PayPal to approve the payment.");
      return actions.resolve();
    },
    createOrder: async () => {
      const response = await fetch("/api/orders", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: Number(amountInput.value).toFixed(2) })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to create order.");
      return data.id;
    },
    onApprove: async data => {
      setStatus("Approved by PayPal. Confirming payment securely…");
      const response = await fetch(`/api/orders/${encodeURIComponent(data.orderID)}/capture`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Payment confirmation failed.");
      setStatus("Payment completed and confirmed by PayPal.", "success");
      receiptEl.innerHTML = `<strong>Payment confirmed ✓</strong><br>Order: ${escapeHtml(result.receipt.orderId)}<br>Amount: ${escapeHtml(result.receipt.amount)} ${escapeHtml(result.receipt.currency)}<br>Status: ${escapeHtml(result.receipt.status)}<br>Keep your order ID for reference.`;
      receiptEl.classList.remove("hidden");
      buttonContainer.innerHTML = "";
      buttonsRendered = false;
    },
    onCancel: () => setStatus("Checkout cancelled. No completed payment was recorded."),
    onError: err => { console.error(err); setStatus(err.message || "Checkout error. Check payment status before retrying.", "error"); }
  }).render("#paypal-button-container");
}
amountInput.addEventListener("input", updateTotal);
init();
