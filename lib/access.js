const { createRemoteJWKSet, jwtVerify } = require('jose');

function createAccess({ teamDomain, audience, jwks, nodeEnv = process.env.NODE_ENV } = {}) {
  if (!teamDomain && !audience && nodeEnv !== 'production') return null;
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.cloudflareaccess\.com$/.test(teamDomain || '')) {
    throw new Error('ACCESS_TEAM_DOMAIN must be your team.cloudflareaccess.com hostname');
  }
  if (!/^[a-f0-9]{64}$/i.test(audience || '')) throw new Error('ACCESS_AUD must be the application AUD');
  const issuer = `https://${teamDomain}`;
  const keys = jwks ?? createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`), {
    timeoutDuration: 3000, cooldownDuration: 30_000, cacheMaxAge: 10 * 60 * 1000,
  });
  return async function access(req, res, next) {
    const deny = () => res.status(403).set('Cache-Control', 'no-store')
      .json({ error: 'Access authentication required.' });
    const token = req.headers['cf-access-jwt-assertion'];
    if (typeof token !== 'string' || !token || token.length > 16_384) return deny();
    try {
      const { payload } = await jwtVerify(token, keys, {
        issuer, audience, algorithms: ['RS256'],
        requiredClaims: ['exp', 'iat', 'sub', 'email', 'type'],
      });
      if (payload.type !== 'app' || typeof payload.sub !== 'string' || !payload.sub ||
          typeof payload.email !== 'string' || !payload.email.trim()) return deny();
    } catch {
      // Token errors and JWKS outages fail closed. Never log tokens or identities.
      return deny();
    }
    next();
  };
}

module.exports = { createAccess };
