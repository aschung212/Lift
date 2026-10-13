/**
 * Which top-level screen App.vue renders (LIFT-1546).
 *
 * App.vue used to make this choice inline in its template (`!user`, then
 * `showOnboarding`), which no test can reach: the component is impractical to
 * mount, so "which screen does a sign-in land on" was asserted nowhere. That is
 * how a sign-in on a device holding nothing of the user's came to show the
 * onboarding welcome to a returning lifter until the account's first read
 * landed. The decision lives here so a test can drive the real auth and
 * onboarding state through it, and App.vue binds the answer verbatim.
 */
export type AppScreen = 'splash' | 'auth' | 'onboarding' | 'app'

export interface AppScreenState {
  /** The cold-start splash is still up: useAuth's `loading`. */
  loading: boolean
  /** Someone is signed in, a guest included: useAuth's `user` is set. */
  signedIn: boolean
  /** A sign-in made on the auth screen is still waiting for its account: useAuth's `signingIn`. */
  signingIn: boolean
  /** No onboarding flag and no data on the device: useOnboarding's `showOnboarding`. */
  onboarding: boolean
}

export function appScreen({ loading, signedIn, signingIn, onboarding }: AppScreenState): AppScreen {
  if (loading) return 'splash'
  // A sign-in stays on the auth screen until its account can be shown. Before
  // that, on a device holding none of the user's data, `onboarding` is only a
  // guess that this is a new user.
  if (!signedIn || signingIn) return 'auth'
  return onboarding ? 'onboarding' : 'app'
}
