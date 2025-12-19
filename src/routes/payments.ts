import { Router } from 'express';
import crypto from 'crypto';
import { prisma } from '../lib/prisma.js';
import { requireAuth, AuthRequest } from '../middleware/auth.js';

const router = Router();

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY || '';

// Paystack plan codes - MUST be created in Paystack Dashboard first!
// Go to: Paystack Dashboard > Products > Plans > Create Plan
const PAYSTACK_PLANS = {
  PRO: process.env.PAYSTACK_PRO_PLAN_CODE || '', // e.g., PLN_xxxxx
  WHATSAPP: process.env.PAYSTACK_WHATSAPP_PLAN_CODE || '' // e.g., PLN_xxxxx
};

// Paystack API response type
interface PaystackResponse {
  status: boolean;
  message?: string;
  data?: {
    authorization_url?: string;
    access_code?: string;
    reference?: string;
    status?: string;
    amount?: number;
    paid_at?: string;
    [key: string]: any;
  };
}

// Helper to make Paystack API calls
async function paystackAPI(endpoint: string, method: string = 'GET', body?: any): Promise<PaystackResponse> {
  const response = await fetch(`https://api.paystack.co${endpoint}`, {
    method,
    headers: {
      'Authorization': `Bearer ${PAYSTACK_SECRET}`,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return response.json() as Promise<PaystackResponse>;
}

// POST /api/payments/subscribe - Subscribe user to a plan (auto-renewal)
router.post('/subscribe', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { plan } = req.body;
    const userId = req.userId!;
    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!['PRO', 'WHATSAPP'].includes(plan)) {
      return res.status(400).json({ error: 'Invalid plan. Must be PRO or WHATSAPP' });
    }

    const planCode = PAYSTACK_PLANS[plan as keyof typeof PAYSTACK_PLANS];
    if (!planCode) {
      return res.status(500).json({ error: 'Paystack plan not configured. Contact support.' });
    }

    // Initialize subscription transaction
    const reference = `cram_sub_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    const data = await paystackAPI('/transaction/initialize', 'POST', {
      email: user.email,
      plan: planCode,
      reference,
      callback_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/payment/callback`,
      metadata: {
        userId,
        plan,
        subscription: true,
        custom_fields: [
          { display_name: 'Plan', variable_name: 'plan', value: plan },
          { display_name: 'User ID', variable_name: 'user_id', value: userId }
        ]
      }
    });

    if (!data.status) {
      return res.status(400).json({ error: data.message || 'Failed to initialize subscription' });
    }

    // Create pending payment record
    await prisma.payment.create({
      data: {
        userId,
        amount: 0, // Will be set by webhook
        paystackRef: reference,
        plan: plan as 'PRO' | 'WHATSAPP',
        status: 'pending'
      }
    });

    res.json({
      authorization_url: data.data?.authorization_url,
      access_code: data.data?.access_code,
      reference: data.data?.reference
    });
  } catch (error) {
    console.error('Subscription init error:', error);
    res.status(500).json({ error: 'Failed to start subscription' });
  }
});

