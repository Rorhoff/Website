import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@14";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const PREMIUM_DURATION_DAYS = 30;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2024-06-20" });
    const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;

    const body = await req.text();
    const signature = req.headers.get("stripe-signature");

    if (!signature) {
      return new Response(JSON.stringify({ error: "Missing stripe-signature header" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let event: Stripe.Event;
    try {
      event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
    } catch (err) {
      console.error("Webhook signature verification failed:", err);
      return new Response(JSON.stringify({ error: "Invalid signature" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const { seeker_post_id, purchase_number, amount_cents } = session.metadata ?? {};

      if (!seeker_post_id) {
        return new Response(JSON.stringify({ received: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );

      // Get next premium_order
      const { data: maxRow } = await supabase
        .from("seeker_posts")
        .select("premium_order")
        .eq("is_premium", true)
        .order("premium_order", { ascending: false })
        .limit(1)
        .maybeSingle();

      const nextOrder = (maxRow?.premium_order ?? 0) + 1;
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + PREMIUM_DURATION_DAYS);

      // Get the post's author
      const { data: post } = await supabase
        .from("seeker_posts")
        .select("author_id")
        .eq("id", seeker_post_id)
        .maybeSingle();

      const [{ error: postErr }, { error: purchaseErr }] = await Promise.all([
        supabase.from("seeker_posts").update({
          is_premium: true,
          premium_expires_at: expiresAt.toISOString(),
          premium_order: nextOrder,
        }).eq("id", seeker_post_id),
        supabase.from("premium_purchases").insert({
          user_id: post?.author_id ?? null,
          seeker_post_id,
          amount_cents: parseInt(amount_cents ?? "0"),
          purchase_number: parseInt(purchase_number ?? "0"),
          stripe_session_id: session.id,
        }),
      ]);

      if (postErr) console.error("Failed to update post:", postErr);
      if (purchaseErr) console.error("Failed to insert purchase:", purchaseErr);
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("stripe-webhook error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
