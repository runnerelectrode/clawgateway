import { httpsPost } from './http-util.mjs';

export function createWorkosProvider(config, callbackUrl) {
  const { clientId, clientSecret, organizationId, connectionId, roleMapping } = config;

  return {
    name: 'workos',
    displayName: 'WorkOS',
    roleMapping,

    getAuthUrl(state) {
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: callbackUrl,
        response_type: 'code',
        state
      });
      if (organizationId) params.set('organization', organizationId);
      if (connectionId) params.set('connection', connectionId);
      return `https://api.workos.com/sso/authorize?${params}`;
    },

    async handleCallback(code) {
      const tokenRes = await httpsPost(
        'https://api.workos.com/sso/token',
        JSON.stringify({
          grant_type: 'authorization_code',
          code,
          client_id: clientId,
          client_secret: clientSecret
        }),
        { 'Content-Type': 'application/json' }
      );

      const profile = tokenRes.profile;
      if (!profile) {
        throw new Error(`WorkOS token exchange failed: ${JSON.stringify(tokenRes)}`);
      }

      return {
        email: profile.email,
        name: `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || profile.email,
        groups: profile.groups || [],
        avatar: null
      };
    }
  };
}
