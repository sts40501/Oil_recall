const { getUser } = require('@netlify/identity');

/**
 * Netlify validates the bearer token before exposing the current Identity user.
 * A missing or expired token is deliberately indistinguishable from an invalid
 * login to callers, so this function never reveals account details.
 */
async function requireIdentityUser() {
  try {
    return await getUser();
  } catch (_) {
    return null;
  }
}

module.exports = { requireIdentityUser };
