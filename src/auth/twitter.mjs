import { randomBytes, createHash } from 'node:crypto';
import { httpsPost, httpsGet } from './http-util.mjs';

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function generatePKCE() {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export function createTwitterProvider(config, callbackUrl) {
  const { clientId, clientSecret } = config;

  return {
    name: 'twitter',
    displayName: 'Twitter',
    roleMapping: null, // Twitter doesn't provide groups — used in marketplace mode

    getAuthUrl(state, pkceChallenge) {
      const params = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: callbackUrl,
        scope: 'users.read tweet.read',
        state,
        code_challenge: pkceChallenge,
        code_challenge_method: 'S256'
      });
      return `https://twitter.com/i/oauth2/authorize?${params}`;
    },

    async handleCallback(code, pkceVerifier) {
      // Exchange code for access token (Basic auth required)
      const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

      const tokenBody = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: callbackUrl,
        code_verifier: pkceVerifier
      });

      const tokenRes = await httpsPost(
        'https://api.twitter.com/2/oauth2/token',
        tokenBody.toString(),
        {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${credentials}`
        }
      );

      if (!tokenRes.access_token) {
        throw new Error(`Twitter token exchange failed: ${JSON.stringify(tokenRes)}`);
      }

      // Fetch user profile
      const userRes = await httpsGet(
        'https://api.twitter.com/2/users/me?user.fields=name,username,profile_image_url',
        { Authorization: `Bearer ${tokenRes.access_token}` }
      );

      const user = userRes.data;
      if (!user) {
        throw new Error(`Twitter user fetch failed: ${JSON.stringify(userRes)}`);
      }

      return {
        email: `@${user.username}`,
        name: user.name || user.username,
        groups: [],
        avatar: user.profile_image_url || null
      };
    }
  };
}
