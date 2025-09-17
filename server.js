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
const COOKIE_DOMAIN  = '.' + PRIMARY_DOMAIN;       // share cookie across apex & www
const COOKIE_MAX_AGE = 90 * 24 * 60 * 60 * 1000;   // 90 days

// Paths used by your site that should NOT be treated as affiliate slugs
const RESERVED = new Set([
  '', 'index.html', 'success.html', 'cancel.html',
  'checkout.html', 'delivery-details.html', 'script.js', 'checkout.js',
  'style.css', 'images', 'img', 'assets', 'favicon.ico', 'robots.txt'
]);

app.use((req, res, next) => {
  const host = (req.headers.host || '').split(':')[0];

  // Always force HTTPS behind Render's proxy
  if (req.headers['x-forwarded-proto'] && req.headers['x-forwarded-proto'] !== 'https') {
    return res.redirect(301, 'https://' + host + req.originalUrl);
  }

  // 1) Handle affiliate link pattern: https://domain/<slug>
  //    Capture ONLY if first path segment looks like a slug (not a file/known dir)
  let slug = null;
  if (req.path && req.path !== '/') {
    const first = req.path.split('/').filter(Boolean)[0];
    const looksLikeFile = /\.[a-z0-9]+$/i.test(first);
    if (first && !RESERVED.has(first.toLowerCase()) && !looksLikeFile) {
      slug = first.toLowerCase();
    }
  }

  if (slug) {
    // Set cookie for 90 days, share across apex and www
    res.cookie('aff', slug, {
      domain: COOKIE_DOMAIN,
      maxAge: COOKIE_MAX_AGE,
      sameSite: 'Lax',
      secure: true,
      httpOnly: false
    });
    req.affiliate = slug;

    // Redirect to the home page (strip the slug from the URL)
    // If request came to apex, land on www for canonical consistency
    const targetHost = (host === PRIMARY_DOMAIN) ? 'www.' + PRIMARY_DOMAIN : host;
    return res.redirect(302, 'https://' + targetHost + '/');
  }

  // 2) Canonical apex -> www (after possible slug capture)
  if (host === PRIMARY_DOMAIN) {
    return res.redirect(301, 'https://www.' + PRIMARY_DOMAIN + req.originalUrl);
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
    const { name, email, phone, address1, address2, postalCode } = req.body || {};
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
