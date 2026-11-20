import { render, screen } from '@testing-library/react';
import LandingPage from './page';
import { describe, it, expect } from 'vitest';

describe('LandingPage (Public Home)', () => {
  it('renders the hero headline and both CTAs with hrefs /signup and /login', () => {
    render(<LandingPage />);

    const heroHeading = screen.getByRole('heading', {
      level: 1,
      name: /social media management for agencies and small teams — plan, publish, and measure client accounts from one workspace/i,
    });
    expect(heroHeading).toBeInTheDocument();

    // Primary CTA
    const primaryCta = screen.getByRole('link', { name: 'Start 14-day free trial' });
    expect(primaryCta).toBeInTheDocument();
    expect(primaryCta).toHaveAttribute('href', '/signup');

    // Secondary CTA in hero
    const heroSignInLinks = screen.getAllByRole('link', { name: 'Sign in' });
    expect(heroSignInLinks.length).toBeGreaterThanOrEqual(1);
    expect(heroSignInLinks.some((link) => link.getAttribute('href') === '/login')).toBe(true);

    // Microcopy
    expect(screen.getByText('No credit card required.')).toBeInTheDocument();
  });

  it('renders all six risk-reversal items', () => {
    render(<LandingPage />);

    expect(screen.getByText('14-day free trial — no credit card')).toBeInTheDocument();
    expect(screen.getByText('Monthly billing — cancel anytime')).toBeInTheDocument();
    expect(screen.getByText('7-day money-back guarantee')).toBeInTheDocument();
    expect(screen.getByText('UPI and cards accepted via Razorpay')).toBeInTheDocument();
    expect(screen.getByText('GST invoice on every payment')).toBeInTheDocument();
    expect(screen.getByText('Prices include GST')).toBeInTheDocument();
  });

  it('renders the three tiers with exact monthly prices, seat counts, social account allowances, GST inclusive, and Founding 50 callout', () => {
    render(<LandingPage />);

    // Tier 1: Solo
    expect(screen.getByRole('heading', { level: 3, name: 'Solo' })).toBeInTheDocument();
    expect(screen.getByText('₹499')).toBeInTheDocument();
    expect(screen.getByText('1 seat included')).toBeInTheDocument();
    expect(screen.getByText('Up to 5 social accounts')).toBeInTheDocument();

    // Tier 2: Studio
    expect(screen.getByRole('heading', { level: 3, name: 'Studio' })).toBeInTheDocument();
    expect(screen.getByText('₹999')).toBeInTheDocument();
    expect(screen.getByText('3 seats included')).toBeInTheDocument();
    expect(screen.getByText('Up to 15 social accounts')).toBeInTheDocument();

    // Tier 3: Agency (elevated with tag)
    expect(screen.getByRole('heading', { level: 3, name: 'Agency' })).toBeInTheDocument();
    expect(screen.getByText('For agencies')).toBeInTheDocument();
    expect(screen.getByText('₹3,999')).toBeInTheDocument();
    expect(screen.getByText('10 seats included')).toBeInTheDocument();
    expect(screen.getByText('Up to 30 social accounts')).toBeInTheDocument();

    // GST inclusive label on tiers
    const gstInclusiveLabels = screen.getAllByText(/GST inclusive/i);
    expect(gstInclusiveLabels.length).toBeGreaterThanOrEqual(3);

    // Annual billing note (without annual totals)
    expect(screen.getByText('Annual billing: 2 months free')).toBeInTheDocument();

    // Founding 50 callout
    expect(
      screen.getByText(
        'Founding 50 — ₹2,999/month, price locked while your subscription stays active, for the first 50 customers.'
      )
    ).toBeInTheDocument();

    // Pricing CTAs go to /signup
    const trialLinks = screen.getAllByRole('link', { name: /start free trial/i });
    expect(trialLinks.length).toBeGreaterThanOrEqual(3);
    trialLinks.forEach((link) => {
      expect(link).toHaveAttribute('href', '/signup');
    });
  });

  it('renders shipped features grid including newly shipped client approvals and white-label reports', () => {
    render(<LandingPage />);

    expect(screen.getByRole('heading', { level: 2, name: 'Shipped features' })).toBeInTheDocument();

    // Shipped features — all 10 cards
    expect(screen.getByRole('heading', { level: 3, name: 'Multi-platform publishing' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Post scheduling' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Per-platform post variants' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Media library' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Analytics dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Team workspaces & roles' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Client approvals' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'White-label reports' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Account security' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'GST-ready billing' })).toBeInTheDocument();

    // Verified copy for new features
    expect(
      screen.getByText(
        /clients review and approve posts before they publish; change requests come back with comments, and nothing goes live while approval is pending\./i
      )
    ).toBeInTheDocument();

    expect(
      screen.getByText(
        /client-ready PDF reports with your agency's name, logo and brand colour instead of ours\./i
      )
    ).toBeInTheDocument();
  });

  it('renders the FAQ entries including approvals and white-label questions', () => {
    render(<LandingPage />);

    expect(screen.getByRole('heading', { level: 2, name: 'Frequently asked questions' })).toBeInTheDocument();

    // Existing and new FAQ questions
    expect(screen.getByText('What are the terms of the free trial?')).toBeInTheDocument();
    expect(screen.getByText('Can my clients approve posts before they go live?')).toBeInTheDocument();
    expect(screen.getByText('Can I send reports with my own branding?')).toBeInTheDocument();
    expect(screen.getByText('What payment methods are accepted?')).toBeInTheDocument();
    expect(screen.getByText('Do prices include GST?')).toBeInTheDocument();
    expect(screen.getByText('How do cancellations and refunds work?')).toBeInTheDocument();
    expect(screen.getByText('Which social media platforms are supported?')).toBeInTheDocument();

    // Factual answers for new questions
    expect(
      screen.getByText(
        /send a post for approval, the client approves or requests changes with a comment, and publishing stays blocked until it's approved\./i
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /add your agency name, logo and brand colour in settings and client reports carry your brand, not Agency OS\./i
      )
    ).toBeInTheDocument();
  });

  it('renders the final CTA band before the footer linking to /signup', () => {
    render(<LandingPage />);

    const finalCtaHeading = screen.getByRole('heading', {
      level: 2,
      name: /ready to streamline your agency publishing\?/i,
    });
    expect(finalCtaHeading).toBeInTheDocument();

    expect(
      screen.getByText('Get full access to all features with a 14-day free trial — no credit card required.')
    ).toBeInTheDocument();

    // All "Start free trial" links link to /signup
    const freeTrialLinks = screen.getAllByRole('link', { name: 'Start free trial' });
    expect(freeTrialLinks.length).toBeGreaterThanOrEqual(1);
    freeTrialLinks.forEach((link) => {
      expect(link).toHaveAttribute('href', '/signup');
    });
  });

  it('renders footer with operator copyright, email, and legal links', () => {
    render(<LandingPage />);

    expect(screen.getByText(/© Gadmale Technologies/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'agadmale335@gmail.com' })).toHaveAttribute(
      'href',
      'mailto:agadmale335@gmail.com'
    );

    const termsLink = screen.getByRole('link', { name: 'Terms' });
    expect(termsLink).toHaveAttribute('href', '/terms');

    const privacyLink = screen.getByRole('link', { name: 'Privacy' });
    expect(privacyLink).toHaveAttribute('href', '/privacy');

    const refundLinks = screen.getAllByRole('link', { name: /refund & cancellation/i });
    expect(refundLinks.some((link) => link.getAttribute('href') === '/refund-cancellation')).toBe(
      true
    );
  });

  it('NEGATIVE assertions: does not contain unbuilt features, testimonials, or social proof claims', () => {
    const { container } = render(<LandingPage />);
    const pageText = container.textContent || '';
    const pageHtml = container.innerHTML || '';

    // Unbuilt features forbidden
    expect(pageText).not.toMatch(/ai caption/i);
    expect(pageHtml).not.toMatch(/ai caption/i);

    // Social proof forbidden
    expect(pageText).not.toMatch(/testimonial/i);
    expect(pageHtml).not.toMatch(/testimonial/i);

    expect(pageText).not.toMatch(/trusted by/i);
    expect(pageHtml).not.toMatch(/trusted by/i);
  });
});
