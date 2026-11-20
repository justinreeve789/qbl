<?php

namespace App\Http\Controllers;

use App\Qbl\Billing\BillingApi;
use App\Qbl\Billing\Stripe;
use App\Qbl\Billing\Subscriptions;
use App\Qbl\StoreError;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

/**
 * Plans and billing. The account's own routes are in App\Qbl\Billing\BillingApi; here are the two
 * that need the framework: Stripe's webhook (the raw body, for the signature) and the quote form
 * for schools and districts (mail).
 */
class BillingController extends Controller
{
    public function __invoke(Request $request, BillingApi $api, ?string $path = null): Response
    {
        $user = $request->user('sanctum');
        [$status, $body] = $api->handle(
            $request->method(),
            $path ?? '',
            $request->json()->all(),
            $user ? ['id' => $user->id, 'name' => $user->name, 'role' => $user->role, 'email' => $user->hasRealEmail() ? $user->email : null, 'organization_id' => $user->organization_id] : null,
        );

        return $body === null ? response()->noContent($status) : response()->json($body, $status);
    }

    /**
     * Stripe tells us about subscriptions here: started, renewed, changed, cancelled, a payment that
     * failed. Only events signed with STRIPE_WEBHOOK_SECRET are believed. An answer other than 2xx
     * makes Stripe send the event again later, so one is given only when trying again could help.
     */
    public function webhook(Request $request, Subscriptions $subscriptions): JsonResponse
    {
        $payload = $request->getContent();
        if (! Stripe::verifySignature($payload, $request->header('Stripe-Signature'), (string) config('qbl_billing.stripe.webhook_secret'))) {
            return response()->json(['message' => 'The signature does not match.'], 400);
        }
        $event = json_decode($payload, true);
        if (! is_array($event)) {
            return response()->json(['message' => 'Not JSON.'], 400);
        }
        try {
            $done = $subscriptions->handleEvent($event);
        } catch (StoreError $e) {
            Log::warning('Stripe webhook '.($event['id'] ?? '?').': '.$e->getMessage());

            return response()->json(['message' => $e->getMessage()], $e->status >= 500 ? 503 : $e->status);
        }
        Log::info('Stripe webhook '.($event['type'] ?? '?').' '.($event['id'] ?? '?').': '.$done);

        return response()->json(['received' => true, 'result' => $done]);
    }

    /** "Contact us for a quote": kept, and emailed to QBL_SALES_EMAIL when it is set. */
    public function quote(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:120'],
            'email' => ['required', 'email', 'max:255'],
            'organization' => ['required', 'string', 'max:160'],
            'role' => ['nullable', 'string', 'max:80'],
            'phone' => ['nullable', 'string', 'max:40'],
            'students' => ['nullable', 'integer', 'min:1', 'max:10000000'],
            'message' => ['nullable', 'string', 'max:4000'],
        ], [
            'name.required' => 'Enter your name.',
            'email.required' => 'Enter your work email address.',
            'email.email' => 'That does not look like an email address.',
            'organization.required' => 'Enter your school or district.',
        ]);
        $clean = array_map(fn ($v) => is_string($v) ? trim(strip_tags($v)) : $v, $data);
        $id = DB::table('quote_requests')->insertGetId($clean + ['user_id' => $request->user('sanctum')?->id, 'created_at' => now(), 'updated_at' => now()]);

        if ($to = config('qbl_billing.sales_email')) {
            $lines = ["Quote request #$id from ".config('qbl.site_name', 'QuestLab').':', ''];
            foreach (['name' => 'Name', 'email' => 'Email', 'organization' => 'School or district', 'role' => 'Role', 'phone' => 'Phone', 'students' => 'Students', 'message' => 'Message'] as $k => $label) {
                if (($clean[$k] ?? null) !== null && $clean[$k] !== '') {
                    $lines[] = "$label: {$clean[$k]}";
                }
            }
            try {
                Mail::raw(implode("\n", $lines), function ($m) use ($to, $clean) {
                    $m->to($to)->replyTo($clean['email'], $clean['name'])->subject('Quote request: '.Str::limit($clean['organization'], 80));
                });
            } catch (Throwable $e) {
                // Kept in quote_requests either way; a mail problem does not lose the request.
                report($e);
            }
        }

        return response()->json(['message' => 'Thank you. We will be in touch within one working day.', 'id' => $id], 201);
    }
}
