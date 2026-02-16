import { ALL_TOOLS, TOOL_PROFILES, AVAILABLE_MODELS } from '../profiles.mjs';

export function renderAdminPage(config, profileData, auditRecent, session) {
  const mode = config.mode || 'enterprise';
  const roles = mode === 'enterprise' ? config.roles : config.profiles;

  // --- Role cards with tools ---
  const roleCards = Object.entries(profileData).map(([name, data]) => {
    const toolCheckboxes = ALL_TOOLS.map(tool => {
      const checked = data.effectiveTools.includes(tool) ? 'checked' : '';
      return `<label class="tool-chip ${checked ? 'active' : ''}">
        <input type="checkbox" name="tools" value="${tool}" ${checked} data-role="${name}"> ${tool}
      </label>`;
    }).join('\n');

    const profileOptions = ['(default)', ...Object.keys(TOOL_PROFILES)].map(p => {
      const sel = data.toolProfile === p ? 'selected' : '';
      return `<option value="${p}" ${sel}>${p}</option>`;
    }).join('');

    const modelOptions = AVAILABLE_MODELS.map(m =>
      `<option value="${m.id}" ${data.model === m.id ? 'selected' : ''}>${m.name}</option>`
    ).join('');

    const apiKeyMasked = data.apiKey ? '••••••••' + data.apiKey.slice(-6) : '';

    return `
    <div class="role-card" data-role="${name}">
      <div class="role-header">
        <div class="role-header-left">
          <h3>${name}</h3>
          <span class="role-desc">${data.description || ''}</span>
        </div>
        <div class="role-header-right">
          <span class="instance-status ${data.instanceStatus || 'unknown'}">${data.instanceStatus || 'unknown'}</span>
          <span class="role-upstream">${data.upstream}</span>
        </div>
      </div>
      <div class="role-config">
        <div class="config-section">
          <h4>Gateway Token</h4>
          <div class="config-row">
            <span class="config-label">Auth Token</span>
            <div class="input-group">
              <input type="password" class="config-input" id="token-${name}"
                     value="${escapeHtml(data.token || '')}" readonly
                     style="background:#0d1117;cursor:not-allowed">
              <button class="btn-icon" onclick="toggleVis('token-${name}')" title="Show/hide">
                <span class="eye-icon">&#128065;</span>
              </button>
            </div>
          </div>
        </div>

        <div class="config-section">
          <h4>API Key</h4>
          <div class="config-row">
            <span class="config-label">Anthropic API Key</span>
            <div class="input-group">
              <input type="password" class="config-input" id="apikey-${name}"
                     placeholder="sk-ant-api03-..." value="${escapeHtml(data.apiKey || '')}"
                     autocomplete="off">
              <button class="btn-icon" onclick="toggleVis('apikey-${name}')" title="Show/hide">
                <span class="eye-icon">&#128065;</span>
              </button>
            </div>
          </div>
        </div>

        <div class="config-section">
          <h4>Model</h4>
          <div class="config-row">
            <span class="config-label">Primary Model</span>
            <select class="config-select" id="model-${name}">
              <option value="">(default)</option>
              ${modelOptions}
            </select>
          </div>
        </div>

        <div class="config-section">
          <h4>Tool Profile</h4>
          <div class="config-row">
            <span class="config-label">Base Profile</span>
            <select class="profile-select" id="profile-${name}">
              ${profileOptions}
            </select>
          </div>
          <div class="tools-grid" id="tools-${name}">
            ${toolCheckboxes}
          </div>
        </div>

        <div class="card-actions">
          <button class="btn-save" onclick="saveRole('${name}')">Save Configuration</button>
          <span class="save-status" id="status-${name}"></span>
        </div>
      </div>
    </div>`;
  }).join('\n');

  // --- SSO role mapping table ---
  const roleMappingRows = config.auth?.map(a => {
    if (!a.roleMapping) return '';
    return Object.entries(a.roleMapping).map(([group, role]) =>
      `<tr>
        <td><span class="provider-badge">${a.provider}</span></td>
        <td>${group}</td>
        <td><span class="badge ${role}">${role}</span></td>
      </tr>`
    ).join('');
  }).join('') || '';

  // --- Audit log rows ---
  const auditRows = (auditRecent || []).slice(0, 25).map(entry =>
    `<tr>
      <td class="ts">${entry.ts?.slice(11, 19) || ''}</td>
      <td>${escapeHtml(entry.user || '')}</td>
      <td><span class="action-badge ${entry.action}">${entry.action}</span></td>
      <td><span class="badge ${entry.role || ''}">${entry.role || ''}</span></td>
    </tr>`
  ).join('');

  // --- Setup commands ---
  const setupCommands = Object.entries(profileData).map(([name, data]) => {
    const port = data.upstream ? new URL(data.upstream).port : '18789';
    return `openclaw --profile ${name} gateway --port ${port}`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ClawGateway Admin</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a0a; color: #e0e0e0;
      min-height: 100vh;
    }
    .topbar {
      background: #111; border-bottom: 1px solid #222;
      padding: 0.75rem 2rem;
      display: flex; align-items: center; justify-content: space-between;
    }
    .topbar h1 { font-size: 1.1rem; font-weight: 600; }
    .topbar h1 span { color: #888; font-weight: 400; }
    .topbar-right { display: flex; align-items: center; gap: 1rem; }
    .topbar-right .user { color: #888; font-size: 0.85rem; }
    .topbar-right a { color: #58a6ff; text-decoration: none; font-size: 0.85rem; }

    .tabs {
      background: #111; border-bottom: 1px solid #222;
      padding: 0 2rem; display: flex; gap: 0;
    }
    .tab {
      padding: 0.75rem 1.25rem; font-size: 0.85rem; color: #888;
      cursor: pointer; border-bottom: 2px solid transparent;
      transition: all 0.15s;
    }
    .tab:hover { color: #e0e0e0; }
    .tab.active { color: #58a6ff; border-bottom-color: #58a6ff; }

    .container { max-width: 1100px; margin: 0 auto; padding: 2rem; }
    .tab-content { display: none; }
    .tab-content.active { display: block; }

    .section { margin-bottom: 2.5rem; }
    .section h2 {
      font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.08em;
      color: #666; margin-bottom: 1rem; padding-bottom: 0.5rem;
      border-bottom: 1px solid #1a1a1a;
    }
    .section p.hint {
      color: #666; font-size: 0.8rem; margin-bottom: 1rem;
    }
    .section p.hint code {
      color: #f0883e; background: #1a1a1a; padding: 0.1rem 0.3rem; border-radius: 3px;
    }

    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
    .stat-card {
      background: #111; border: 1px solid #222; border-radius: 10px;
      padding: 1.25rem; text-align: center;
    }
    .stat-card .num { font-size: 2rem; font-weight: 700; color: #fff; }
    .stat-card .label { color: #666; font-size: 0.8rem; margin-top: 0.25rem; }

    .role-card {
      background: #111; border: 1px solid #222; border-radius: 12px;
      margin-bottom: 1.25rem; overflow: hidden;
    }
    .role-header {
      padding: 1rem 1.25rem; display: flex; justify-content: space-between;
      align-items: center; border-bottom: 1px solid #1a1a1a;
    }
    .role-header h3 { font-size: 1.1rem; font-weight: 600; text-transform: capitalize; }
    .role-desc { color: #666; font-size: 0.8rem; }
    .role-header-right { display: flex; align-items: center; gap: 0.75rem; }
    .role-upstream {
      font-family: monospace; font-size: 0.8rem; color: #58a6ff;
      background: #0d1117; padding: 0.3rem 0.6rem; border-radius: 6px;
    }
    .instance-status {
      font-size: 0.7rem; font-weight: 600; text-transform: uppercase;
      padding: 0.2rem 0.5rem; border-radius: 10px;
    }
    .instance-status.running { background: #0d2818; color: #3fb950; }
    .instance-status.stopped { background: #2d1515; color: #ff7b72; }
    .instance-status.unknown { background: #1a1a1a; color: #666; }

    .role-config { padding: 1.25rem; }
    .config-section { margin-bottom: 1.25rem; padding-bottom: 1rem; border-bottom: 1px solid #1a1a1a; }
    .config-section:last-of-type { border-bottom: none; padding-bottom: 0; }
    .config-section h4 { font-size: 0.8rem; color: #888; margin-bottom: 0.75rem; font-weight: 500; }
    .config-row {
      display: flex; align-items: center; gap: 0.75rem;
      margin-bottom: 0.5rem; font-size: 0.85rem;
    }
    .config-label { color: #888; min-width: 140px; font-size: 0.8rem; }

    .config-input, .config-select {
      background: #1a1a1a; border: 1px solid #333; color: #e0e0e0;
      padding: 0.45rem 0.65rem; border-radius: 6px; font-size: 0.85rem;
      font-family: monospace; flex: 1; max-width: 400px;
    }
    .config-input:focus, .config-select:focus { border-color: #58a6ff; outline: none; }
    .config-select { font-family: inherit; }

    .input-group { display: flex; align-items: center; gap: 0.35rem; flex: 1; max-width: 420px; }
    .input-group .config-input { flex: 1; max-width: none; }
    .btn-icon {
      background: #1a1a1a; border: 1px solid #333; color: #888;
      padding: 0.35rem 0.5rem; border-radius: 6px; cursor: pointer;
      font-size: 0.9rem; line-height: 1;
    }
    .btn-icon:hover { border-color: #555; }

    .profile-select {
      background: #1a1a1a; border: 1px solid #333; color: #e0e0e0;
      padding: 0.35rem 0.5rem; border-radius: 6px; font-size: 0.85rem;
    }

    .tools-grid {
      display: flex; flex-wrap: wrap; gap: 0.4rem;
      margin-top: 0.5rem;
    }
    .tool-chip {
      display: inline-flex; align-items: center; gap: 0.3rem;
      padding: 0.3rem 0.6rem; border-radius: 6px;
      font-size: 0.75rem; cursor: pointer;
      background: #1a1a1a; border: 1px solid #333; color: #888;
      transition: all 0.15s; user-select: none;
    }
    .tool-chip.active { background: #0d2818; border-color: #238636; color: #3fb950; }
    .tool-chip input { display: none; }
    .tool-chip:hover { border-color: #555; }

    .card-actions {
      display: flex; align-items: center; gap: 1rem;
      padding-top: 1rem; border-top: 1px solid #1a1a1a; margin-top: 0.5rem;
    }
    .btn-save {
      background: #238636; color: #fff; border: none;
      padding: 0.55rem 1.5rem; border-radius: 8px;
      font-size: 0.85rem; font-weight: 500; cursor: pointer;
    }
    .btn-save:hover { background: #2ea043; }
    .btn-save:disabled { opacity: 0.5; cursor: not-allowed; }
    .save-status { font-size: 0.8rem; color: #3fb950; }

    .setup-box {
      background: #0d1117; border: 1px solid #222; border-radius: 10px;
      padding: 1.25rem; margin-bottom: 1rem;
    }
    .setup-box h4 { font-size: 0.9rem; margin-bottom: 0.75rem; }
    .setup-box pre {
      background: #161b22; border: 1px solid #30363d; border-radius: 8px;
      padding: 1rem; font-size: 0.8rem; color: #e6edf3;
      overflow-x: auto; line-height: 1.6; position: relative;
    }
    .setup-box .step { color: #8b949e; font-size: 0.8rem; margin-bottom: 0.5rem; }
    .copy-btn {
      position: absolute; top: 0.5rem; right: 0.5rem;
      background: #30363d; border: none; color: #8b949e;
      padding: 0.25rem 0.5rem; border-radius: 4px; cursor: pointer;
      font-size: 0.7rem;
    }
    .copy-btn:hover { color: #e6edf3; }

    table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    th { text-align: left; color: #666; font-size: 0.75rem; text-transform: uppercase;
         letter-spacing: 0.05em; padding: 0.5rem 0.75rem; border-bottom: 1px solid #222; }
    td { padding: 0.5rem 0.75rem; border-bottom: 1px solid #1a1a1a; }
    .ts { font-family: monospace; color: #666; font-size: 0.8rem; }

    .badge {
      display: inline-block; padding: 0.15rem 0.5rem; border-radius: 10px;
      font-size: 0.7rem; font-weight: 600; text-transform: uppercase;
    }
    .badge.viewer { background: #1f3d5c; color: #58a6ff; }
    .badge.member { background: #2d1f5e; color: #a78bfa; }
    .badge.admin { background: #5c1f1f; color: #ff7b72; }
    .provider-badge {
      display: inline-block; padding: 0.15rem 0.5rem; border-radius: 10px;
      font-size: 0.7rem; font-weight: 600; background: #1a1a2e; color: #818cf8;
    }
    .action-badge {
      display: inline-block; padding: 0.1rem 0.4rem; border-radius: 4px;
      font-size: 0.7rem; font-family: monospace;
    }
    .action-badge.login { background: #0d2818; color: #3fb950; }
    .action-badge.logout { background: #2d2d00; color: #d29922; }
    .action-badge.proxy { background: #1a1a2e; color: #818cf8; }
    .action-badge.ws_connect { background: #1f3d5c; color: #58a6ff; }
    .action-badge.admin_update_profile { background: #2d1f5e; color: #a78bfa; }

    .data-table { background: #111; border: 1px solid #222; border-radius: 10px; overflow: hidden; }
    .audit-table { max-height: 350px; overflow-y: auto; }

    @media (max-width: 768px) {
      .container { padding: 1rem; }
      .config-row { flex-direction: column; align-items: flex-start; gap: 0.35rem; }
      .config-label { min-width: auto; }
      .input-group, .config-input, .config-select { max-width: 100%; }
      .tabs { overflow-x: auto; }
      .stats { grid-template-columns: 1fr 1fr; }
    }
  </style>
</head>
<body>
  <div class="topbar">
    <h1>ClawGateway <span>Admin</span></h1>
    <div class="topbar-right">
      <span class="user">${escapeHtml(session.email)}</span>
      <a href="/">Studio</a>
    </div>
  </div>

  <div class="tabs">
    <div class="tab active" onclick="switchTab('instances')">Instances</div>
    <div class="tab" onclick="switchTab('sso')">SSO Mapping</div>
    <div class="tab" onclick="switchTab('setup')">Setup Guide</div>
    <div class="tab" onclick="switchTab('activity')">Activity Log</div>
  </div>

  <div class="container">
    <div class="stats">
      <div class="stat-card">
        <div class="num">${Object.keys(roles || {}).length}</div>
        <div class="label">${mode === 'enterprise' ? 'Roles' : 'Profiles'}</div>
      </div>
      <div class="stat-card">
        <div class="num">${config.auth?.length || 0}</div>
        <div class="label">SSO Providers</div>
      </div>
      <div class="stat-card">
        <div class="num">${(auditRecent || []).filter(e => e.action === 'login').length}</div>
        <div class="label">Recent Logins</div>
      </div>
      <div class="stat-card">
        <div class="num">${mode}</div>
        <div class="label">Mode</div>
      </div>
    </div>

    <!-- Tab: Instances -->
    <div class="tab-content active" id="tab-instances">
      <div class="section">
        <h2>Instances &amp; Configuration</h2>
        <p class="hint">
          Each role runs a separate OpenClaw instance with <code>--profile</code>.
          API keys, models, and tool permissions are written to <code>~/.openclaw/openclaw-{profile}.json</code> and hot-apply without restart.
        </p>
        ${roleCards}
      </div>
    </div>

    <!-- Tab: SSO Mapping -->
    <div class="tab-content" id="tab-sso">
      <div class="section">
        <h2>SSO Role Mapping</h2>
        <p class="hint">IDP groups map to gateway roles. Edit <code>gateway.json</code> to change mappings.</p>
        <div class="data-table">
          <table>
            <thead><tr><th>Provider</th><th>IDP Group</th><th>Assigned Role</th></tr></thead>
            <tbody>${roleMappingRows || '<tr><td colspan="3" style="color:#666;padding:1rem">No role mappings configured</td></tr>'}</tbody>
          </table>
        </div>
      </div>
      <div class="section">
        <h2>Admins</h2>
        <p class="hint">Users in this list can access <code>/admin</code>. Add <code>"admins": ["email@example.com"]</code> to gateway.json.</p>
        <p style="color:#ccc;font-size:0.9rem;">${(config.admins || []).map(e => `<span class="badge admin">${escapeHtml(e)}</span>`).join(' ') || '<em style="color:#666">None configured</em>'}</p>
      </div>
    </div>

    <!-- Tab: Setup Guide -->
    <div class="tab-content" id="tab-setup">
      <div class="section">
        <h2>Quick Setup</h2>

        <div class="setup-box">
          <div class="step">Step 1: Start OpenClaw instances (one per role)</div>
          <pre><code id="setup-cmd-1">${escapeHtml(setupCommands)}</code><button class="copy-btn" onclick="copyText('setup-cmd-1')">Copy</button></pre>
        </div>

        <div class="setup-box">
          <div class="step">Step 2: Start OpenClaw Studio</div>
          <pre><code id="setup-cmd-2">npx openclaw-studio@latest</code><button class="copy-btn" onclick="copyText('setup-cmd-2')">Copy</button></pre>
        </div>

        <div class="setup-box">
          <div class="step">Step 3: Start ClawGateway</div>
          <pre><code id="setup-cmd-3">npx clawgateway --config ./gateway.json</code><button class="copy-btn" onclick="copyText('setup-cmd-3')">Copy</button></pre>
        </div>

        <div class="setup-box">
          <div class="step">Step 4: Configure API keys above, then share the gateway URL with your team</div>
          <pre><code id="setup-cmd-4">http://localhost:${config.port || 8422}</code><button class="copy-btn" onclick="copyText('setup-cmd-4')">Copy</button></pre>
        </div>
      </div>
    </div>

    <!-- Tab: Activity Log -->
    <div class="tab-content" id="tab-activity">
      <div class="section">
        <h2>Recent Activity</h2>
        <div class="data-table audit-table">
          <table>
            <thead><tr><th>Time</th><th>User</th><th>Action</th><th>Role</th></tr></thead>
            <tbody>${auditRows || '<tr><td colspan="4" style="color:#666;padding:1rem">No activity yet</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    </div>
  </div>

  <script>
    // Tab switching
    function switchTab(name) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      document.querySelector('.tab-content#tab-' + name)?.classList.add('active');
      event.target.classList.add('active');
    }

    // Tool chip toggle
    document.querySelectorAll('.tool-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const cb = chip.querySelector('input');
        cb.checked = !cb.checked;
        chip.classList.toggle('active', cb.checked);
      });
    });

    // Toggle password visibility
    function toggleVis(id) {
      const el = document.getElementById(id);
      el.type = el.type === 'password' ? 'text' : 'password';
    }

    // Copy text
    function copyText(id) {
      const text = document.getElementById(id).textContent;
      navigator.clipboard.writeText(text);
      const btn = document.getElementById(id).parentElement.querySelector('.copy-btn');
      btn.textContent = 'Copied!';
      setTimeout(() => btn.textContent = 'Copy', 2000);
    }

    // Save role config (API key + model + tools → writes to OpenClaw profile config)
    async function saveRole(role) {
      const statusEl = document.getElementById('status-' + role);
      const btn = statusEl.previousElementSibling;
      btn.disabled = true;
      statusEl.textContent = 'Saving...';
      statusEl.style.color = '#d29922';

      const apiKey = document.getElementById('apikey-' + role)?.value || '';
      const model = document.getElementById('model-' + role)?.value || '';
      const profileSelect = document.getElementById('profile-' + role);
      const profile = profileSelect?.value;
      const grid = document.getElementById('tools-' + role);
      const allow = [...grid.querySelectorAll('input:checked')].map(cb => cb.value);
      const deny = [...grid.querySelectorAll('input:not(:checked)')].map(cb => cb.value);

      try {
        const res = await fetch('/admin/api/profiles/' + role, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            apiKey: apiKey || undefined,
            model: model || undefined,
            profile: profile === '(default)' ? undefined : profile,
            allow,
            deny
          })
        });
        const data = await res.json();
        if (data.ok) {
          statusEl.textContent = 'Saved — hot-applied to OpenClaw';
          statusEl.style.color = '#3fb950';
        } else {
          statusEl.textContent = 'Error: ' + (data.error || 'Unknown');
          statusEl.style.color = '#ff7b72';
        }
      } catch (err) {
        statusEl.textContent = 'Error: ' + err.message;
        statusEl.style.color = '#ff7b72';
      }
      btn.disabled = false;
      setTimeout(() => { statusEl.textContent = ''; }, 4000);
    }
  </script>
</body>
</html>`;
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
