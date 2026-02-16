import { httpsPost, httpsGet } from './http-util.mjs';

export function createOktaProvider(config, callbackUrl) {
  const { issuer, clientId, clientSecret, roleMapping } = config;

  return {
    name: 'okta',
    displayName: 'Okta',
    roleMapping,

    getAuthUrl(state) {
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: callbackUrl,
        response_type: 'code',
        scope: 'openid email profile groups',
        state
      });
      return `${issuer}/v1/authorize?${params}`;
    },

    async handleCallback(code) {
      // Exchange code for tokens
      const tokenBody = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: callbackUrl,
        client_id: clientId,
        client_secret: clientSecret
      });

      const tokenRes = await httpsPost(
        `${issuer}/v1/token`,
        tokenBody.toString(),
        { 'Content-Type': 'application/x-www-form-urlencoded' }
      );

      if (!tokenRes.access_token) {
        throw new Error(`Okta token exchange failed: ${JSON.stringify(tokenRes)}`);
      }

      // Fetch userinfo
      const userinfo = await httpsGet(
        `${issuer}/v1/userinfo`,
        { Authorization: `Bearer ${tokenRes.access_token}` }
      );

      return {
        email: userinfo.email,
        name: userinfo.name || userinfo.email,
        groups: userinfo.groups || [],
        avatar: userinfo.picture || null
      };
    }
  };
}
