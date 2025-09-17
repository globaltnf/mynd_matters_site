/*
  Client‑side logic for the checkout form. When the customer submits
  their delivery details, this script sends the data to the server to
  create a Stripe Checkout session with the information attached as
  metadata. The user is then redirected to Stripe’s hosted checkout page.
*/

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('checkout-form');
  const submitButton = document.getElementById('submit-button');
  if (!form) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    // Disable the button to prevent multiple submissions
    const originalText = submitButton.textContent;
    submitButton.disabled = true;
    submitButton.textContent = 'Processing…';
    // Gather form values
    const name = document.getElementById('name').value.trim();
    const email = document.getElementById('email').value.trim();
    const phone = document.getElementById('phone').value.trim();
    const address1 = document.getElementById('address1').value.trim();
    const address2 = document.getElementById('address2').value.trim();
    const postalCode = document.getElementById('postal-code').value.trim();
    try {

      // NEW: read hidden affiliate field (fallback to cookie just in case)
const affiliateField = document.getElementById('affiliate');
const cookieAffMatch = document.cookie.match(/(?:^|;\s*)aff=([^;]+)/);
const affiliate =
  (affiliateField && affiliateField.value.trim()) ||
  (cookieAffMatch ? decodeURIComponent(cookieAffMatch[1]) : '');
      
      const response = await fetch('/create-checkout-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name, email, phone, address1, address2, postalCode }),
      });
      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }
      const data = await response.json();
      if (data && data.url) {
        window.location.href = data.url;
      } else {
        throw new Error('Invalid response from server');
      }
    } catch (err) {
      console.error(err);
      alert('An error occurred while creating the payment session. Please try again later.');
      submitButton.disabled = false;
      submitButton.textContent = originalText;
    }
  });
});
