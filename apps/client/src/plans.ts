import type { User } from '@qbl/shared';
import type { Api, Billing, PlanCard } from './net/Api';

/** Where the missions page goes once someone has signed in, when a page sent them there (sessionStorage). */
export const AFTER_SIGN_IN_KEY = 'qbl.after-sign-in';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long' }) : '');
const message = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

/** What each plan includes, as the cards list it. Worked out apart from the page, to be tested. */
export function planFeatures(plan: PlanCard, costPerMission: number): string[] {
  const out: string[] = [];
  if (plan.key === 'free') return ['Play every free mission', 'Your own character, stars and badges', 'Join a class with a teacher’s plan'];
  if (plan.curricular) out.push('Every curricular mission, to play and to assign');
  out.push(plan.students == null ? 'Any number of students' : `Classes of up to ${plan.students} students`, 'Teams, assignments and reports');
  if (plan.generator) {
    const missions = costPerMission > 0 ? Math.floor(plan.monthly_credits / costPerMission) : 0;
    out.push(`The AI mission generator: ${plan.monthly_credits} credits a month${missions ? ` (about ${missions} missions)` : ''}`);
    if (plan.credit_carryover) out.push(`Unused credits carry over, up to ${plan.credit_carryover}`);
  }
  return out;
}

/**
 * The plans page (/plans): Free, Teacher and Teacher Plus, each with the free trial once, a coupon
 * code, Stripe Checkout and Stripe's billing page; and for schools and districts, a request for a
 * quote. Anyone can read it; buying needs an account (signing in comes back here).
 */
