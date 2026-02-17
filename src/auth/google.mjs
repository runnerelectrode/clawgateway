import { httpsPost, httpsGet } from './http-util.mjs';

export function createGoogleProvider(config, callbackUrl) {
  const { clientId, clientSecret } = config;

  return {
    name: 'google',
    displayName: 'Google',
    roleMapping: config.roleMapping || null,

    getAuthUrl(state) {
      const params = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: callbackUrl,
        scope: 'openid email profile',
        state,
        access_type: 'online'
      });
      return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
    },

    async handleCallback(code) {
      // Exchange code for access token (POST body, no Basic auth header)
      const tokenBody = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: callbackUrl,
        client_id: clientId,
        client_secret: clientSecret
      });

      const tokenRes = await httpsPost(
        'https://oauth2.googleapis.com/token',
        tokenBody.toString(),
        { 'Content-Type': 'application/x-www-form-urlencoded' }
      );

      if (!tokenRes.access_token) {
        throw new Error(`Google token exchange failed: ${JSON.stringify(tokenRes)}`);
      }

      // Fetch user profile
      const userRes = await httpsGet(
        'https://www.googleapis.com/oauth2/v2/userinfo',
        { Authorization: `Bearer ${tokenRes.access_token}` }
      );

      if (!userRes.email) {
        throw new Error(`Google user fetch failed: ${JSON.stringify(userRes)}`);
      }

      // Derive org domain from hd claim (hosted domain for Google Workspace users)
      const groups = userRes.hd ? [userRes.hd] : [];

      return {
        email: userRes.email,
        name: userRes.name || userRes.email,
        groups,
        avatar: userRes.picture || null
      };
    }
  };
}
