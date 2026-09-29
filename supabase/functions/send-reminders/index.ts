// @ts-nocheck  (Deno runtime file; VS Code's Node/TS checker does not understand Deno globals or URL imports)
// Supabase Edge Function: Stripe webhook -> upgrades the paying user's plan.
// Deploy:  supabase functions deploy stripe-webhook --no-verify-jwt
// Secrets: supabase secrets set STRIPE_SECRET_KEY=... STRIPE_WEBHOOK_SECRET=...
// In Stripe dashboard: Developers > Webhooks > add endpoint ->
//   https://tjjzeetbsxnkrgoiagbf.supabase.co/functions/v1/stripe-webhook
//   events: checkout.session.completed, customer.subscription.deleted, customer.subscription.updated
import Stripe from 'https://esm.sh/stripe@17?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' });
const WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

// Map a Stripe Price ID to a MossTask plan. Fill in once the Team price exists
// in Stripe (Product catalog > pricing). Falls back to 'team' for any paid
// price not listed, so a single-price Team plan works with no mapping at all.
const PRICE_TO_PLAN: Record<string, string> = {
  // 'price_XXXXXXXXXXXX': 'team',
};

function planForPrice(priceId: string | null | undefined): string {
  if (!priceId) return 'team';
  return PRICE_TO_PLAN[priceId] || 'team';
}

Deno.serve(async (req) => {
  const sig = req.headers.get('stripe-signature');
  const body = await req.text();
  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig!, WEBHOOK_SECRET);
  } catch (err) {
    return new Response(`signature verification failed: ${err.message}`, { status: 400 });
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as any;
      const userId = session.client_reference_id;
      if (!userId) return new Response('missing client_reference_id', { status: 200 }); // nothing to do, ack anyway

      let priceId: string | null = null;
      if (session.mode === 'subscription' && session.subscription) {
        const sub = await stripe.subscriptions.retrieve(session.subscription as string);
        priceId = sub.items.data[0]?.price?.id ?? null;
      }
      const plan = planForPrice(priceId);
      const { error } = await admin.rpc('set_user_plan', { p_user_id: userId, p_plan: plan });
      if (error) return new Response(error.message, { status: 500 });
    }

    // Subscription cancelled or lapsed -> back to Free. Requires the customer's
    // metadata to carry the MossTask user id (set it when creating the
    // Checkout Session, or via Payment Link's client_reference_id which Stripe
    // also attaches to the resulting subscription's metadata).
    if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object as any;
      const userId = sub.metadata?.client_reference_id || sub.metadata?.supabase_user_id;
      if (userId) await admin.rpc('set_user_plan', { p_user_id: userId, p_plan: 'free' });
    }

    return new Response('ok', { status: 200 });
  } catch (err) {
    return new Response(`handler error: ${err.message}`, { status: 500 });
  }
});