export async function showPlans(api: Api): Promise<void> {
  const gate = document.getElementById('gate')!;
  document.title = 'Plans';
  gate.classList.add('home');
  gate.removeAttribute('role');
  const params = new URLSearchParams(window.location.search);
  const user: User | null = await api.me().catch(() => null);
  let billing: Billing = await api.billing();
  let coupon: { code: string; description: string } | null = null;

  const page = el('div', 'qbl-home qbl-plans');
  const bar = el('header', 'qbl-site');
  const brand = el('a', 'qbl-site-brand', 'QuestLab');
  brand.href = '/';
  const nav = el('nav', 'qbl-site-nav');
  const missions = el('a', 'qbl-site-link', 'Missions');
  missions.href = '/missions';
  nav.append(missions);
  if (user && (user.role === 'teacher' || user.role === 'admin')) {
    const editor = el('a', 'qbl-site-link', 'Editor');
    editor.href = '/editor/#/plan';
    nav.append(editor);
  }
  const who = el('span', 'qbl-plans-who', user && user.role !== 'guest' ? `Signed in as ${user.name}` : '');
  bar.append(brand, nav, who);
  const banner = el('div', 'qbl-plans-banner');
  banner.hidden = true;
  const cards = el('div', 'qbl-plan-cards');
  const head = el('header', 'qbl-plans-head');
  page.append(bar, head, banner, cards);
  head.append(el('h1', undefined, 'Plans'), el('p', undefined, billing.trial_days > 0 ? `Every paid plan starts with a ${billing.trial_days}-day free trial. Cancel any time.` : 'Cancel any time.'));

  const say = (text: string, tone: 'ok' | 'error' | 'info' = 'info') => {
    banner.hidden = false;
    banner.className = `qbl-plans-banner ${tone}`;
    banner.textContent = text;
  };
  const signedIn = !!user && user.role !== 'guest';
  const subscribed = () => billing.entitlements?.source === 'subscription' && ['trialing', 'active', 'past_due'].includes(billing.subscription?.status ?? '');
  const managedElsewhere = () => billing.entitlements?.source === 'organization' || billing.entitlements?.source === 'admin';

  /** Send someone to sign in (or make an account) and back here afterwards. */
  const signInFirst = (create: boolean, plan?: string) => {
    try {
      sessionStorage.setItem(AFTER_SIGN_IN_KEY, `/plans${plan ? `?plan=${encodeURIComponent(plan)}` : ''}`);
    } catch {
      /* without storage they come back by hand */
    }
    window.location.assign(create ? '/missions#create-account' : '/missions');
  };

  const choose = async (plan: PlanCard, button: HTMLButtonElement) => {
    if (!signedIn) return signInFirst(true, plan.key);
    button.disabled = true;
    try {
      if (subscribed()) {
        if (!window.confirm(`Switch to ${plan.name} ($${plan.price} a month)? The difference is prorated on your next invoice.`)) return void (button.disabled = false);
        billing = await api.changePlan(plan.key);
        say(`You are on ${billing.entitlements?.plan_name} now.`, 'ok');
        draw();
        return;
      }
      window.location.assign(await api.checkout(plan.key, coupon?.code));
    } catch (err) {
      button.disabled = false;
      say(message(err, 'Could not start checkout.'), 'error');
    }
  };

  const status = () => {
    const e = billing.entitlements;
    const sub = billing.subscription;
    if (!e || !signedIn) return null;
    const box = el('div', 'qbl-plans-status');
    let line = `You are on ${e.plan_name}.`;
    if (e.source === 'organization') line = `You have ${e.plan_name}, through ${e.organization?.name ?? 'your school'}.`;
    else if (e.source === 'admin') line = 'Administrators have everything.';
    else if (sub && subscribed()) {
      line += sub.status === 'trialing' ? ` Your free trial runs until ${day(sub.trial_ends_at)}.`
        : sub.status === 'past_due' ? ' Your last payment did not go through: update your card in “Manage billing”.'
        : sub.cancel_at_period_end ? ` It ends on ${day(sub.current_period_end)}.` : ` It renews on ${day(sub.current_period_end)}.`;
    }
    box.append(el('p', undefined, line));
    if (sub?.manageable && billing.payments) {
      const manage = el('button', 'qbl-plan-secondary', 'Manage billing');
      manage.type = 'button';
      manage.dataset.action = 'portal';
      manage.addEventListener('click', async () => {
        try {
          window.location.assign(await api.billingPortal());
        } catch (err) {
          say(message(err, 'Could not open billing.'), 'error');
        }
      });
      box.append(manage);
    }
    return box;
  };

  const couponBox = () => {
    const box = el('form', 'qbl-coupon');
    box.dataset.form = 'coupon';
    const input = el('input');
    input.name = 'code';
    input.placeholder = 'Coupon code';
    input.autocomplete = 'off';
    input.value = coupon?.code ?? '';
    const apply = el('button', 'qbl-plan-secondary', 'Apply');
    apply.type = 'submit';
    const result = el('span', 'qbl-coupon-result', coupon ? `${coupon.code}: ${coupon.description}` : '');
    box.append(el('label', undefined, 'Have a coupon code?'), input, apply, result);
    box.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!input.value.trim()) return;
      if (!signedIn) return signInFirst(false);
      try {
        coupon = await api.promotion(input.value.trim());
        result.textContent = `${coupon.code}: ${coupon.description}. It is applied at checkout.`;
        result.className = 'qbl-coupon-result ok';
      } catch (err) {
        coupon = null;
        result.textContent = message(err, 'That code did not work.');
        result.className = 'qbl-coupon-result error';
      }
    });
    return box;
  };

  const card = (plan: PlanCard) => {
    const node = el('article', `qbl-plan ${plan.key}`);
    node.dataset.plan = plan.key;
    const current = billing.entitlements?.plan === plan.key;
    if (plan.key === 'teacher_plus') node.append(el('span', 'qbl-plan-flag', 'Most popular'));
    node.append(el('h2', undefined, plan.name));
    const price = el('p', 'qbl-plan-price');
    price.append(el('strong', undefined, plan.price ? `$${plan.price}` : '$0'), document.createTextNode(plan.price ? ' a month' : ''));
    node.append(price, el('p', 'qbl-plan-summary', plan.summary));
    const list = el('ul');
    for (const f of planFeatures(plan, billing.costs.generation)) list.append(el('li', undefined, f));
    node.append(list);
    const button = el('button', plan.key === 'free' ? 'qbl-plan-secondary' : 'qbl-plan-primary');
    button.type = 'button';
    if (plan.key === 'free') {
      button.textContent = signedIn ? 'Go to your missions' : 'Start playing';
      button.addEventListener('click', () => (signedIn ? window.location.assign('/missions') : signInFirst(true)));
    } else if (current) {
      button.textContent = 'Your plan';
      button.disabled = true;
    } else if (!billing.payments || managedElsewhere()) {
      button.textContent = managedElsewhere() ? 'Included' : 'Not on sale yet';
      button.disabled = true;
    } else {
      button.textContent = subscribed() ? `Switch to ${plan.name}` : billing.subscription?.trial_used ? `Choose ${plan.name}` : `Start the ${billing.trial_days}-day free trial`;
      button.dataset.action = 'choose';
      button.addEventListener('click', () => void choose(plan, button));
    }
    node.append(button);
    return node;
  };

  const schools = () => {
    const node = el('article', 'qbl-plan schools');
    node.dataset.plan = 'schools';
    const price = el('p', 'qbl-plan-price');
    price.append(el('strong', undefined, 'Custom'));
    node.append(el('h2', undefined, 'Schools and districts'), price,
      el('p', 'qbl-plan-summary', 'For every teacher in a school or district.'));
    const list = el('ul');
    for (const f of ['Everything in Teacher Plus, for every teacher', 'Sign-in with SAML, Clever or Google', 'Rosters synced from Clever, Google Classroom, your SIS or a file', 'A data privacy agreement; no student names or emails kept']) list.append(el('li', undefined, f));
    const ask = el('a', 'qbl-plan-secondary', 'Ask for a quote');
    ask.href = '#quote';
    node.append(list, ask);
    return node;
  };

  const quote = () => {
    const form = el('form', 'qbl-quote');
    form.id = 'quote';
    form.dataset.form = 'quote';
    form.append(el('h2', undefined, 'Ask for a quote'), el('p', undefined, 'Tell us about your school or district and we will be in touch within one working day.'));
    if (billing.sales_phone) {
      const call = el('p');
      const tel = el('a', undefined, billing.sales_phone);
      tel.href = `tel:${billing.sales_phone.replace(/[^\d+]/g, '')}`;
      call.append(document.createTextNode('Or call us: '), tel);
      form.append(call);
    }
    const fields: Array<[string, string, string, boolean]> = [
      ['name', 'Your name', 'text', true], ['email', 'Work email', 'email', true], ['organization', 'School or district', 'text', true],
      ['role', 'Your role', 'text', false], ['phone', 'Phone (optional)', 'tel', false], ['students', 'How many students', 'number', false],
    ];
    const inputs: Record<string, HTMLInputElement | HTMLTextAreaElement> = {};
    const grid = el('div', 'qbl-quote-grid');
    for (const [name, label, type, required] of fields) {
      const input = el('input');
      input.name = name;
      input.type = type;
      input.required = required;
      if (name === 'email' && user?.email) input.value = user.email;
      inputs[name] = input;
      const wrap = el('label');
      wrap.append(el('span', undefined, label), input);
      grid.append(wrap);
    }
    const text = el('textarea');
    text.name = 'message';
    text.rows = 3;
    inputs.message = text;
    const wrap = el('label', 'wide');
    wrap.append(el('span', undefined, 'Anything else (optional)'), text);
    grid.append(wrap);
    const send = el('button', 'qbl-plan-primary', 'Send');
    send.type = 'submit';
    const result = el('p', 'qbl-quote-result');
    form.append(grid, send, result);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      send.disabled = true;
      try {
        const v = (k: string) => inputs[k]!.value.trim();
        result.textContent = await api.quote({ name: v('name'), email: v('email'), organization: v('organization'), role: v('role') || undefined, phone: v('phone') || undefined, students: Number(v('students')) || undefined, message: v('message') || undefined });
        result.className = 'qbl-quote-result ok';
        form.reset();
      } catch (err) {
        result.textContent = message(err, 'Could not send it. Please email us instead.');
        result.className = 'qbl-quote-result error';
      } finally {
        send.disabled = false;
      }
    });
    return form;
  };

  const draw = () => {
    cards.replaceChildren();
    if (!billing.enabled) {
      cards.append(el('p', 'qbl-home-notice', 'Everything is open on this site: every mission, classes of any size, and the AI generator. There is nothing to buy.'));
      return;
    }
    const s = status();
    if (s) cards.append(s);
    if (!signedIn) {
      const note = el('p', 'qbl-home-notice');
      const link = el('a', undefined, 'Sign in');
      link.href = '/missions';
      link.addEventListener('click', (e) => {
        e.preventDefault();
        signInFirst(false);
      });
      note.append(link, document.createTextNode(' or create an account to start a free trial.'));
      cards.append(note);
    }
    if (billing.payments && !managedElsewhere() && !subscribed()) cards.append(couponBox());
    const row = el('div', 'qbl-plan-row');
    for (const plan of billing.plans) row.append(card(plan));
    row.append(schools());
    cards.append(row, quote());
  };

  gate.replaceChildren(page);
  draw();

  // Back from Stripe Checkout. The webhook may be a moment behind, so look again for a while.
  const back = params.get('checkout');
  if (back === 'cancelled') say('Checkout was cancelled. Nothing was charged.');
  if (back === 'done') {
    say('Thank you! Setting up your plan…', 'ok');
    for (let i = 0; i < 10 && !subscribed(); i++) {
      await new Promise((done) => setTimeout(done, 2000));
      billing = await api.billing().catch(() => billing);
    }
    say(subscribed() ? `You are on ${billing.entitlements?.plan_name}.${billing.subscription?.status === 'trialing' ? ` Your free trial runs until ${day(billing.subscription.trial_ends_at)}.` : ''} Open the editor to set up your class.` : 'Your payment went through. Your plan will appear here in a minute.', 'ok');
    draw();
  }
  history.replaceState(null, '', '/plans' + window.location.hash);
  // Sent here to buy a plan, and now signed in: straight on to checkout.
  const wanted = billing.plans.find((p) => p.key === params.get('plan') && p.key !== 'free');
  if (wanted && signedIn && billing.payments && !subscribed() && !managedElsewhere()) {
    say(`Opening checkout for ${wanted.name}…`);
    try {
      window.location.assign(await api.checkout(wanted.key));
    } catch (err) {
      say(message(err, 'Could not start checkout.'), 'error');
    }
  }
  if (window.location.hash === '#quote') document.getElementById('quote')?.scrollIntoView();
}
