export const metadata = {
  title: "Terms of Service | WeAfrica Ride Admin",
};

export default function TermsOfServicePage() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px", lineHeight: 1.6 }}>
      <h1>Terms of Service</h1>
      <p>Last updated: {new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</p>

      <p>
        WeAfrica Ride Admin ("the Dashboard") is an internal management tool operated by
        WeAfrica Ride for the administration of the WeAfrica Ride ride-hailing and delivery
        platform in Malawi, including driver onboarding, ride and delivery operations, payments,
        safety, and marketing functions.
      </p>

      <h2>1. Access</h2>
      <p>
        Access to the Dashboard is restricted to authorised WeAfrica Ride staff and operators.
        Accounts are provisioned individually and may not be shared. Access may be revoked at
        any time at WeAfrica Ride's discretion.
      </p>

      <h2>2. Acceptable use</h2>
      <p>
        The Dashboard may only be used for legitimate WeAfrica Ride business purposes, including
        but not limited to reviewing and approving driver applications, managing rides and
        deliveries, processing payments and payouts, handling safety incidents, and creating and
        publishing marketing content to WeAfrica Ride's official social media accounts.
      </p>

      <h2>3. Data handling</h2>
      <p>
        Users of the Dashboard may access personal data belonging to drivers, riders, and
        customers in the course of their duties. This data must be handled in accordance with
        WeAfrica Ride's internal data protection policies and applicable Malawian law, and must
        not be exported, shared, or used for any purpose outside of authorised WeAfrica Ride
        operations.
      </p>

      <h2>4. Third-party integrations</h2>
      <p>
        The Dashboard integrates with third-party services, including social media platforms
        (Facebook, Instagram, TikTok, LinkedIn, YouTube, X) for the purpose of publishing official
        WeAfrica Ride marketing content, and payment providers for processing driver and rider
        transactions. Use of these integrations is subject to the respective third party's own
        terms of service.
      </p>

      <h2>5. Changes to these terms</h2>
      <p>
        WeAfrica Ride may update these terms from time to time. Continued use of the Dashboard
        after changes are posted constitutes acceptance of the revised terms.
      </p>

      <h2>6. Contact</h2>
      <p>
        Questions about these terms can be directed to WeAfrica Ride at{" "}
        <a href="mailto:infoweafrica@gmail.com">infoweafrica@gmail.com</a>.
      </p>
    </main>
  );
}
