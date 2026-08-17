/**
 * What the guard attaches to a verified request.
 *
 * The subject only. It is enough to answer "who made this call" in a log, and
 * anything more would invite a service to make a decision from a claim rather
 * than from its own data — which is how an authorization system grows by
 * accident.
 */
declare global {
  namespace Express {
    interface Request {
      auth?: { subject: string | null };
    }
  }
}

export {};
