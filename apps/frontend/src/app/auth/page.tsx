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
export default function AuthPage() {
  return <LoginPanel isConfigured={isAuthConfigured()} />;
}
