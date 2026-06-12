import { ArrowLeft } from 'lucide-react';

type Props = {
  onBack: () => void;
};

export default function TermsPage({ onBack }: Props) {
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
        <h1 className="text-2xl font-bold text-white mb-1">Terms of Service</h1>
        <p className="text-gray-500 text-sm mb-8">RedA1, LLC dba Referr-All — Effective Date: May 22, 2026</p>

        <div className="prose prose-invert prose-sm max-w-none space-y-6 text-gray-300 leading-relaxed">
          <p>
            Welcome to Referr-All, a service operated by RedA1, LLC ("Company," "we," "us," or "our").
            These Terms of Service (the "Terms") govern your access to and use of the Referr-All website,
            mobile applications, and related services (collectively, the "Service"). The Service is offered to
            Users located in the United States. By creating an account, accessing, or using the Service, you
            ("you," "User," or "Member") agree to be bound by these Terms. If you do not agree, do not use
            the Service.
          </p>

          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 text-amber-300 text-sm">
            <strong>PLEASE READ CAREFULLY.</strong> These Terms contain a binding arbitration provision and
            class action waiver (Section 17) that affect your legal rights. By using the Service, you
            agree to resolve disputes through individual arbitration and waive your right to
            participate in class actions.
          </div>

          <h2 className="text-lg font-semibold text-white">1. About the Service</h2>
          <p>
            Referr-All is an online platform that helps Users build professional networks, discover career
            opportunities, connect with potential collaborators and friends, and identify referral opportunities
            at participating companies. The Service includes profile creation, messaging, search and
            discovery features, and referral facilitation tools.
          </p>
          <p>
            <strong className="text-white">Referral Payments Are Between Users and Their Employers.</strong> The Service helps Users
            surface and share referral opportunities, but the Company is not a party to any referral payment
            arrangement. Any monetary rewards, bonuses, or other compensation paid for a successful
            referral are paid directly by the participating company to its own employee in accordance with
            that company's internal referral program. The Company does not pay referral rewards, does not
            collect referral fees from participating companies, does not act as an employment agency or
            recruiter, and is not responsible for any payment, non-payment, or dispute regarding referral
            compensation.
          </p>

          <h2 className="text-lg font-semibold text-white">2. Eligibility</h2>
          <p>
            You must be at least 18 years old and a resident of the United States to create an account or
            use the Service. By registering, you represent and warrant that:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>You are at least 18 years of age;</li>
            <li>You are a resident of the United States;</li>
            <li>You have the legal capacity to enter into a binding contract;</li>
            <li>You are not barred from using the Service under the laws of the United States or any other applicable jurisdiction;</li>
            <li>All information you provide is accurate, current, and complete; and</li>
            <li>You will maintain and update your information to keep it accurate.</li>
          </ul>
          <p>We reserve the right to refuse service, terminate accounts, or remove content at our sole discretion.</p>

          <h2 className="text-lg font-semibold text-white">3. Account Registration and Security</h2>
          <p>
            To use most features, you must create an account. You agree to: (a) provide accurate
            registration information; (b) maintain the security of your password and account credentials; (c)
            promptly notify us of any unauthorized access or use of your account; and (d) accept
            responsibility for all activities that occur under your account. We are not liable for any loss or
            damage resulting from your failure to safeguard your credentials.
          </p>

          <h2 className="text-lg font-semibold text-white">4. User Conduct and Acceptable Use</h2>
          <p>You agree NOT to:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Use the Service for any unlawful, fraudulent, deceptive, or harmful purpose;</li>
            <li>Impersonate any person or entity or misrepresent your affiliation;</li>
            <li>Create false or duplicate accounts, or operate accounts on behalf of others without authorization;</li>
            <li>Use bots, scrapers, crawlers, or any automated means to access, copy, or interact with the Service;</li>
            <li>Send spam, unsolicited bulk messages, chain letters, or harass other Users;</li>
            <li>Post, transmit, or share content that is illegal, defamatory, obscene, threatening, discriminatory, or infringes intellectual property rights;</li>
            <li>Collect, harvest, or store personal information about other Users without their consent;</li>
            <li>Attempt to reverse engineer, decompile, hack, or interfere with the operation, security, or integrity of the Service;</li>
            <li>Submit fraudulent, fabricated, or misleading referral information;</li>
            <li>Engage in coordinated blocking, mass false reporting, or other manipulation of our trust and safety systems;</li>
            <li>Use the Service to recruit Users to a competing platform; or</li>
            <li>Violate any applicable law, regulation, or these Terms.</li>
          </ul>

          <h2 className="text-lg font-semibold text-white">5. Blocking, Reporting, and Automatic Account Suspension</h2>
          <p>
            To protect the community from spam, harassment, and automated abuse, the Service provides
            tools for Users to block and report other Users. The following rules apply:
          </p>
          <p>
            <strong className="text-white">Ten-Block Rule.</strong> If your account is blocked by ten (10) or more distinct Users, your account will
            be automatically and permanently banned from the Service. This rule is designed to reduce bot
            activity, spam, and harassment. You acknowledge and agree that this automated enforcement
            mechanism is a material term of these Terms and that bans issued under this rule are final and
            not subject to appeal or review.
          </p>
          <p>
            <strong className="text-white">Other Grounds for Suspension or Ban.</strong> In addition to the Ten-Block Rule, we may suspend,
            restrict, or permanently terminate any account at any time, with or without notice, for any
            violation of these Terms or for any conduct that we determine, in our sole discretion, is harmful
            to other Users, the Service, or the Company. All such suspension and termination decisions are
            made at the Company's sole discretion and are final.
          </p>
          <p>
            <strong className="text-white">No Refunds; Forfeiture.</strong> Accounts banned under this Section forfeit access to any in-app
            credits, subscription benefits, or other balances, and no refunds will be issued, except where
            required by law.
          </p>

          <h2 className="text-lg font-semibold text-white">6. Referrals</h2>
          <p>
            <strong className="text-white">How Referrals Work.</strong> The Service allows Users to discover open positions or opportunities at
            participating companies, share those opportunities with their network, and signal interest in
            being referred. Whether and how a User is compensated for a referral is determined exclusively
            by the participating company's internal referral program, not by the Company.
          </p>
          <p>
            <strong className="text-white">No Payment Obligation by Company.</strong> The Company does not pay, guarantee, or process any
            referral compensation. The Company is not responsible for any company's decision to pay,
            withhold, delay, or deny a referral payment.
          </p>
          <p>
            <strong className="text-white">Good Faith Submissions.</strong> All referral information you submit through the Service must be
            truthful, accurate, and submitted in good faith based on a genuine relationship or knowledge of
            the referred party. Fabricated, duplicate, or misleading referrals are grounds for immediate
            suspension or ban.
          </p>
          <p>
            <strong className="text-white">Compliance with Law and Employer Policy.</strong> You are solely responsible for ensuring that your
            participation in referrals complies with all applicable laws and with your own employer's policies.
          </p>

          <h2 className="text-lg font-semibold text-white">7. User Content</h2>
          <p>
            <strong className="text-white">Your Content.</strong> You retain ownership of any content you submit to the Service (profile
            information, photos, messages, posts, referrals, and other materials, collectively, "User Content").
          </p>
          <p>
            <strong className="text-white">License to Us.</strong> By submitting User Content, you grant the Company a worldwide, non-exclusive,
            royalty-free, transferable, sublicensable license to host, store, reproduce, modify,
            distribute, display, and otherwise use your User Content for the purpose of operating, providing,
            and improving the Service.
          </p>
          <p>
            <strong className="text-white">Removal.</strong> We may remove or refuse to display any User Content at any time, in our sole
            discretion, without notice.
          </p>

          <h2 className="text-lg font-semibold text-white">8. Intellectual Property</h2>
          <p>
            All trademarks, service marks, logos, designs, software, text, graphics, and other materials
            provided by the Company (other than User Content) are the property of RedA1, LLC or its
            licensors and are protected by intellectual property laws. You are granted a limited, revocable,
            non-exclusive, non-transferable license to use the Service for its intended purpose. All rights not
            expressly granted are reserved.
          </p>

          <h2 className="text-lg font-semibold text-white">9. Fees, Subscriptions, and Payments</h2>
          <p>
            Certain features of the Service may require payment of fees or subscription charges. All fees
            are stated in U.S. dollars and are non-refundable except where required by law or as expressly
            stated. We may change our fees at any time on reasonable prior notice. Payments are
            processed by third-party payment processors, and your use of those services is subject to their
            terms.
          </p>

          <h2 className="text-lg font-semibold text-white">10. Third-Party Services and Links</h2>
          <p>
            The Service may contain links to or integrate with third-party websites, applications, or services.
            We do not endorse and are not responsible for any third-party content, products, or services.
            Your use of third-party services is at your own risk and subject to the terms of those third parties.
          </p>

          <h2 className="text-lg font-semibold text-white">11. Privacy</h2>
          <p>
            Your use of the Service is also governed by our Privacy Policy, which is incorporated into these
            Terms by reference. Please review the Privacy Policy to understand how we collect, use, and
            share your information.
          </p>

          <h2 className="text-lg font-semibold text-white">12. Termination</h2>
          <p>
            You may terminate your account at any time by following the in-app instructions or contacting
            us. We may suspend or terminate your access at any time for any reason, including violation of
            these Terms. Upon termination, your right to use the Service ends immediately.
          </p>

          <h2 className="text-lg font-semibold text-white">13. Disclaimers</h2>
          <p className="uppercase text-xs text-gray-400 leading-relaxed">
            THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF
            ANY KIND, EXPRESS OR IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY,
            FITNESS FOR A PARTICULAR PURPOSE, NON-INFRINGEMENT, AND ANY WARRANTIES
            ARISING FROM COURSE OF DEALING OR USAGE OF TRADE. WE DO NOT WARRANT
            THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, SECURE, OR FREE OF
            VIRUSES. WE MAKE NO REPRESENTATIONS ABOUT THE ACCURACY, RELIABILITY,
            OR SUITABILITY OF ANY USER CONTENT OR REFERRAL INFORMATION. THE
            COMPANY IS NOT AN EMPLOYER, EMPLOYMENT AGENCY, RECRUITER, OR PARTY TO
            ANY HIRING, REFERRAL PAYMENT, OR BUSINESS RELATIONSHIP BETWEEN USERS
            OR THIRD PARTIES.
          </p>

          <h2 className="text-lg font-semibold text-white">14. Limitation of Liability</h2>
          <p className="uppercase text-xs text-gray-400 leading-relaxed">
            TO THE FULLEST EXTENT PERMITTED BY LAW, IN NO EVENT WILL THE COMPANY, ITS
            AFFILIATES, OFFICERS, DIRECTORS, EMPLOYEES, OR AGENTS BE LIABLE FOR ANY
            INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE
            DAMAGES, OR ANY LOSS OF PROFITS, REVENUE, DATA, GOODWILL, OR BUSINESS
            OPPORTUNITY, ARISING OUT OF OR RELATED TO YOUR USE OF THE SERVICE, EVEN
            IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES. OUR TOTAL CUMULATIVE
            LIABILITY FOR ALL CLAIMS RELATING TO THE SERVICE WILL NOT EXCEED THE
            GREATER OF (A) THE AMOUNTS YOU PAID TO US IN THE TWELVE (12) MONTHS
            PRECEDING THE EVENT GIVING RISE TO THE CLAIM, OR (B) ONE HUNDRED U.S.
            DOLLARS ($100).
          </p>

          <h2 className="text-lg font-semibold text-white">15. Indemnification</h2>
          <p>
            You agree to indemnify, defend, and hold harmless the Company, its affiliates, officers,
            directors, employees, and agents from and against any and all claims, damages, losses,
            liabilities, costs, and expenses (including reasonable attorneys' fees) arising out of or related to:
            (a) your use of the Service; (b) your User Content; (c) your violation of these Terms or any law;
            or (d) your infringement of any third party's rights.
          </p>

          <h2 className="text-lg font-semibold text-white">16. Governing Law</h2>
          <p>
            These Terms are governed by and construed in accordance with the laws of the State in which
            the Company maintains its principal place of business, without regard to its conflict-of-law principles.
          </p>

          <h2 className="text-lg font-semibold text-white">17. Dispute Resolution; Arbitration; Class Action Waiver</h2>
          <p>
            <strong className="text-white">Informal Resolution.</strong> Before filing any formal claim, you agree to first contact us at
            legal@RedA1.com to attempt to resolve the dispute informally. We will attempt to resolve the
            dispute within sixty (60) days.
          </p>
          <p>
            <strong className="text-white">Binding Arbitration.</strong> If the dispute is not resolved informally, you and the Company agree that
            any claim, dispute, or controversy arising out of or relating to these Terms or the Service shall
            be resolved by binding individual arbitration administered by the American Arbitration
            Association (AAA) under its Consumer Arbitration Rules.
          </p>
          <p className="font-semibold text-white">
            Class Action Waiver. YOU AND THE COMPANY AGREE THAT EACH MAY BRING CLAIMS
            AGAINST THE OTHER ONLY IN AN INDIVIDUAL CAPACITY AND NOT AS A PLAINTIFF OR
            CLASS MEMBER IN ANY PURPORTED CLASS, COLLECTIVE, OR REPRESENTATIVE PROCEEDING.
          </p>
          <p>
            <strong className="text-white">Opt-Out.</strong> You may opt out of this arbitration agreement by sending written notice to
            legal@RedA1.com within thirty (30) days of first accepting these Terms.
          </p>

          <h2 className="text-lg font-semibold text-white">18. Changes to These Terms</h2>
          <p>
            We may modify these Terms at any time. If we make material changes, we will provide notice
            (e.g., by email or in-app notification) at least seven (7) days before the changes take effect.
            Your continued use of the Service after the effective date constitutes your acceptance of the
            revised Terms.
          </p>

          <h2 className="text-lg font-semibold text-white">19. Miscellaneous</h2>
          <p>
            <strong className="text-white">Entire Agreement.</strong> These Terms, together with our Privacy Policy, constitute the entire
            agreement between you and the Company regarding the Service.
          </p>
          <p><strong className="text-white">Severability.</strong> If any provision is held invalid or unenforceable, the remaining provisions remain in full force and effect.</p>
          <p><strong className="text-white">No Waiver.</strong> Our failure to enforce any provision is not a waiver of our right to enforce it later.</p>
          <p><strong className="text-white">Assignment.</strong> You may not assign or transfer these Terms without our prior written consent. We may assign these Terms freely.</p>
          <p><strong className="text-white">Force Majeure.</strong> We are not liable for any failure or delay caused by events beyond our reasonable control.</p>

          <h2 className="text-lg font-semibold text-white">20. Contact Us</h2>
          <p>
            If you have any questions about these Terms, please contact us at:<br />
            <strong className="text-white">RedA1, LLC dba Referr-All</strong><br />
            Email: legal@RedA1.com
          </p>
        </div>
      </div>
    </div>
  );
}
