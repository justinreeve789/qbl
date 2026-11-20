<?php

namespace App\Http\Controllers;

use App\Http\Support\SignInPage;
use App\Models\User;
use App\Qbl\District\CleverClient;
use App\Qbl\District\Integrations;
use App\Qbl\District\Sso;
use App\Qbl\StoreError;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use OneLogin\Saml2\Auth as SamlAuth;
use OneLogin\Saml2\Constants as SamlConstants;
use OneLogin\Saml2\Response as SamlResponse;
use OneLogin\Saml2\Settings as SamlSettings;
use OneLogin\Saml2\Utils as SamlUtils;
use Symfony\Component\HttpFoundation\Cookie;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

/**
 * Signing in through a school's or district's own system, set up in the district admin panel:
 *
 *   SAML    GET  /api/sso/{org}/saml/metadata   QBL's service provider metadata, for the district's IdP
 *           GET  /api/sso/{org}/saml/login      sends the browser to the IdP (?return=/path)
 *           POST /api/sso/{org}/saml/acs        the IdP's answer (also unsolicited, from a portal, if allowed)
 *   Clever  GET  /api/sso/clever/login          sends the browser to Clever (?district=…&return=…)
 *           GET  /api/sso/clever/callback       Clever's answer, also Instant Login from the Clever portal
 *
 * Google Workspace domains claimed by a district are handled in GoogleAuthController.
 * Either way the person gets their organization's account (made on first sign-in when allowed)
 * and an API token, handed to the browser by SignInPage.
 */
class SsoController extends Controller
{
    private const CLEVER_COOKIE = 'qbl_clever';

    // ---------------------------------------------------------------------- SAML

    public function samlMetadata(int $org, Integrations $integrations): Response
    {
        $settings = new SamlSettings($this->samlSettings($org, $integrations->get($org, 'saml')['config'] ?? Integrations::defaults('saml')), true);

        return response($settings->getSPMetadata(), 200, ['Content-Type' => 'application/samlmetadata+xml; charset=utf-8']);
    }

    public function samlLogin(Request $request, int $org, Integrations $integrations): Response|RedirectResponse
    {
        $saml = $integrations->live($org, 'saml');
        if (! $saml) {
            return SignInPage::problem('sso');
        }
        $return = SignInPage::localPath($request->query('return'));
        $auth = new SamlAuth($this->samlSettings($org, $saml['config']));
        // RelayState carries where to go afterwards; it comes back with the answer.
        $url = $auth->login($return, [], false, false, true);

        return redirect()->away($url);
    }

    public function samlAcs(Request $request, int $org, Integrations $integrations, Sso $sso): Response|RedirectResponse
    {
        $saml = $integrations->live($org, 'saml');
        if (! $saml) {
            return SignInPage::problem('sso');
        }
        $config = $saml['config'];
        $relay = (string) $request->input('RelayState', '');
        try {
            $this->selfUrl("/api/sso/$org/saml/acs");
            $settings = new SamlSettings($this->samlSettings($org, $config));
            $response = new SamlResponse($settings, (string) $request->input('SAMLResponse', ''));
            if (! $response->isValid()) {
                throw new StoreError(401, 'SAML response refused: '.$response->getError());
            }
            if (! $config['allow_idp_initiated'] && ! $response->getXMLDocument()->documentElement->hasAttribute('InResponseTo')) {
                throw new StoreError(401, 'Sign-ins started at the identity provider are turned off for this organization.');
            }
            // An answer is good once: a copy replayed later is refused.
            $assertion = (string) $response->getAssertionId();
            $until = (int) ($response->getAssertionNotOnOrAfter() ?: time() + 300);
            if ($assertion === '' || ! Cache::store('database')->add('saml-assertion:'.sha1($org.'|'.$assertion), 1, max(60, $until - time() + 60))) {
                throw new StoreError(401, 'That SAML response has been used already.');
            }
            $attributes = $response->getAttributes() + $response->getAttributesWithFriendlyName();
            $externalId = $sso->samlSubject((string) $response->getNameId(), $attributes, (string) $config['id_attribute']);
            $role = Sso::samlRole($attributes, (string) $config['role_attribute'], (array) $config['teacher_values']);
            $user = User::findOrFail($sso->resolve($org, $externalId, $role, (bool) $config['create_users']));
        } catch (StoreError $e) {
            Log::notice("SAML sign-in for organization $org: ".$e->getMessage());

            return SignInPage::problem($e->status === 403 ? (str_contains($e->getMessage(), 'turned') ? 'inactive' : 'noaccount') : 'sso');
        } catch (Throwable $e) {
            report($e);

            return SignInPage::problem('sso');
        }

        return SignInPage::handoff($user, SignInPage::localPath($relay !== '' ? $relay : null), 'saml');
    }

