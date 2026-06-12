import { ArrowLeft } from 'lucide-react';

type Props = {
  onBack: () => void;
};

export default function PrivacyPage({ onBack }: Props) {
  return (
    <div className="max-w-3xl mx-auto pb-20 md:pb-0">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-gray-400 hover:text-white text-sm mb-6 transition"
      >
        <ArrowLeft size={16} />
        Back
      </button>

      <div className="bg-gray-900 rounded-2xl border border-gray-800 p-8 md:p-10">
        <h1 className="text-2xl font-bold text-white mb-1">Privacy Policy</h1>
        <p className="text-gray-500 text-sm mb-8">RedA1, LLC dba Referr-All — Effective Date: May 22, 2026</p>

        <div className="prose prose-invert prose-sm max-w-none space-y-6 text-gray-300 leading-relaxed">
          <p>
            RedA1, LLC ("Company," "we," "us," or "our") respects your privacy. This Privacy Policy
            explains how we collect, use, disclose, and protect information when you access or use
            Referr-All (the "Service"). The Service is intended for Users located in the United States. By
            using the Service, you acknowledge that you have read and understood this Privacy Policy.
          </p>

          <h2 className="text-lg font-semibold text-white">1. Information We Collect</h2>

          <h3 className="text-base font-medium text-white">a. Information You Provide</h3>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-white">Account Information:</strong> name, email address, password, date of birth, and profile photo.</li>
            <li><strong className="text-white">Profile Information:</strong> employment history, education, skills, professional interests, location, social links, and any biographical information you choose to share.</li>
            <li><strong className="text-white">Referral Information:</strong> information about people you refer or are referred by (such as their name, professional background, and the opportunity involved), and information you submit when responding to referral opportunities.</li>
            <li><strong className="text-white">Communications:</strong> messages you send through the Service, including chats with other Users and correspondence with our support team.</li>
            <li><strong className="text-white">Payment Information:</strong> if you pay subscription fees, our payment processors collect billing details and card information on our behalf. We do not store full payment card numbers.</li>
            <li><strong className="text-white">User-Submitted Content:</strong> photos, posts, reviews, ratings, and other materials you upload.</li>
          </ul>

          <h3 className="text-base font-medium text-white">b. Information Collected Automatically</h3>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-white">Device and Usage Data:</strong> IP address, device type, operating system, browser type, language preferences, referring/exit pages, and time stamps.</li>
            <li><strong className="text-white">Cookies and Similar Technologies:</strong> we use cookies, web beacons, and similar technologies to recognize you, remember your preferences, analyze usage, and deliver relevant content.</li>
            <li><strong className="text-white">Location Data:</strong> approximate location derived from IP address, or precise location if you grant permission.</li>
            <li><strong className="text-white">Log Data:</strong> actions taken on the Service, including pages viewed, features used, blocks, reports, and referral submissions.</li>
          </ul>

          <h3 className="text-base font-medium text-white">c. Information from Third Parties</h3>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-white">Social Media and Single Sign-On:</strong> if you sign up using a third-party account (e.g., Google, LinkedIn, Apple), we receive profile information you authorize that service to share.</li>
            <li><strong className="text-white">Payment Processors:</strong> we receive transaction confirmations and limited account details from our payment processors.</li>
            <li><strong className="text-white">Other Users:</strong> when another User refers you, sends you a message, or reports/blocks your account, we receive related information.</li>
          </ul>

          <h2 className="text-lg font-semibold text-white">2. How We Use Your Information</h2>
          <p>We use the information we collect to:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Operate, maintain, and provide the Service, including creating and managing your account;</li>
            <li>Facilitate connections, messaging, networking, and referrals between Users;</li>
            <li>Process subscription payments;</li>
            <li>Verify identity and prevent fraud, spam, harassment, and bot activity (including enforcement of our Ten-Block Rule and other trust and safety measures);</li>
            <li>Personalize content, recommendations, and search results;</li>
            <li>Send transactional emails (e.g., account notices, referral updates, payment confirmations);</li>
            <li>Send marketing emails, where permitted, with the ability to opt out;</li>
            <li>Analyze usage and improve the Service and develop new features;</li>
            <li>Comply with legal obligations, enforce our Terms, and protect our rights, property, and safety, and that of others.</li>
          </ul>
          <p>We do not send SMS or text-message communications.</p>

          <h2 className="text-lg font-semibold text-white">3. How We Share Information</h2>
          <p>
            <strong className="text-white">With Other Users.</strong> Your profile information, posts, and certain activity are visible to other Users
            in accordance with your privacy settings.
          </p>
          <p>
            <strong className="text-white">With Service Providers.</strong> We share information with third parties that perform services on our
            behalf (e.g., hosting, analytics, payment processing, customer support, email delivery). These
            providers are bound by confidentiality obligations.
          </p>
          <p>
            <strong className="text-white">Business Transfers.</strong> If we are involved in a merger, acquisition, financing, reorganization,
            bankruptcy, or sale of assets, your information may be transferred as part of that transaction.
          </p>
          <p>
            <strong className="text-white">Legal and Safety.</strong> We may disclose information when we believe in good faith that disclosure is
            required by law, legal process, or government request, or is necessary to protect the rights,
            property, or safety of the Company, our Users, or others.
          </p>
          <p>
            We do not sell your personal information for monetary consideration.
          </p>

          <h2 className="text-lg font-semibold text-white">4. Cookies and Tracking Technologies</h2>
          <p>
            We use cookies and similar technologies for authentication, security, preferences, analytics, and
            (where permitted) advertising. You can control cookies through your browser settings. If you disable
            cookies, some features of the Service may not function properly.
          </p>

          <h2 className="text-lg font-semibold text-white">5. Data Retention</h2>
          <p>
            We retain personal information for as long as your account is active or as needed to provide the
            Service. We may retain certain information after account closure to comply with legal obligations,
            resolve disputes, enforce our agreements, and for other legitimate business purposes.
            Information related to banned accounts (including those banned under the Ten-Block Rule) may be
            retained indefinitely to enforce bans and protect the Service from repeat abuse.
          </p>

          <h2 className="text-lg font-semibold text-white">6. Security</h2>
          <p>
            We implement administrative, technical, and physical safeguards designed to protect your
            information. However, no system is completely secure, and we cannot guarantee absolute
            security. You are responsible for keeping your password confidential and notifying us promptly
            of any suspected unauthorized access.
          </p>

          <h2 className="text-lg font-semibold text-white">7. Your U.S. State Privacy Rights</h2>
          <p>
            Depending on the U.S. state where you reside (including California, Virginia, Colorado,
            Connecticut, Utah, Texas, and other states with comprehensive privacy laws), you may have
            the right to:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Know or access the categories and specific pieces of personal information we have collected about you;</li>
            <li>Request deletion of your personal information;</li>
            <li>Correct inaccurate personal information;</li>
            <li>Obtain a portable copy of your personal information;</li>
            <li>Opt out of "sale" or "sharing" of personal information;</li>
            <li>Limit the use of sensitive personal information (where applicable);</li>
            <li>Non-discrimination for exercising your rights;</li>
            <li>Appeal a denial of your privacy rights request.</li>
          </ul>
          <p>
            <strong className="text-white">Exercising Your Rights.</strong> To exercise any of these rights, please contact us at
            legal@RedA1.com. We may need to verify your identity before responding to your request.
          </p>

          <h2 className="text-lg font-semibold text-white">8. Children's Privacy</h2>
          <p>
            The Service is not intended for children under the age of 18, and we do not knowingly collect
            personal information from children under 13. If we learn that we have collected personal
            information from a child under 13, we will delete it. If you believe we have collected such
            information, please contact us at legal@RedA1.com.
          </p>

          <h2 className="text-lg font-semibold text-white">9. Marketing Communications</h2>
          <p>
            You may opt out of marketing emails by clicking the "unsubscribe" link in any marketing email or
            by adjusting your account notification settings. You may continue to receive transactional or
            administrative communications. The Service does not send SMS or text messages.
          </p>

          <h2 className="text-lg font-semibold text-white">10. Do Not Track</h2>
          <p>
            Some browsers offer a "Do Not Track" (DNT) feature. Because there is not yet a common
            industry standard for DNT, we do not currently respond to DNT signals. We disclose our
            tracking practices in this Privacy Policy.
          </p>

          <h2 className="text-lg font-semibold text-white">11. Third-Party Links and Services</h2>
          <p>
            The Service may contain links to third-party websites, apps, or services that are not operated by
            us. We are not responsible for the privacy practices of those third parties. We encourage you to
            review their privacy policies.
          </p>

          <h2 className="text-lg font-semibold text-white">12. Changes to This Privacy Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. We will post the updated version with a
            revised "Effective Date." If we make material changes, we will provide additional notice (e.g., by
            email or in-app notification). Your continued use of the Service after the Effective Date
            constitutes your acceptance of the updated Privacy Policy.
          </p>

          <h2 className="text-lg font-semibold text-white">13. Contact Us</h2>
          <p>
            If you have questions, concerns, or requests regarding this Privacy Policy or our privacy
            practices, contact us at:<br />
            <strong className="text-white">RedA1, LLC dba Referr-All</strong><br />
            Email: legal@RedA1.com
          </p>
        </div>
      </div>
    </div>
  );
}
