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

// ===== Path-based affiliate capture + canonical HTTPS/WWW =====
const PRIMARY_DOMAIN = 'myndmatterspack.com';
const COOKIE_DOMAIN  = '.' + PRIMARY_DOMAIN;                  // share cookie across apex + www
const COOKIE_MAX_AGE = 90 * 24 * 60 * 60 * 1000;             // 90 days

// Paths we know are real pages (never treat these as affiliate slugs)
const RESERVED = new Set([
  '', 'index.html', 'success.html', 'cancel.html',
  'checkout.html', 'delivery-details.html',
  'robots.txt', 'sitemap.xml', 'favicon.ico'
]);

// If the first path segment looks like a file (css/js/img/font/etc), ignore it.
// This prevents assets from being mistaken for an affiliate slug.
const FILE_EXT_RE = /\.(?:css|js|mjs|map|png|jpe?g|gif|webp|avif|svg|ico|bmp|json|txt|xml|woff2?|ttf|eot|otf|mp4|webm|ogg|wav|pdf)$/i;

app.use((req, res, next) => {
  const host  = (req.headers.host || '').split(':')[0];
  const first = req.path.split('/').filter(Boolean)[0];
  const looksLikeFile = first ? FILE_EXT_RE.test(first) : false;

  // 1) Always force HTTPS behind Render's proxy
  if (req.headers['x-forwarded-proto'] && req.headers['x-forwarded-proto'] !== 'https') {
    return res.redirect(301, 'https://' + host + req.originalUrl);
  }

  // 2) Treat first path segment as affiliate slug (if not a file or a reserved page)
  let slug = null;
  if (first && !RESERVED.has(first.toLowerCase()) && !looksLikeFile) {
    slug = first.toLowerCase();
  }

  if (slug) {
    // Set cookie for 90 days, share across apex & www
    res.cookie('aff', slug, {
      domain: COOKIE_DOMAIN,      // e.g. ".myndmatterspack.com"
      maxAge: COOKIE_MAX_AGE,     // e.g. 90 days
      sameSite: 'Lax',
      secure: true,
      httpOnly: false
    });
    req.affiliate = slug;

    // Redirect to the home page (strip the slug), prefer www for canonical
    const targetHost = (host === PRIMARY_DOMAIN) ? 'www.' + PRIMARY_DOMAIN : host;
    return res.redirect(302, `https://${targetHost}/`);
  }

  // 3) Canonical apex -> www (after possible slug capture above)
  if (host === PRIMARY_DOMAIN) {
    return res.redirect(301, `https://www.${PRIMARY_DOMAIN}${req.originalUrl}`);
  }

  next();
});
// ===== end affiliate middleware =====

// Serve static files (keep this AFTER the middleware)
app.use(express.static(__dirname));

// Parse JSON bodies
app.use(express.json());

// Route to create a checkout session
app.post('/create-checkout-session', async (req, res) => {
  try {
    // Extract customer details from the request body, if provided
    const { name, email, phone, address1, address2, postalCode, affiliate } = req.body || {};
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [
        {
          price_data: {
            currency: 'sgd',
            // Price is S$258 per month (amount in cents)
            unit_amount: 25800,
            recurring: { interval: 'month' },
            product_data: {
              name: 'The MYND Matters Pack',
              description: 'Monthly subscription for the MYND Matters Programme',
            },
          },
          quantity: 1,
        },
      ],
      // Attach customer email and metadata if provided
      customer_email: email || undefined,
      metadata: {
        name: name || '',
        phone: phone || '',
        address_line1: address1 || '',
        address_line2: address2 || '',
        postal_code: postalCode || '',
        affiliate: affiliate || req.affiliate || ''
      },
      // These URLs should be replaced with your deployed domain
      success_url: `${req.protocol}://${req.get('host')}/success.html`,
      cancel_url: `${req.protocol}://${req.get('host')}/cancel.html`,
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('Error creating checkout session', err);
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
