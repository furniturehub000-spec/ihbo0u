require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Stripe = require('stripe');

const app = express();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// Create a PaymentIntent and send to Terminal reader
app.post('/api/terminal/create-payment', async (req, res) => {
  try {
    const { amount, reader_id } = req.body;

    if (!amount || amount < 50) {
      return res.status(400).json({ error: 'Amount must be at least 50 cents' });
    }

    if (!reader_id) {
      return res.status(400).json({ error: 'Reader ID is required' });
    }

    // Create a PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount,
      currency: 'usd',
      payment_method_types: ['card_present'],
      capture_method: 'automatic',
    });

    // Process the payment on the Terminal reader
    const reader = await stripe.terminal.readers.processPaymentIntent(
      reader_id,
      { payment_intent: paymentIntent.id }
    );

    res.json({
      success: true,
      payment_intent_id: paymentIntent.id,
      reader_status: reader.action?.status,
      message: 'Payment sent to terminal. Customer can tap/insert card.'
    });

  } catch (err) {
    console.error('Terminal payment error:', err);
    res.status(500).json({ 
      error: err.message,
      type: err.type
    });
  }
});

// Cancel a payment on the reader
app.post('/api/terminal/cancel-payment', async (req, res) => {
  try {
    const { reader_id } = req.body;

    const reader = await stripe.terminal.readers.cancelAction(reader_id);

    res.json({
      success: true,
      message: 'Payment cancelled'
    });

  } catch (err) {
    console.error('Cancel error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get reader status
app.get('/api/terminal/reader/:reader_id', async (req, res) => {
  try {
    const reader = await stripe.terminal.readers.retrieve(req.params.reader_id);

    res.json({
      id: reader.id,
      label: reader.label,
      status: reader.status,
      device_type: reader.device_type,
      location: reader.location,
      action: reader.action
    });

  } catch (err) {
    console.error('Reader status error:', err);
    res.status(500).json({ error: err.message });
  }
});

// List all readers
app.get('/api/terminal/readers', async (req, res) => {
  try {
    const readers = await stripe.terminal.readers.list({ limit: 100 });

    res.json({
      readers: readers.data.map(r => ({
        id: r.id,
        label: r.label,
        status: r.status,
        device_type: r.device_type
      }))
    });

  } catch (err) {
    console.error('List readers error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Create a simulated reader for testing
app.post('/api/terminal/create-simulated-reader', async (req, res) => {
  try {
    // First, get or create a location
    let location;
    const locations = await stripe.terminal.locations.list({ limit: 1 });
    
    if (locations.data.length > 0) {
      location = locations.data[0];
    } else {
      location = await stripe.terminal.locations.create({
        display_name: 'Furniture Store',
        address: {
          line1: '123 Main St',
          city: 'Tampa',
          state: 'FL',
          postal_code: '33601',
          country: 'US'
        }
      });
    }

    const reader = await stripe.terminal.readers.create({
      registration_code: 'simulated-wpe',
      label: 'Simulated Reader',
      location: location.id
    });

    res.json({
      success: true,
      reader_id: reader.id,
      message: 'Simulated reader created for testing'
    });

  } catch (err) {
    console.error('Create simulated reader error:', err);
    res.status(500).json({ error: err.message });
  }
});

// =================== CUSTOMER & PAYMENT ENDPOINTS ===================

// Get Stripe publishable key
app.get('/api/stripe-config', (req, res) => {
  res.json({
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || 'pk_live_51TJBXLFSwoz03r8nwds574TV6VTCdfWzpvhyEbgqwFcCZLIuQTgZ7mMG4FWCaElAhvCYQR4BjdHpsQ7pL72PrH2P00vYV1qTkc'
  });
});

// Create a Stripe Customer
app.post('/api/create-customer', async (req, res) => {
  try {
    const { email, name, phone, address } = req.body;

    const customer = await stripe.customers.create({
      email: email || undefined,
      name: name || undefined,
      phone: phone || undefined,
      address: address ? {
        line1: address.street,
        city: address.city,
        state: address.state,
        postal_code: address.zip,
        country: 'US'
      } : undefined
    });

    res.json({
      success: true,
      customer_id: customer.id
    });

  } catch (err) {
    console.error('Create customer error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Attach a payment method to a customer using card details
// Create a SetupIntent for securely collecting card details
app.post('/api/create-setup-intent', async (req, res) => {
  try {
    const { customer_id } = req.body;

    if (!customer_id) {
      return res.status(400).json({ error: 'Customer ID is required' });
    }

    const setupIntent = await stripe.setupIntents.create({
      customer: customer_id,
      payment_method_types: ['card'],
    });

    res.json({
      success: true,
      client_secret: setupIntent.client_secret
    });

  } catch (err) {
    console.error('Create setup intent error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Confirm payment method was attached and set as default
app.post('/api/confirm-payment-method', async (req, res) => {
  try {
    const { customer_id, payment_method_id } = req.body;

    if (!customer_id || !payment_method_id) {
      return res.status(400).json({ error: 'Customer ID and payment method ID are required' });
    }

    // Get the payment method details
    const paymentMethod = await stripe.paymentMethods.retrieve(payment_method_id);

    // Set as default payment method
    await stripe.customers.update(customer_id, {
      invoice_settings: {
        default_payment_method: payment_method_id
      }
    });

    res.json({
      success: true,
      payment_method_id: paymentMethod.id,
      last4: paymentMethod.card.last4,
      brand: paymentMethod.card.brand
    });

  } catch (err) {
    console.error('Confirm payment method error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Charge down payment (one-time charge)
app.post('/api/charge-down-payment', async (req, res) => {
  try {
    const { customer_id, payment_method_id, amount, order_number } = req.body;

    if (!customer_id || !payment_method_id || !amount) {
      return res.status(400).json({ error: 'Customer ID, payment method, and amount are required' });
    }

    if (amount < 50) {
      return res.status(400).json({ error: 'Amount must be at least 50 cents' });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount,
      currency: 'usd',
      customer: customer_id,
      payment_method: payment_method_id,
      off_session: true,
      confirm: true,
      description: `Down payment for order ${order_number || 'N/A'}`,
      metadata: {
        order_number: order_number || '',
        type: 'down_payment'
      }
    });

    res.json({
      success: true,
      payment_intent_id: paymentIntent.id,
      status: paymentIntent.status,
      amount: paymentIntent.amount
    });

  } catch (err) {
    console.error('Charge down payment error:', err);
    
    if (err.type === 'StripeCardError') {
      return res.status(400).json({ 
        error: err.message,
        decline_code: err.decline_code
      });
    }
    
    res.status(500).json({ error: err.message });
  }
});

// Create a subscription for monthly payments
app.post('/api/create-subscription', async (req, res) => {
  try {
    const { customer_id, payment_method_id, amount, order_number } = req.body;

    if (!customer_id || !payment_method_id || !amount) {
      return res.status(400).json({ error: 'Customer ID, payment method, and amount are required' });
    }

    // Create a price for this subscription
    const price = await stripe.prices.create({
      unit_amount: amount,
      currency: 'usd',
      recurring: { interval: 'month' },
      product_data: {
        name: `Monthly Rental Payment - Order ${order_number || 'N/A'}`
      }
    });

    // Create the subscription starting next month
    const subscription = await stripe.subscriptions.create({
      customer: customer_id,
      items: [{ price: price.id }],
      default_payment_method: payment_method_id,
      billing_cycle_anchor: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60), // Start in ~30 days
      proration_behavior: 'none',
      metadata: {
        order_number: order_number || ''
      }
    });

    res.json({
      success: true,
      subscription_id: subscription.id,
      status: subscription.status,
      current_period_end: subscription.current_period_end
    });

  } catch (err) {
    console.error('Create subscription error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get customer payment methods
app.get('/api/customer/:customer_id/payment-methods', async (req, res) => {
  try {
    const paymentMethods = await stripe.paymentMethods.list({
      customer: req.params.customer_id,
      type: 'card'
    });

    res.json({
      payment_methods: paymentMethods.data.map(pm => ({
        id: pm.id,
        brand: pm.card.brand,
        last4: pm.card.last4,
        exp_month: pm.card.exp_month,
        exp_year: pm.card.exp_year
      }))
    });

  } catch (err) {
    console.error('Get payment methods error:', err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 Server running at http://localhost:${PORT}`);
  console.log(`📱 Open http://localhost:${PORT}/index.html in your browser\n`);
});
