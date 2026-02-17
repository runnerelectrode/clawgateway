const PROVIDER_ICONS = {
  okta: 'shield',
  workos: 'building',
  descope: 'key',
  twitter: 'bird'
};

const PROVIDER_COLORS = {
  okta: '#007dc1',
  workos: '#6363f1',
  descope: '#00b4d8',
  twitter: '#1da1f2'
};

const MARKETPLACE_PROVIDERS = new Set(['twitter']);

export function renderLoginPage(config, providers, error) {
  const mode = config.mode || 'enterprise';

  // All provider buttons (for enterprise / marketplace single-mode)
  const providerButtons = Object.values(providers).map(p => {
    const color = PROVIDER_COLORS[p.name] || '#333';
    return `<a href="/auth/${p.name}" class="btn" style="background:${color}">
      Sign in with ${p.displayName}
    </a>`;
  }).join('\n');

  // Profile cards for marketplace mode (uses all providers)
  const profileCards = mode === 'marketplace' && config.profiles
    ? Object.entries(config.profiles).map(([id, p]) =>
      `<div class="profile-card${p.default ? ' default' : ''}">
        <h3>${id.replace(/-/g, ' ')}</h3>
        <p>${p.description || ''}</p>
        ${Object.values(providers).map(prov =>
          `<a href="/auth/${prov.name}?profile=${encodeURIComponent(id)}" class="btn-sm" style="background:${PROVIDER_COLORS[prov.name] || '#333'}">
            ${prov.displayName}
          </a>`
        ).join(' ')}
      </div>`
    ).join('\n')
    : '';

  // Dual mode: split providers and build separate sections
  const ssoProviders = Object.values(providers).filter(p => !MARKETPLACE_PROVIDERS.has(p.name));
  const mktProviders = Object.values(providers).filter(p => MARKETPLACE_PROVIDERS.has(p.name));

  const enterpriseButtons = ssoProviders.map(p => {
    const color = PROVIDER_COLORS[p.name] || '#333';
    return `<a href="/auth/${p.name}" class="btn" style="background:${color}">
      Sign in with ${p.displayName}
    </a>`;
  }).join('\n');

  const marketerCards = mode === 'dual' && config.profiles
    ? Object.entries(config.profiles).map(([id, p]) =>
      `<div class="profile-card${p.default ? ' default' : ''}">
        <h3>${id.replace(/-/g, ' ')}</h3>
        <p>${p.description || ''}</p>
        ${mktProviders.map(prov =>
          `<a href="/auth/${prov.name}?profile=${encodeURIComponent(id)}" class="btn-sm" style="background:${PROVIDER_COLORS[prov.name] || '#333'}">
            ${prov.displayName}
          </a>`
        ).join(' ')}
      </div>`
    ).join('\n')
    : '';

  const errorHtml = error
    ? `<div class="error">${escapeHtml(error)}</div>`
    : '';

  const subtitle = mode === 'marketplace'
    ? 'Choose a profile to get started'
    : mode === 'dual'
      ? 'Choose how to sign in'
      : 'Sign in to continue';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ClawGateway - Sign In</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a0a;
      color: #e0e0e0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .container {
      max-width: 480px;
      width: 100%;
      padding: 2rem;
    }
    .logo {
      text-align: center;
      margin-bottom: 2rem;
    }
    .logo h1 {
      font-size: 1.5rem;
      font-weight: 600;
      color: #fff;
    }
    .logo p {
      color: #888;
      font-size: 0.875rem;
      margin-top: 0.5rem;
    }
    .btn {
      display: block;
      width: 100%;
      padding: 0.875rem 1.5rem;
      border: none;
      border-radius: 8px;
      color: #fff;
      font-size: 1rem;
      font-weight: 500;
      text-align: center;
      text-decoration: none;
      cursor: pointer;
      margin-bottom: 0.75rem;
      transition: opacity 0.15s;
    }
    .btn:hover { opacity: 0.9; }
    .btn-sm {
      display: inline-block;
      padding: 0.4rem 0.75rem;
      border-radius: 6px;
      color: #fff;
      font-size: 0.8rem;
      text-decoration: none;
      margin-top: 0.5rem;
      transition: opacity 0.15s;
    }
    .btn-sm:hover { opacity: 0.9; }
    .error {
      background: #2d1515;
      border: 1px solid #5c2020;
      color: #ff6b6b;
      padding: 0.75rem 1rem;
      border-radius: 8px;
      margin-bottom: 1rem;
      font-size: 0.875rem;
    }
    .profiles {
      margin-top: 1.5rem;
    }
    .profiles h2 {
      font-size: 1.125rem;
      margin-bottom: 1rem;
      color: #ccc;
    }
    .profile-card {
      background: #1a1a1a;
      border: 1px solid #333;
      border-radius: 10px;
      padding: 1.25rem;
      margin-bottom: 1rem;
    }
    .profile-card.default {
      border-color: #555;
    }
    .profile-card h3 {
      font-size: 1rem;
      text-transform: capitalize;
      margin-bottom: 0.25rem;
    }
    .profile-card p {
      color: #999;
      font-size: 0.85rem;
      margin-bottom: 0.5rem;
    }
    .divider {
      display: flex;
      align-items: center;
      margin: 1.5rem 0;
      color: #555;
      font-size: 0.8rem;
    }
    .divider::before, .divider::after {
      content: '';
      flex: 1;
      border-bottom: 1px solid #333;
    }
    .divider span { padding: 0 0.75rem; }
    .mode-tabs {
      display: flex;
      margin-bottom: 1.5rem;
      border-bottom: 1px solid #333;
    }
    .mode-tab {
      flex: 1;
      padding: 0.75rem;
      text-align: center;
      cursor: pointer;
      color: #888;
      font-size: 0.9rem;
      font-weight: 500;
      border-bottom: 2px solid transparent;
      transition: all 0.15s;
      user-select: none;
    }
    .mode-tab:hover { color: #e0e0e0; }
    .mode-tab.active {
      color: #fff;
      border-bottom-color: #58a6ff;
    }
    .mode-panel { display: none; }
    .mode-panel.active { display: block; }
    @media (prefers-color-scheme: light) {
      body { background: #fafafa; color: #222; }
      .logo h1 { color: #111; }
      .profile-card { background: #fff; border-color: #ddd; }
      .profile-card p { color: #666; }
      .error { background: #fff0f0; border-color: #ffcdd2; color: #c62828; }
      .mode-tab.active { color: #111; border-bottom-color: #0969da; }
      .mode-tab { color: #666; }
      .mode-tabs { border-bottom-color: #ddd; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">
      <h1>ClawGateway</h1>
      <p>${subtitle}</p>
    </div>
    ${errorHtml}
    ${mode === 'dual' ? `
      <div class="mode-tabs">
        <div class="mode-tab active" onclick="switchLoginTab('enterprise', this)">Enterprise</div>
        <div class="mode-tab" onclick="switchLoginTab('marketer', this)">Marketer</div>
      </div>
      <div class="mode-panel active" id="panel-enterprise">
        ${enterpriseButtons || '<p style="color:#666;text-align:center;">No enterprise providers configured</p>'}
      </div>
      <div class="mode-panel" id="panel-marketer">
        <div class="profiles">
          <h2>Choose a Profile</h2>
          ${marketerCards}
        </div>
      </div>
      <script>
        function switchLoginTab(tab, el) {
          document.querySelectorAll('.mode-tab').forEach(function(t) { t.classList.remove('active'); });
          document.querySelectorAll('.mode-panel').forEach(function(p) { p.classList.remove('active'); });
          el.classList.add('active');
          document.getElementById('panel-' + tab).classList.add('active');
        }
      </script>
    ` : ''}
    ${mode === 'enterprise' ? providerButtons : ''}
    ${mode === 'marketplace' && profileCards ? `
      <div class="profiles">
        <h2>Available Profiles</h2>
        ${profileCards}
      </div>
    ` : ''}
  </div>
</body>
</html>`;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
