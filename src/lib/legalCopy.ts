/**
 * The ONE source of Logbook's Privacy Policy and Terms of Service (#537).
 *
 * Rendered in two places from this file: the in-app Legal sheet
 * (LegalSheet.vue) and the static pages the build emits at
 * /legal/privacy.html and /legal/terms.html (vite-plugin-legal-pages.ts) — the
 * public URLs App Store Connect, the App Privacy questionnaire and App Review
 * point at. Two copies of legal text drift; this is why there is one.
 *
 * When a feature changes what Logbook collects or who it sends data to (a new
 * third party, a new data type, a new permission), change it HERE, and in the
 * same commit update the iOS privacy manifest (scripts/configure-ios.mjs) and
 * the App Privacy answers (docs/app-store/) — Apple compares all three.
 *
 * Plain text only: the renderers escape it, so no markup can leak in, and the
 * same words reach the sheet and the page character for character.
 */

export interface LegalItem {
  /** Bold lead-in of a list entry (a third party's name). */
  term: string
  text: string
}

export interface LegalSection {
  heading: string
  paragraphs?: string[]
  items?: LegalItem[]
}

export type LegalDocumentKind = 'privacy' | 'terms'

export interface LegalDocument {
  kind: LegalDocumentKind
  title: string
  /** Path of the static page, relative to the site root. */
  path: string
  sections: LegalSection[]
}

/** ISO date of the latest change to either document. Bump when the words change. */
export const LEGAL_UPDATED = '2026-09-21'

export const LEGAL_CONTACT_EMAIL = 'aaronschung@gmail.com'

export const PRIVACY_POLICY: LegalSection[] = [
  {
    heading: 'What Logbook collects',
    paragraphs: [
      'Logbook stores what you enter: exercises, sets, reps, weights, notes, tags, gyms, and bodyweight entries. Nothing is inferred from your device beyond that.',
      'If you create an account, Logbook stores your email address and an account ID to sign you in and sync your data. If you sign in with Google, Google shares your email address and Google account ID with Logbook; Logbook never sees your Google password.',
      'If you continue without an account, everything stays on your device and Logbook collects nothing at all.',
    ],
  },
  {
    heading: 'Where your data lives',
    paragraphs: [
      'Your data lives on your device first: browser storage in the web app, the app\'s own storage on iOS. If you sign in, it also syncs to Supabase, the cloud database behind Logbook, so you can use Logbook on more than one device. Data in transit is encrypted with HTTPS.',
      'Logbook does not sell your data, show ads, or use your data for advertising or tracking of any kind.',
    ],
  },
  {
    heading: 'Apple Health (iOS app)',
    paragraphs: [
      'Turning on Sync bodyweight in Settings lets the iOS app write the bodyweight entries you log to the Health app on your iPhone. Logbook asks only for permission to write weight. It reads back only the samples it wrote itself, to avoid adding one twice, and never reads any other Health data.',
      'Health data written this way is held by Apple Health on your device and in your iCloud Health account under Apple\'s terms. Logbook keeps no copy of your Health data on its servers beyond the bodyweight entries you already logged in Logbook, and never uses Health data for advertising or shares it with third parties.',
    ],
  },
  {
    heading: 'AI coach (optional)',
    paragraphs: [
      'The AI coach is off by default, and nothing is sent unless you use it. When you ask for a review, Logbook sends the training summary it shows you, which is your sets, reps, weights and personal records, derived volume and consistency figures, and your bodyweight unless you opt out, to Anthropic, the AI provider, through Logbook\'s own server to generate the review.',
      'Your name, email address and account identifiers are never included. The profile fields you may fill in, such as age and injuries, are included only when you copy or download a review yourself. Logbook records that you consented and logs each request for rate limiting. You can turn the coach off at any time.',
    ],
  },
  {
    heading: 'Crash reports and analytics',
    paragraphs: [
      'Logbook uses Sentry to collect crash reports so bugs can be fixed. Reports carry no personal data: IP addresses are removed and reports are not tied to your account.',
      'The web app uses Vercel Analytics for anonymous, aggregated page and feature usage with no personally identifiable information. The iOS app includes no analytics.',
    ],
  },
  {
    heading: 'Third-party services',
    items: [
      { term: 'Supabase', text: 'sign-in and cloud sync of your data' },
      { term: 'Vercel', text: 'hosting, and anonymous analytics on the web app' },
      { term: 'Sentry', text: 'crash reporting, with personal data removed' },
      { term: 'Anthropic', text: 'generating AI coach reviews, only when you use the coach' },
      { term: 'Apple Health', text: 'on your device, only if you turn on Sync bodyweight' },
      { term: 'Google', text: 'only if you choose to sign in with Google' },
    ],
  },
  {
    heading: 'Your data, your choice',
    paragraphs: [
      'Export everything as CSV or JSON at any time from Settings, under Data.',
      'Delete your account and every synced record from Settings, under Danger Zone, with Delete Account. This removes your data from Logbook\'s database and your sign-in immediately; there is nothing to request and no waiting period. Without an account, Delete All Data in the same place erases the device copy.',
    ],
  },
  {
    heading: 'Children',
    paragraphs: [
      'Logbook is not directed at children under 13, and Logbook does not knowingly collect personal data from them.',
    ],
  },
  {
    heading: 'Changes',
    paragraphs: [
      'This policy may change as Logbook changes. The date at the top reflects the latest revision.',
    ],
  },
  {
    heading: 'Contact',
    paragraphs: [`For privacy questions, email ${LEGAL_CONTACT_EMAIL}.`],
  },
]

export const TERMS_OF_SERVICE: LegalSection[] = [
  {
    heading: 'Acceptance',
    paragraphs: ['By using Logbook, on the web or as the iOS app, you agree to these terms. If you do not agree, please do not use Logbook.'],
  },
  {
    heading: 'Description',
    paragraphs: [
      'Logbook is a free workout tracking app provided as-is. Logbook makes no guarantees about uptime, data retention, or feature availability, and may change or discontinue features at any time.',
    ],
  },
  {
    heading: 'Your account and your data',
    paragraphs: [
      'You are responsible for keeping your account credentials secure and for what happens under your account. You retain ownership of everything you enter into Logbook, and you can export or delete it at any time from Settings.',
    ],
  },
  {
    heading: 'Acceptable use',
    paragraphs: ['Do not attempt to exploit, reverse-engineer, overload, or interfere with the operation of Logbook or its infrastructure.'],
  },
  {
    heading: 'Health disclaimer',
    paragraphs: [
      'Logbook, including its AI coach, is a tracking tool, not medical advice. Consult a medical professional before starting or changing an exercise program, and stop if something hurts.',
    ],
  },
  {
    heading: 'Limitation of liability',
    paragraphs: [
      'Logbook is provided "as is" without warranty of any kind. To the fullest extent permitted by law, Logbook and its author are not liable for any data loss, injury, or damages arising from use of the app.',
    ],
  },
  {
    heading: 'Changes',
    paragraphs: ['These terms may change. Continued use of Logbook after a change means you accept the updated terms. The date at the top reflects the latest revision.'],
  },
  {
    heading: 'Contact',
    paragraphs: [`For questions about these terms, email ${LEGAL_CONTACT_EMAIL}.`],
  },
]

export const LEGAL_DOCUMENTS: Record<LegalDocumentKind, LegalDocument> = {
  privacy: { kind: 'privacy', title: 'Privacy Policy', path: 'legal/privacy.html', sections: PRIVACY_POLICY },
  terms: { kind: 'terms', title: 'Terms of Service', path: 'legal/terms.html', sections: TERMS_OF_SERVICE },
}