    /** The OneLogin settings for one organization: QBL as the service provider, the district's IdP. */
    private function samlSettings(int $org, array $config): array
    {
        $base = rtrim((string) config('app.url'), '/')."/api/sso/$org/saml";

        return [
            'strict' => true,
            'debug' => false,
            'sp' => [
                'entityId' => "$base/metadata",
                'assertionConsumerService' => ['url' => "$base/acs", 'binding' => SamlConstants::BINDING_HTTP_POST],
                'NameIDFormat' => SamlConstants::NAMEID_UNSPECIFIED,
            ],
            'idp' => [
                'entityId' => (string) $config['idp_entity_id'],
                'singleSignOnService' => ['url' => (string) $config['idp_sso_url'], 'binding' => SamlConstants::BINDING_HTTP_REDIRECT],
                'x509cert' => (string) $config['idp_x509_cert'],
            ],
            'security' => [
                // The IdP must sign the response or the assertion (OneLogin refuses an answer signed by neither).
                'wantAssertionsSigned' => false,
                'wantMessagesSigned' => false,
                'requestedAuthnContext' => false,
                'rejectUnsolicitedResponsesWithInResponseTo' => false,
                'wantNameId' => (string) $config['id_attribute'] === '',
                'wantXMLValidation' => true,
                'signatureAlgorithm' => 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
                'digestAlgorithm' => 'http://www.w3.org/2001/04/xmlenc#sha256',
            ],
        ];
    }

    /**
     * OneLogin checks the answer's Destination against the address it thinks it is at. Behind the
     * edge and Apache that is not what PHP sees, so it is told the public one (APP_URL).
     */
    private function selfUrl(string $path): void
    {
        $url = parse_url((string) config('app.url'));
        $scheme = $url['scheme'] ?? 'http';
        SamlUtils::setSelfProtocol($scheme);
        SamlUtils::setSelfHost($url['host'] ?? 'localhost');
        SamlUtils::setSelfPort((int) ($url['port'] ?? ($scheme === 'https' ? 443 : 80)));
        SamlUtils::setBaseURLPath(null);
        $_SERVER['REQUEST_URI'] = rtrim($url['path'] ?? '', '/').$path;
        unset($_SERVER['QUERY_STRING']);
    }

    // -------------------------------------------------------------------- Clever

    public function cleverLogin(Request $request, CleverClient $clever): RedirectResponse
    {
        if (! $clever->configured()) {
            return SignInPage::problem('sso');
        }
        $state = Str::random(40);
        $payload = Crypt::encryptString(json_encode(['state' => $state, 'return' => SignInPage::localPath($request->query('return'))]));
        $district = preg_match('/^[A-Za-z0-9]{6,64}$/', (string) $request->query('district')) ? (string) $request->query('district') : null;
        $response = redirect()->away($clever->authorizeUrl($this->cleverRedirect(), $state, $district));
        $response->headers->setCookie(new Cookie(self::CLEVER_COOKIE, $payload, time() + 600, '/api/sso/clever', null, $request->isSecure(), true, false, Cookie::SAMESITE_LAX));

        return $response;
    }

    /**
     * Clever's answer. A sign-in started here comes back with the state it was given. One started
     * in the Clever portal (Instant Login) comes with no state at all, which Clever's own design allows.
     */
    public function cleverCallback(Request $request, CleverClient $clever, Integrations $integrations, Sso $sso): Response|RedirectResponse
    {
        if (! $clever->configured()) {
            return SignInPage::problem('sso');
        }
        try {
            $saved = json_decode(Crypt::decryptString((string) $request->cookie(self::CLEVER_COOKIE)), true) ?: [];
        } catch (Throwable) {
            $saved = [];
        }
        $forget = new Cookie(self::CLEVER_COOKIE, '', 1, '/api/sso/clever', null, $request->isSecure(), true, false, Cookie::SAMESITE_LAX);
        $state = $request->query('state');
        if ($state !== null && (empty($saved['state']) || ! hash_equals($saved['state'], (string) $state))) {
            return SignInPage::problem('expired')->withCookie($forget);
        }
        if ($request->query('error') || ! $request->query('code')) {
            return SignInPage::problem('cancelled')->withCookie($forget);
        }
        try {
            $me = $clever->me($clever->exchange((string) $request->query('code'), $this->cleverRedirect()));
            $integration = $me['district'] !== '' ? $integrations->cleverDistrict($me['district']) : null;
            if (! $integration || $me['id'] === '') {
                throw new StoreError(403, 'This district has not connected Clever to QBL.');
            }
            $role = Sso::cleverRole($me['type']);
            $user = User::findOrFail($sso->resolve($integration['organization_id'], CleverClient::PREFIX.$me['id'], $role, (bool) $integration['config']['create_users']));
        } catch (StoreError $e) {
            Log::notice('Clever sign-in: '.$e->getMessage());

            return SignInPage::problem($e->status === 403 ? (str_contains($e->getMessage(), 'turned') ? 'inactive' : 'noaccount') : 'sso')->withCookie($forget);
        } catch (Throwable $e) {
            report($e);

            return SignInPage::problem('sso')->withCookie($forget);
        }

        return SignInPage::handoff($user, SignInPage::localPath($saved['return'] ?? null), 'clever')->withCookie($forget);
    }

    private function cleverRedirect(): string
    {
        return rtrim((string) config('app.url'), '/').'/api/sso/clever/callback';
    }
}