// POST /api/payments/webhook - Paystack webhook for all events
router.post('/webhook', async (req, res) => {
  try {
    // Verify webhook signature
    const hash = crypto
      .createHmac('sha512', PAYSTACK_SECRET)
      .update(JSON.stringify(req.body))
      .digest('hex');

    if (hash !== req.headers['x-paystack-signature']) {
      console.error('Invalid Paystack webhook signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const event = req.body;
    console.log(`Paystack webhook: ${event.event}`);

    switch (event.event) {
      // Initial subscription payment successful
      case 'charge.success':
        await handleChargeSuccess(event.data);
        break;

      // Subscription created
      case 'subscription.create':
        await handleSubscriptionCreate(event.data);
        break;

      // Recurring payment successful
      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data);
        break;

      // Subscription canceled/disabled
      case 'subscription.disable':
      case 'subscription.not_renew':
        await handleSubscriptionCancel(event.data);
        break;

      default:
        console.log(`Unhandled webhook event: ${event.event}`);
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Handle successful charge (initial or recurring)
async function handleChargeSuccess(data: any) {
  const { reference, metadata, amount, customer, authorization } = data;
  const userId = metadata?.userId;
  const plan = metadata?.plan;

  if (!userId || !plan) {
    console.log('Charge success without userId/plan metadata, might be recurring charge');
    
    // Try to find user by customer email for recurring charges
    if (customer?.email) {
      const user = await prisma.user.findUnique({ where: { email: customer.email } });
      if (user) {
        // Extend subscription for recurring payment
        await extendSubscription(user.id, user.plan);
        console.log(`Recurring payment processed for ${customer.email}`);
      }
    }
    return;
  }

  // Update payment record
  try {
    await prisma.payment.update({
      where: { paystackRef: reference },
      data: {
        status: 'success',
        amount: amount,
        paystackTrxId: data.id?.toString()
      }
    });
  } catch (e) {
    // Payment record might not exist for recurring
    console.log('Payment record not found, creating new one');
  }

  // Save authorization for future charges if available
  if (authorization?.authorization_code) {
    await prisma.user.update({
      where: { id: userId },
      data: { 
        paystackCustomerId: customer?.customer_code,
        paystackAuthCode: authorization.authorization_code
      }
    });
  }

  // Activate/extend subscription
  await extendSubscription(userId, plan);
  console.log(`Subscription activated/renewed for user ${userId}: ${plan}`);
}

// Handle subscription creation
async function handleSubscriptionCreate(data: any) {
  const { customer, subscription_code, plan, next_payment_date } = data;
  
  const user = await prisma.user.findFirst({ 
    where: { email: customer.email } 
  });

  if (user) {
    await prisma.user.update({
      where: { id: user.id },
      data: { paystackSubscriptionCode: subscription_code }
    });
    console.log(`Subscription ${subscription_code} linked to user ${user.id}`);
  }
}

// Handle failed payment (for recurring)
async function handlePaymentFailed(data: any) {
  const { customer, subscription } = data;
  
  const user = await prisma.user.findFirst({ 
    where: { email: customer?.email } 
  });

  if (user) {
    console.log(`Payment failed for user ${user.id} - subscription: ${subscription?.subscription_code}`);
    // Don't downgrade immediately - Paystack will retry
    // You could send an email here warning the user
  }
}

// Handle subscription cancellation
async function handleSubscriptionCancel(data: any) {
  const { customer, subscription_code } = data;
  
  const user = await prisma.user.findFirst({ 
    where: { 
      OR: [
        { email: customer?.email },
        { paystackSubscriptionCode: subscription_code }
      ]
    } 
  });

  if (user) {
    console.log(`Subscription canceled for user ${user.id}`);
    
    // Deactivate subscription (user keeps access until endDate)
    await prisma.subscription.updateMany({
      where: { userId: user.id, active: true },
      data: { active: false }
    });

    // Clear subscription code
    await prisma.user.update({
      where: { id: user.id },
      data: { paystackSubscriptionCode: null }
    });
  }
}

// Helper: Extend user's subscription by 30 days
async function extendSubscription(userId: string, plan: string) {
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + 30);

  // Deactivate old subscriptions
  await prisma.subscription.updateMany({
    where: { userId, active: true },
    data: { active: false }
  });

  // Create new subscription
  await prisma.subscription.create({
    data: {
      userId,
      plan: plan as 'PRO' | 'WHATSAPP',
      endDate,
      active: true
    }
  });

  // Update user plan
  await prisma.user.update({
    where: { id: userId },
    data: { plan: plan as 'PRO' | 'WHATSAPP' }
  });
}

// GET /api/payments/verify/:reference - Verify payment status
router.get('/verify/:reference', async (req, res) => {
  try {
    const { reference } = req.params;

    const data = await paystackAPI(`/transaction/verify/${reference}`);

    if (!data.status) {
      return res.status(400).json({ error: 'Verification failed' });
    }

    const payment = await prisma.payment.findUnique({
      where: { paystackRef: reference }
    });

    res.json({
      status: data.data?.status,
      amount: data.data?.amount,
      plan: payment?.plan,
      paidAt: data.data?.paid_at
    });
  } catch (error) {
    console.error('Verify error:', error);
    res.status(500).json({ error: 'Failed to verify payment' });
  }
});

// POST /api/payments/cancel - Cancel subscription
router.post('/cancel', requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = await prisma.user.findUnique({ 
      where: { id: req.userId },
      select: { paystackSubscriptionCode: true }
    });

    if (!user?.paystackSubscriptionCode) {
      return res.status(400).json({ error: 'No active subscription to cancel' });
    }

    // Cancel on Paystack
    const data = await paystackAPI('/subscription/disable', 'POST', {
      code: user.paystackSubscriptionCode,
      token: user.paystackSubscriptionCode // Some versions need this
    });

    if (!data.status) {
      return res.status(400).json({ error: data.message || 'Failed to cancel subscription' });
    }

    // Clear subscription code
    await prisma.user.update({
      where: { id: req.userId },
      data: { paystackSubscriptionCode: null }
    });

    res.json({ 
      message: 'Subscription canceled. You will retain access until your current period ends.' 
    });
  } catch (error) {
    console.error('Cancel subscription error:', error);
    res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});

// GET /api/payments/status - Get user's subscription status
router.get('/status', requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { plan: true, paystackSubscriptionCode: true }
    });

    const activeSubscription = await prisma.subscription.findFirst({
      where: { userId: req.userId, active: true },
      orderBy: { endDate: 'desc' }
    });

    res.json({
      plan: user?.plan,
      hasActiveSubscription: !!user?.paystackSubscriptionCode,
      subscriptionEndDate: activeSubscription?.endDate,
      autoRenew: !!user?.paystackSubscriptionCode
    });
  } catch (error) {
    console.error('Status error:', error);
    res.status(500).json({ error: 'Failed to get subscription status' });
  }
});

// Legacy: Keep initialize endpoint for one-time payments
router.post('/initialize', async (req, res) => {
  try {
    const { userId, plan, email } = req.body;

    if (!userId || !plan || !email) {
      return res.status(400).json({ error: 'userId, plan, and email are required' });
    }

    // Redirect to subscribe endpoint
    return res.redirect(307, '/api/payments/subscribe');
  } catch (error) {
    console.error('Payment init error:', error);
    res.status(500).json({ error: 'Failed to initialize payment' });
  }
});

export { router as paymentsRouter };
