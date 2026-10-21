# Calduty — PayPal checkout web app

Calduty is a Node.js/Express starter for a browser-based payment page. Buyers enter an amount, approve payment through PayPal, and the server captures and verifies the payment before showing a receipt. The store receives funds through its connected PayPal merchant account under PayPal's account and transaction terms.

**Important:** this package is a starter, not a guarantee of PayPal approval or a substitute for a production security review. Test with PayPal Sandbox first. PayPal decides whether debit/credit card options are available for a specific merchant, buyer, region, and account. Calduty does not directly collect card numbers or PayPal passwords.

## Included files

- `public/index.html`, `public/styles.css`, `public/app.js` — responsive checkout interface.
- `server.js` — Node.js backend for order creation, server-side capture, amount/currency checks, owner payment feed, and optional webhook verification.
- `.env.example` — configuration template.
- `.gitignore` — excludes `.env`, data, and dependencies.
- `data/payments.json` is created on first run and stores payment records locally.

## Requirements

- Node.js 20+ and npm.
- PayPal Developer account and a REST API app.
- A PayPal merchant account eligible to receive the payments you intend to accept.

## Quick start

1. Unzip the file and open a terminal in the `calduty` directory.
2. Install dependencies:

   ```bash
   npm install
   ```

3. Copy `.env.example` to `.env`.
   - Windows PowerShell: `Copy-Item .env.example .env`
   - macOS/Linux: `cp .env.example .env`
4. In the PayPal Developer Dashboard, create a REST app and copy its **Sandbox Client ID** and **Sandbox Secret** into `.env`.
5. Keep these settings for testing:

   ```env
   PAYPAL_MODE=sandbox
   BASE_URL=http://localhost:3000
   CURRENCY=USD
   ```

6. Start the server:

   ```bash
   npm start
   ```

7. Open `http://localhost:3000`. Use a PayPal Sandbox buyer account to test; Sandbox does not move real money.
8. When testing is complete, deploy behind HTTPS, configure the live app credentials in your hosting environment, and change `PAYPAL_MODE=live`. Do not switch to live until your merchant account and checkout are ready.

## Payment procedure

1. Buyer enters an amount on the Calduty page.
2. Browser calls `POST /api/orders`; the backend validates the amount and creates a PayPal order.
3. Buyer approves the payment on PayPal. If PayPal offers a card option, the buyer may use an eligible debit/credit card.
4. Browser sends the PayPal order ID to `POST /api/orders/:id/capture`.
5. The backend captures the order with PayPal and checks that the capture is `COMPLETED` and the amount/currency exactly match the stored order.
6. Calduty saves the payment record, shows the buyer a receipt, and logs a payment-completed notification on the server. The merchant sees the funds in PayPal according to PayPal's processing and settlement rules.

## Store payment notifications

The server logs a message when a payment is confirmed. To retrieve a payment list for an owner dashboard, set a strong secret in `.env`:

```env
ADMIN_TOKEN=use-a-long-random-secret
```

Restart the app, then request:

```bash
curl -H "x-admin-token: YOUR_TOKEN" http://localhost:3000/api/admin/payments
```

This is a protected API endpoint, not a finished admin login page. Do not put `ADMIN_TOKEN` into browser JavaScript or publish it. For a public production service, replace it with proper admin authentication, role-based access, audit logs, and secure secret storage.

## Optional PayPal webhook notifications

1. Deploy the app to a public HTTPS domain.
2. In the PayPal Developer Dashboard, add a webhook for the same Sandbox/Live app at:
   `https://YOUR-DOMAIN.example/api/paypal/webhook`
3. Subscribe to `PAYMENT.CAPTURE.COMPLETED`.
4. Put the webhook ID in `.env` as `PAYPAL_WEBHOOK_ID`.
5. Ensure `PAYPAL_MODE` matches the app that owns the webhook, then restart.

Calduty verifies webhook signatures through PayPal before accepting events. The included webhook handler logs verified event types. Add a suitable email, LINE, or other messaging provider separately if you want owner notifications delivered outside the server log.

## Important production checklist

- Use HTTPS in production.
- Keep `PAYPAL_CLIENT_SECRET`, `ADMIN_TOKEN`, and webhook configuration only on the server.
- Do not commit `.env` to Git; `.gitignore` excludes it. `.env.example` is a safe template and contains no real secrets.
- Use a persistent database such as PostgreSQL for production. Local JSON storage can be lost on hosting platforms with ephemeral filesystems and is not designed for concurrent/high-volume transactions.
- Add idempotency/reconciliation, backups, monitoring, proper admin authentication, refund/chargeback handling, and order fulfilment logic.
- Do not fulfill an order based only on a browser redirect or screenshot. Use server-confirmed payment status and reconcile with PayPal.
- PayPal checkout does not automatically guarantee the seller receives a buyer's postal address. This starter uses `NO_SHIPPING` and does not collect shipping addresses. If you sell physical goods, design an explicit shipping-address flow and configure PayPal's appropriate shipping preference and consent.
- Review PayPal fees, business eligibility, privacy, consumer protection, and tax requirements before going live.

## API reference

- `GET /api/config` — public checkout settings (never returns the secret).
- `POST /api/orders` with `{"amount":"25.00"}` — create PayPal order.
- `POST /api/orders/:id/capture` — capture and verify payment.
- `GET /api/admin/payments` — owner payment feed using `x-admin-token`.
- `POST /api/paypal/webhook` — verified PayPal webhook endpoint.
- `GET /api/health` — health check.

## Troubleshooting

- **Setup required message:** `.env` is missing, contains placeholders, or server was not restarted after editing.
- **PayPal buttons not loading:** verify the client ID, network access, currency support, and server logs.
- **Card option missing:** card funding is controlled by PayPal eligibility and may not be available for every account/region.
- **Webhook fails:** ensure the webhook ID and `PAYPAL_MODE` match the same PayPal app.
- **Records disappear after deployment:** switch to persistent database/storage.

Official guide: https://developer.paypal.com/docs/checkout/standard/
