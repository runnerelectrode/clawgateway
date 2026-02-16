import { httpsPost, httpsGet } from './http-util.mjs';

export function createDescopeProvider(config, callbackUrl) {
  const { clientId, clientSecret, roleMapping } = config;
  // Descope uses projectId as clientId
  const baseUrl = 'https://api.descope.com/oauth2/v1';

  return {
    name: 'descope',
    displayName: 'Descope',
    roleMapping,

    getAuthUrl(state) {
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: callbackUrl,
        response_type: 'code',
        scope: 'openid email profile',
        state
      });
      return `${baseUrl}/authorize?${params}`;
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
        `${baseUrl}/token`,
        tokenBody.toString(),
        { 'Content-Type': 'application/x-www-form-urlencoded' }
      );

      if (!tokenRes.access_token) {
        throw new Error(`Descope token exchange failed: ${JSON.stringify(tokenRes)}`);
      }

      // Fetch userinfo
      const userinfo = await httpsGet(
        `${baseUrl}/userinfo`,
        { Authorization: `Bearer ${tokenRes.access_token}` }
      );

      return {
        email: userinfo.email,
        name: userinfo.name || userinfo.email,
        groups: userinfo.groups || userinfo.roles || [],
        avatar: userinfo.picture || null
      };
    }
  };
}
