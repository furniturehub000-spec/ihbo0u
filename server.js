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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 Server running at http://localhost:${PORT}`);
  console.log(`📱 Open http://localhost:${PORT}/index.html in your browser\n`);
});
