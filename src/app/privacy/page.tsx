export const metadata = {
  title: "Privacy Policy | WeAfrica Ride Admin",
};

export default function PrivacyPolicyPage() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px", lineHeight: 1.6 }}>
      <h1>Privacy Policy</h1>
      <p>Last updated: {new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</p>

      <p>
        This policy explains how WeAfrica Ride Admin ("the Dashboard"), operated by WeAfrica
        Ride, collects, uses, and protects information in the course of managing the WeAfrica
        Ride platform.
      </p>

      <h2>1. Information we handle</h2>
      <p>
        Authorised staff using the Dashboard may access: driver and rider account details
        (names, contact information, identity verification documents, vehicle information);
        ride and delivery records; payment and payout data; safety incident reports; and
        marketing/social media account credentials and campaign content used to publish official
        WeAfrica Ride content to connected social platforms.
      </p>

      <h2>2. How we use it</h2>
      <p>
        This information is used solely to operate the WeAfrica Ride platform: verifying and
        onboarding drivers, coordinating rides and deliveries, processing payments, resolving
        safety and support issues, and running official marketing campaigns.
      </p>

      <h2>3. Social media platform data</h2>
      <p>
        Where the Dashboard connects to third-party social platforms (Facebook, Instagram,
        TikTok, LinkedIn, YouTube, X), it accesses only the official WeAfrica Ride brand
        account(s) on those platforms — not individual driver, rider, or end-user accounts.
        Access tokens for these connections are stored encrypted and are used only to publish
        approved campaign content and retrieve aggregate post performance (impressions, reach,
        engagement, video views). This data is used to measure WeAfrica Ride's own marketing
        performance and is not shared with third parties beyond the platforms themselves.
      </p>

      <h2>4. Data storage and security</h2>
      <p>
        Data is stored using access-controlled infrastructure (Supabase) with row-level security
        restricting access to authorised roles. Access credentials for connected third-party
        accounts are encrypted and are not accessible from the client application.
      </p>

      <h2>5. Data retention</h2>
      <p>
        Operational data is retained for as long as necessary to run the WeAfrica Ride platform
        and to meet legal, tax, and safety record-keeping obligations under Malawian law.
      </p>

      <h2>6. Your rights</h2>
      <p>
        Drivers and riders with an account on the WeAfrica Ride platform may request access to,
        correction of, or deletion of their personal data by contacting WeAfrica Ride at{" "}
        <a href="mailto:infoweafrica@gmail.com">infoweafrica@gmail.com</a>.
      </p>

      <h2>7. Changes to this policy</h2>
      <p>
        WeAfrica Ride may update this policy from time to time. Material changes will be
        reflected by an updated "Last updated" date above.
      </p>

      <h2>8. Contact</h2>
      <p>
        Questions about this policy can be directed to{" "}
        <a href="mailto:infoweafrica@gmail.com">infoweafrica@gmail.com</a>.
      </p>
    </main>
  );
}
