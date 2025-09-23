/*
  Simple Express server to serve the landing page and handle Stripe Checkout.
  Replace the placeholder secret key with your own Stripe secret key before
  deploying. The server exposes one POST endpoint, /create-checkout-session,
  which creates a new subscription checkout session for the MYND Matters Pack
  priced at $248 per month.
*/

const express = require('express');
const path = require('path');
// Load environment variables from a .env file if present. This allows us to
// keep secrets like your Stripe API key out of version control. See .env.
require('dotenv').config();
// Initialize Stripe using the secret key from the environment. Do NOT hard‑code
// your secret key here. Set STRIPE_SECRET_KEY in a .env file or in your
// hosting provider’s environment variable settings.
const cookieParser = require('cookie-parser');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const PORT = process.env.PORT || 8000;

// Parse bodies first
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Cookies
app.use(cookieParser());

// ===== Path-based affiliate capture + canonical/HTTPS =====
const PRIMARY_DOMAIN = 'myndmatterspack.com';
const COOKIE_DOMAIN  = '.' + PRIMARY_DOMAIN;        // share cookie across apex & www
const COOKIE_MAX_AGE = 90 * 24 * 60 * 60 * 1000;    // 90 days

// Paths we know are real pages or folders (never treat these as affiliate slugs)
const RESERVED = new Set([
  '', 'index.html', 'success.html', 'cancel.html',
  'checkout.html', 'delivery-details.html',
  'checkout.js', 'script.js', 'style.css',
  'robots.txt', 'sitemap.xml', 'favicon.ico',
  // optional top-level asset folders:
  'images', 'img', 'assets',
  'create-checkout-session'
]);

// Treat requests that *end* with a known file extension as files (css/js/img/font/…)
const FILE_EXT_RE = /\.(?:css|js|mjs|map|png|jpe?g|gif|webp|avif|svg|ico|bmp|json|txt|xml|woff2?|ttf|eot|otf|mp4|webm|ogg|wav|pdf)$/i;

app.use((req, res, next) => {
  // --- let non-GET requests bypass affiliate logic entirely ---
  if (req.method !== 'GET') return next();
  
  const host  = (req.headers.host || '').split(':')[0];
  const first = (req.path.split('/').filter(Boolean)[0] || '').toLowerCase();
  const looksLikeFile = FILE_EXT_RE.test(req.path); // <-- check the full path, not just `first`

  // 1) Force HTTPS behind Render's proxy
  if (req.headers['x-forwarded-proto'] && req.headers['x-forwarded-proto'] !== 'https') {
    return res.redirect(301, 'https://' + host + req.originalUrl);
  }

  // 2) Capture affiliate slug from the first path segment (if any)
  let slug = null;
  if (first && !RESERVED.has(first) && !looksLikeFile) {
    slug = first;
  }

  // If we captured a slug, set the cookie and strip it from the URL by redirecting home
  if (slug) {
    res.cookie('aff', slug, {
      domain: COOKIE_DOMAIN,
      maxAge: COOKIE_MAX_AGE,
      sameSite: 'Lax',
      secure: true,
      httpOnly: false
    });
    // Redirect to home on the canonical host (www for consistency)
    const targetHost = (host === PRIMARY_DOMAIN) ? 'www.' + PRIMARY_DOMAIN : host;
    return res.redirect(302, 'https://' + targetHost + '/');
  }

  // 3) Canonical apex -> www (after possible slug capture)
  if (host === PRIMARY_DOMAIN) {
    return res.redirect(301, 'https://www.' + PRIMARY_DOMAIN + req.originalUrl);
  }

  next();
});
// ===== end affiliate middleware =====

// Serve static files
app.use(express.static(__dirname));

// ---- Stripe Webhook (MUST be before express.json) ----
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

app.post('/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      // Ensure the Subscription carries the metadata (belt & braces)
      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session.mode === 'subscription' && session.subscription) {
          await stripe.subscriptions.update(session.subscription, {
            metadata: { ...session.metadata },
          });
        }
        break;
      }

      // Copy metadata onto every invoice that gets created
      case 'invoice.created': {
        const invoice = event.data.object;

        // Start with whatever metadata is already on the invoice
        let meta = { ...invoice.metadata };

        // Merge in subscription metadata if present
        if (invoice.subscription) {
          const sub = await stripe.subscriptions.retrieve(invoice.subscription);
          meta = { ...meta, ...sub.metadata };
        }

        // Optionally merge in customer metadata as a fallback
        if (invoice.customer) {
          const customer = await stripe.customers.retrieve(invoice.customer);
          meta = { ...meta, ...customer.metadata };
        }

        if (Object.keys(meta).length) {
          await stripe.invoices.update(invoice.id, { metadata: meta });
        }
        break;
      }

      default:
        // no-op for other events
        break;
    }

    res.json({ received: true });
  } catch (err) {
    console.error('Webhook handler failed:', err);
    res.status(500).end();
  }
});

// Parse JSON bodies
app.use(express.json());

// Route to create a checkout session
app.post('/create-checkout-session', async (req, res) => {
  try {
    // Extract customer details from the request body, if provided
    const { name, email, phone, address1, address2, postalCode, affiliate } = req.body || {};

    // Be very defensive pulling the affiliate value:
    const aff = (affiliate || req.affiliate || (req.cookies && req.cookies.aff) || '')
      .toString()
      .trim();

    // Use one object everywhere so it’s identical across Stripe objects
    const baseMeta = {
      affiliate: aff,
      name: name || '',
      phone: phone || '',
      address_line1: address1 || '',
      address_line2: address2 || '',
      postal_code: postalCode || ''
    };

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'sgd',
            unit_amount: 100,                 // S$258.00
            product_data: {
              name: '1-month supply of The MYND Matters Pack',
              description: 'One-time purchase of a 1-month supply',
            },
          },
          quantity: 1,
        },
      ],

      // Helps Stripe tie the payment to a customer + send receipt
      customer_email: email || undefined,

      // Keep the same metadata everywhere
  metadata: baseMeta,                        // on the Checkout Session
  payment_intent_data: { metadata: baseMeta }, // on the PaymentIntent/Charge

  // >>> NEW: also put it on the Invoice Stripe will create for this payment
  invoice_creation: {
    enabled: true,
    invoice_data: {
      metadata: baseMeta,
      // Optional extras:
      // description: 'One-time invoice for MYND Matters Pack',
      // footer: 'Thanks for your purchase!',
      // custom_fields: [{ name: 'Affiliate', value: baseMeta.affiliate || '' }],
    },
  },

  success_url: `https://${req.get('host')}/success.html`,
  cancel_url:  `https://${req.get('host')}/cancel.html`,
});

    res.json({ url: session.url });
  } catch (err) {
    console.error(
      'Error creating checkout session:',
      err?.type || '',
      err?.code || '',
      err?.message || err
    );
    res.status(500).json({ error: 'Unable to create checkout session' });
  }
});

// Fallback for any unknown route
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
