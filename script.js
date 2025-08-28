/*
  Client‑side logic for the MYND Matters landing page.
  This script handles calls to the server to initiate a Stripe Checkout session
  when the user clicks one of the purchase buttons. The buttons are disabled
  while processing to prevent multiple submissions. If the call succeeds, the
  browser is redirected to Stripe’s hosted checkout page. Otherwise, an error
  message is displayed.
*/

document.addEventListener('DOMContentLoaded', () => {
  // Checkout buttons are now links to the customer details page,
  // so we no longer intercept their clicks here.

  // Mobile navigation toggle functionality
  const navToggle = document.getElementById('nav-toggle');
  const nav = document.querySelector('nav');
  if (navToggle && nav) {
    navToggle.addEventListener('click', () => {
      nav.classList.toggle('open');
    });
  }
});