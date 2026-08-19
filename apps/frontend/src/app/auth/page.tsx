import { LoginPanel } from "@/components/auth/login-panel";
import { isAuthConfigured } from "@/lib/auth/auth0";

/**
 * `/auth` — the only page an unauthenticated visitor may see.
 *
 * A server component purely so it can read whether Auth0 is configured.
 * AUTH0_DOMAIN and its companions are server-side variables and must stay that
 * way: exposing them through NEXT_PUBLIC_* to answer this one question would
 * put configuration into every browser bundle. The answer travels as a single
 * boolean instead.
 */

/**
 * ── RENDERED PER REQUEST, NOT AT BUILD TIME ─────────────────────────────────
 * Without this, Next prerenders `/auth` during `next build` — the page uses no
 * dynamic API, so it looks perfectly cacheable — and freezes whatever
 * `isAuthConfigured()` answered on the BUILD machine into static HTML.
 *
 * In a container build there are no Auth0 variables: they are runtime
 * configuration, deliberately not build arguments, because two of them are
 * secrets. The prerender therefore answered "not configured", and the deployed
 * page told every visitor that signing in was not set up while the very same
 * container held a complete, working Auth0 configuration.
 *
 * `force-dynamic` makes the check happen on each request, where the environment
 * actually exists. The cost is one server render of a small page that is only
 * ever seen by visitors who are not signed in.
 * ────────────────────────────────────────────────────────────────────────────
 */
export const dynamic = "force-dynamic";

export default function AuthPage() {
  return <LoginPanel isConfigured={isAuthConfigured()} />;
}
