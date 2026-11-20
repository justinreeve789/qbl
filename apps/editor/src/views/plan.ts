import { ApiError, type Api, type BillingStatus, type LedgerLine } from '../api';
import { config } from '../config';
import { clear, h, help, toast } from '../dom';

const fail = (err: unknown, fallback: string) => toast(err instanceof ApiError || err instanceof Error ? err.message : fallback, 'error');

/** "21 Nov 2026" from an ISO time. */
export function day(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}

/** What a subscription's state means, in a sentence. */
export function planLine(status: BillingStatus): string {
  const e = status.entitlements;
  const sub = status.subscription;
  if (e.source === 'billing_off') return 'Billing is off on this site, so everything is open to everyone.';
  if (e.source === 'admin') return 'As an administrator you have everything, and generating costs no credits.';
  if (e.source === 'organization') return `Through ${e.organization?.name ?? 'your school'}’s license.`;
  if (e.source === 'subscription' && sub) {
    if (sub.status === 'trialing') return `Free trial until ${day(sub.trial_ends_at)}${sub.cancel_at_period_end ? ', then it ends.' : '. The plan continues after it unless you cancel.'}`;
    if (sub.status === 'past_due') return 'Your last payment did not go through. Update your card in “Manage billing” to keep your plan.';
    return sub.cancel_at_period_end ? `Ends on ${day(sub.current_period_end)}.` : `Renews on ${day(sub.current_period_end)}.`;
  }
  return 'The free plan: the free missions. A teacher plan adds every curricular mission and your class.';
}

const REASONS: Record<LedgerLine['reason'], string> = { grant: 'Added', expire: 'Expired', spend: 'Spent', refund: 'Given back', adjust: 'Adjusted' };

/**
 * Plan & credits: which plan the teacher is on and what it includes, the generator credits and
 * their history, and the ways to change it: the plans page (the game site's /plans, where anyone
 * can buy), Stripe's billing page, and switching between the two teacher plans.
 */
export function planView(api: Api): HTMLElement {
  const body = h('div', null, h('p', { class: 'muted' }, 'Loading…'));
  const plansUrl = `${config.gameUrl}plans`;

  const load = async () => {
    try {
      const status = await api.billing();
      const ledger = status.credits ? (await api.credits()).ledger : [];
      draw(status, ledger);
    } catch (err) {
      clear(body, h('p', { class: 'issue error' }, err instanceof Error ? err.message : 'Could not load your plan.'));
    }
  };

  const draw = (status: BillingStatus, ledger: LedgerLine[]) => {
    const e = status.entitlements;
    const sub = status.subscription;
    const subscribed = e.source === 'subscription' && sub && ['trialing', 'active', 'past_due'].includes(sub.status ?? '');
    const other = subscribed ? status.plans.find((p) => p.key !== 'free' && p.key !== e.plan) : undefined;
    const tick = (on: boolean, text: string) => h('li', { class: on ? 'yes' : 'no' }, on ? '✅ ' : '— ', text);
    clear(
      body,
      h('div', { class: 'grid' },
        h('div', { class: 'card', 'data-card': 'plan' },
          h('div', { class: 'card-title' }, h('h2', null, e.plan_name), e.trial ? h('span', { class: 'badge' }, 'Free trial') : null),
          h('p', null, planLine(status)),
          h('ul', { class: 'plan-includes' },
            tick(e.curricular, 'Every curricular mission, to play and to assign'),
            tick(e.students !== 0, e.students == null ? 'Any number of students' : `Up to ${e.students} students (you have ${e.students_used ?? 0})`),
            tick(e.generator, 'The AI mission generator')),
          h('div', { class: 'row-actions' },
            status.payments && e.source !== 'organization' && e.source !== 'admin'
              ? h('a', { class: 'button primary', href: plansUrl, 'data-action': 'plans' }, subscribed ? 'See the plans' : status.subscription?.trial_used ? 'Choose a plan' : `Start a ${status.trial_days}-day free trial`)
              : null,
            other ? h('button', {
              type: 'button', 'data-action': 'switch',
              onclick: async () => {
                if (!window.confirm(`Switch to ${other.name} ($${other.price} a month)? The difference is prorated on your next invoice.`)) return;
                try {
                  const next = await api.changePlan(other.key);
                  toast(`You are on ${next.entitlements.plan_name} now.`);
                  await load();
                } catch (err) {
                  fail(err, 'Could not change the plan.');
                }
              },
            }, `Switch to ${other.name}`) : null,
            sub?.manageable && status.payments ? h('button', {
              type: 'button', 'data-action': 'portal',
              onclick: async () => {
                try {
                  window.location.assign(await api.billingPortal());
                } catch (err) {
                  fail(err, 'Could not open billing.');
                }
              },
            }, 'Manage billing') : null),
          sub?.manageable ? h('p', { class: 'muted small' }, 'Manage billing opens Stripe, where you can change your card, see invoices, or cancel.') : null),
        status.credits
          ? h('div', { class: 'card', 'data-card': 'credits' },
              h('div', { class: 'card-title' }, h('h2', null, 'Generator credits', help(`A generated mission costs ${status.costs.generation} credits. Credits arrive at the start of each billing month; unused ones carry over to the next month, up to the carry-over limit.`))),
              status.credits.enforced
                ? h('p', { class: 'credit-balance' }, h('strong', { 'data-balance': status.credits.balance }, String(status.credits.balance)), ' credits')
                : h('p', null, 'Not counted for your account.'),
              status.credits.monthly
                ? h('p', { class: 'muted' }, status.credits.trial
                  ? `${status.credits.monthly} credits for the free trial. When it ends: the plan’s monthly credits.`
                  : `${status.credits.monthly} a month. Up to ${status.credits.carryover} unused credits carry over to the next month.`)
                : null,
              h('div', { class: 'row-actions' }, h('a', { class: 'button', href: '#/generate' }, 'Generate a mission')),
              ledger.length
                ? h('table', { class: 'ledger' },
                    h('thead', null, h('tr', null, h('th', null, 'When'), h('th', null, ''), h('th', null, 'Credits'), h('th', null, 'Balance'))),
                    h('tbody', null, ...ledger.slice(0, 30).map((l) => h('tr', { 'data-reason': l.reason },
                      h('td', null, day(l.at)),
                      h('td', null, `${REASONS[l.reason]}${l.note ? `: ${l.note}` : ''}`),
                      h('td', { class: l.delta < 0 ? 'minus' : 'plus' }, `${l.delta > 0 ? '+' : ''}${l.delta}`),
                      h('td', null, String(l.balance_after))))))
                : null)
          : null,
        h('div', { class: 'card', 'data-card': 'schools' },
          h('h2', null, 'For a whole school or district'),
          h('p', null, 'Plans for many teachers, with sign-in through your district (SAML, Clever or Google) and roster syncing, are agreed by quote.'),
          h('div', { class: 'row-actions' }, h('a', { class: 'button', href: `${plansUrl}#quote` }, 'Ask for a quote')))),
    );
  };

  void load();
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Plan & credits'), h('p', { class: 'muted' }, 'What your plan includes, and your AI generator credits.'))),
    body);
}
