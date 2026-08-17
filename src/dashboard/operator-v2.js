(function () {
  'use strict';

  var S = {
    screen: sessionStorage.getItem('clawo-screen') || 'autoloop',
    connection: 'connecting',
    failures: 0,
    lastSync: null,
    runs: [],
    runId: sessionStorage.getItem('clawo-run'),
    run: null,
    history: null,
    chat: [],
    pushes: [],
    stream: null,
    retry: null,
    expanded: {},
    registry: null,
    modelId: sessionStorage.getItem('clawo-model'),
    provider: 'all',
    query: '',
    sort: 'name',
    patched: false,
    hideGated: false,
    sessions: [],
    sessionId: sessionStorage.getItem('clawo-session'),
    sessionFilter: 'All',
    sessionHistory: [],
    sessionStream: null,
    sessionStreaming: false,
    sessionLiveText: '',
    sessionTail: true,
    sessionWrap: true,
    sessionMode: 'Prompt',
    sessionDraft: '',
    sessionLastInput: '',
    councils: [],
    councilId: sessionStorage.getItem('clawo-council'),
    council: null,
    councilRound: null,
    councilStream: null,
    councilDrafting: {},
    limits: null,
    forge: [],
    forgeId: sessionStorage.getItem('clawo-forge'),
    forgeDetail: null,
    forgeArtifacts: [],
    forgeStage: null,
    forgeEvents: [],
    forgeStream: null,
    toastTimer: null
  };

  var screen = document.getElementById('screen');
  var app = document.getElementById('app');
  var toastNode = document.getElementById('toast');
  var dialogRoot = document.getElementById('dialogRoot');
  var connectionLabel = document.getElementById('connectionLabel');

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function attr(value) { return esc(value).replace(/\r?\n/g, ' '); }
  function api(url, options) {
    return fetch(url, options || {}).then(async function (response) {
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok || data.ok === false) throw new Error(data.error || 'HTTP ' + response.status);
      return data;
    });
  }
  function post(url, body) {
    return api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  }
  function toast(message) {
    clearTimeout(S.toastTimer);
    toastNode.textContent = message;
    toastNode.hidden = false;
    S.toastTimer = setTimeout(function () { toastNode.hidden = true; }, 2600);
  }
  function setConnection(value) {
    S.connection = value;
    app.dataset.connection = value;
    connectionLabel.textContent = value === 'online' ? 'Control plane online' : value === 'degraded' ? 'Reconnecting…' : value === 'offline' ? 'Control plane offline' : 'Connecting';
    screen.classList.toggle('om-stale', value === 'degraded' || value === 'offline');
    screen.dataset.staleLabel = value === 'degraded' ? 'reconnecting… · last updated ' + relative(S.lastSync) : value === 'offline' ? 'offline · last updated ' + relative(S.lastSync) : '';
    document.querySelectorAll('[data-mutation]').forEach(function (button) { button.disabled = value === 'offline'; });
  }
  function formatDuration(ms) {
    if (ms == null || !Number.isFinite(Number(ms))) return '— not reported';
    var seconds = Math.max(0, Math.round(Number(ms) / 1000));
    if (seconds < 60) return seconds + 's';
    var minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + 'm ' + String(seconds % 60).padStart(2, '0') + 's';
    return Math.floor(minutes / 60) + 'h ' + String(minutes % 60).padStart(2, '0') + 'm';
  }
  function elapsed(value) { return value ? formatDuration(Date.now() - new Date(value).getTime()) : '— not reported'; }
  function relative(value) {
    if (!value) return '— not reported';
    var seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
    if (seconds < 5) return 'now';
    if (seconds < 60) return seconds + 's ago';
    if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
    if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
    return Math.floor(seconds / 86400) + 'd ago';
  }
  function clock(value) {
    if (!value) return '—';
    try { return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
    catch (_) { return '—'; }
  }
  function compact(value) {
    var n = Number(value);
    if (!Number.isFinite(n)) return '—';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'm';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return String(n);
  }
  function titleCase(value) { return String(value || '').replaceAll('_', ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); }); }
  function renderLoading() {
    screen.innerHTML = '<section class="om-loading-shell" aria-label="Loading"><div class="om-skeleton om-skeleton-hero"></div><div class="om-skeleton-grid"><div class="om-skeleton"></div><div class="om-skeleton"></div><div class="om-skeleton"></div></div></section>';
  }
  function panelError(message) {
    return '<div class="om-error"><strong>' + esc(message) + '</strong><button class="om-btn om-btn-secondary" data-action="retry">Retry</button></div>';
  }
  function chip(status) {
    var tone = status === 'working' || status === 'running' ? 'live' : status === 'done' || status === 'passed' || status === 'idle' ? 'healthy' : status === 'error' || status === 'rejected' || status === 'paused' ? 'warn' : '';
    return '<span class="om-chip" data-tone="' + tone + '">' + esc(titleCase(status)) + '</span>';
  }
  function hero(config) {
    var stats = (config.stats || []).map(function (stat) {
      return '<div class="om-stat" data-tone="' + esc(stat.tone || '') + '"><label>' + esc(stat.label) + '</label><strong>' + esc(stat.value) + '</strong></div>';
    }).join('');
    return '<header class="om-hero"><div class="om-hero-inner"><div class="om-hero-copy"><div class="om-kicker"><span>' + esc(config.kicker) + '</span><span class="slash">/</span><span class="om-live-pill" data-live="' + String(config.live) + '"><i></i>' + esc(config.status) + '</span><span class="om-hero-summary">' + (config.summaryHtml || esc(config.summary)) + '</span></div><h1>' + esc(config.title) + '</h1><div class="' + (config.path ? 'om-hero-path om-mono' : 'om-hero-description') + '" title="' + attr(config.description) + '">' + esc(config.description) + '</div></div><div class="om-hero-side"><div class="om-hero-actions">' + (config.actions || '') + '</div><div class="om-hero-stats">' + stats + '</div></div></div></header>';
  }
  function markdown(value) {
    var safe = esc(value || '');
    safe = safe.replace(/^###\s+(.+)$/gm, '<h4>$1</h4>').replace(/^##\s+(.+)$/gm, '<h3>$1</h3>');
    safe = safe.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    return safe.split(/\n{2,}/).map(function (block) {
      return /^<h[34]>/.test(block) ? block : '<p>' + block.replace(/\n/g, '<br>') + '</p>';
    }).join('');
  }
  function closeDialog() { dialogRoot.hidden = true; dialogRoot.replaceChildren(); }
  function openDialog(title, description, body, submit) {
    dialogRoot.innerHTML = '<form class="om-dialog-card" id="omDialog"><div><h3>' + esc(title) + '</h3><p>' + esc(description) + '</p></div>' + body + '<div class="om-dialog-actions"><button class="om-btn om-btn-primary" type="submit">Continue</button><button class="om-btn om-btn-ghost" id="dialogCancel" type="button">Cancel</button></div></form>';
    dialogRoot.hidden = false;
    dialogRoot.onclick = function (event) { if (event.target === dialogRoot) closeDialog(); };
    document.getElementById('dialogCancel').onclick = closeDialog;
    document.getElementById('omDialog').onsubmit = async function (event) {
      event.preventDefault();
      event.submitter.disabled = true;
      try { await submit(new FormData(event.currentTarget)); }
      catch (error) { toast(error.message); event.submitter.disabled = false; }
    };
    var first = dialogRoot.querySelector('input,textarea,select');
    if (first) first.focus();
  }

  function roleCard(run, role, label, index) {
    var activity = run.role_activity && run.role_activity[role] ? run.role_activity[role] : {};
    var usage = activity.usage || null;
    var engine = run[role + '_engine'];
    var context = usage && engine !== 'agy' && Number.isFinite(Number(usage.contextPercent)) ? Number(usage.contextPercent) : null;
    var tokens = usage && engine !== 'agy' ? Number(usage.tokensIn || 0) + Number(usage.tokensOut || 0) : null;
    var status = activity.status || 'waiting';
    return '<article class="om-role-card" data-state="' + esc(status) + '" style="animation-delay:' + index * .04 + 's"><div class="om-dial" style="--pct:' + (context == null ? 0 : Math.max(0, Math.min(100, context))) + ';--dial-color:' + (status === 'working' ? 'var(--color-accent-500)' : 'var(--color-accent-2-500)') + '"><span>' + (context == null ? '—' : Math.round(context) + '%') + '</span></div><div class="om-role-body"><div class="om-role-top"><span class="om-role-name">' + esc(label) + '</span>' + chip(status) + '</div><div class="om-role-model om-mono" title="' + attr(run[role + '_model'] || '') + '">' + esc(run[role + '_model'] || '— not reported') + '</div><div class="om-role-meta">' + esc((usage ? usage.turns + ' turns' : '— turns') + ' · ' + (tokens == null ? '— tokens not reported' : compact(tokens) + ' tokens') + ' · ' + (activity.detail || '— not reported')) + '</div></div></article>';
  }
  function optionList() {
    for (var i = S.chat.length - 1; i >= 0; i--) {
      var entry = S.chat[i];
      if (entry.who !== 'planner') continue;
      var options = [];
      String(entry.text || '').split(/\r?\n/).forEach(function (line) {
        var match = line.match(/^\s*\*{0,2}([A-Z])\.\s+(.+?)\*{0,2}\s*$/);
        if (match) options.push({ key: match[1], text: match[2].replace(/\*\*/g, '').trim() });
      });
      if (options.length >= 2) return options;
    }
    return [];
  }
  function stepView(step) {
    return '<section class="om-step" data-role="' + esc(step.role) + '"><div class="om-step-head"><span class="om-step-avatar">' + esc(step.role.charAt(0).toUpperCase()) + '</span><div class="om-step-title"><label>' + esc(step.role) + '</label><strong title="' + attr(step.headline) + '">' + esc(step.headline) + '</strong></div>' + chip(step.status) + '<span class="om-mono" title="' + attr(step.model || '') + '">' + esc(step.model || '— not reported') + '</span><span class="om-step-duration">' + esc(formatDuration(step.durationMs)) + '</span></div>' + (step.content ? '<div class="om-step-content">' + (step.contentKind === 'markdown' ? markdown(step.content) : esc(step.content)) + '</div>' : '') + '</section>';
  }
  function iterationCard(item, newest) {
    var expanded = S.expanded[item.iteration];
    if (expanded == null) expanded = newest;
    var durations = item.steps.map(function (step) { return step.durationMs || 0; });
    var max = Math.max.apply(Math, durations.concat([1]));
    var bars = durations.map(function (value) { return '<i style="height:' + Math.max(4, Math.round(value / max * 24)) + 'px"></i>'; }).join('');
    return '<article class="om-iteration" data-outcome="' + esc(item.outcome) + '" data-expanded="' + String(expanded) + '"><button class="om-iteration-header" data-action="toggle-iteration" data-iteration="' + item.iteration + '" aria-expanded="' + String(expanded) + '"><span class="om-iter-number">' + (item.iteration + 1) + '</span><span class="om-iter-copy"><strong title="' + attr(item.headline) + '">' + esc(item.headline) + '</strong><small>' + esc((item.startedAt ? 'started ' + clock(item.startedAt) : 'start not reported') + ' · ' + item.steps.length + ' steps') + '</small></span><span class="om-spark" title="Real step durations">' + bars + '</span>' + chip(item.outcome) + '<span class="om-step-duration">' + esc(formatDuration(item.durationMs)) + '</span><svg class="om-chevron" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"></path></svg></button>' + (expanded ? '<div class="om-iteration-body">' + item.steps.map(stepView).join('') + '</div>' : '') + '</article>';
  }

  function renderAutoloop() {
    var run = S.run;
    if (!run) {
      screen.innerHTML = '<section class="om-screen">' + hero({ kicker: 'Autoloops', status: 'No run selected', live: false, summary: S.runs.length + ' runs', title: 'Autoloops', description: 'Watch a running autoloop and unblock it.', actions: '<button class="om-btn om-btn-primary" data-action="new-run">New run</button>' }) + '<div class="om-workspace"><div class="om-empty"><strong>No run is available.</strong><span>Create a run against a real workspace.</span></div></div></section>';
      bindCommon();
      return;
    }
    var items = S.history ? S.history.iterations || [] : [];
    var totals = S.history ? S.history.totals : { rejected: 0, passingTests: null };
    var live = run.status === 'running' || run.status === 'planning';
    var actions = '<button class="om-btn om-btn-hero" data-action="toggle-run" data-mutation>' + (run.status === 'paused' || run.status === 'terminated' ? 'Resume' : 'Pause loop') + '</button><button class="om-btn om-btn-primary" data-action="new-run" data-mutation>New run</button>';
    var timeline = items.length ? '<div class="om-timeline">' + items.map(function (item, index) {
      return '<div class="om-timeline-node" data-outcome="' + esc(item.outcome) + '"><i>' + (item.iteration + 1) + '</i><span>' + esc(item.outcome) + '</span></div>' + (index < items.length - 1 ? '<span class="om-timeline-line"></span>' : '');
    }).join('') + '</div>' : '<div class="om-empty">No iteration artifacts have been written.</div>';
    var newest = items.length ? items[items.length - 1].iteration : -1;
    var cards = items.slice().reverse().map(function (item) { return iterationCard(item, item.iteration === newest); }).join('');
    var warnings = items.flatMap(function (item) { return item.warnings || []; }).slice(-12).reverse();
    var warningHtml = warnings.length ? warnings.map(function (warning) {
      return '<div class="om-warning"><i class="om-dot" data-state="waiting"></i><span class="om-mono">' + esc(clock(warning.timestamp)) + '</span><span title="' + attr(warning.detail) + '">' + esc(warning.code + ' · iter ' + warning.iteration) + '</span></div>';
    }).join('') : '<div class="om-empty">No warnings recorded in verdict artifacts.</div>';
    var reasons = Array.from(new Set(warnings.map(function (warning) { return warning.code; }))).slice(0, 6).map(function (reason) {
      return '<span class="om-chip" data-tone="warn">' + esc(reason.replaceAll('_', ' ')) + '</span>';
    }).join('');
    var options = optionList();
    var optionsHtml = options.length ? '<div class="om-options">' + options.map(function (option, index) {
      return '<button class="om-btn ' + (index === 0 ? 'om-btn-primary' : 'om-btn-secondary') + '" data-action="choose-option" data-option="' + attr(option.key + '. ' + option.text) + '">' + esc(option.text) + '</button>';
    }).join('') + '<small>or type a directive in the panel →</small></div>' : '';
    if (optionsHtml && cards) cards = cards.replace('</div></article>', optionsHtml + '</div></article>');
    screen.innerHTML = '<section class="om-screen">' + hero({
      kicker: 'Autoloops', status: titleCase(run.status), live: live,
      summary: '',
      summaryHtml: 'iteration ' + esc(run.iter) + ' · <span data-elapsed="' + attr(run.started_at) + '">' + esc(elapsed(run.started_at)) + '</span> elapsed · last activity <span data-relative="' + attr(typeof run.last_activity_at === 'number' ? new Date(run.last_activity_at).toISOString() : run.last_activity_at) + '">' + esc(relative(run.last_activity_at)) + '</span>',
      title: run.run_id, description: run.workspace, path: true, actions: actions,
      stats: [
        { label: 'Pushes', value: run.push_log_count || 0 },
        { label: 'Rejections', value: totals.rejected || 0, tone: totals.rejected ? 'warn' : '' },
        { label: 'Tests green', value: totals.passingTests == null ? '—' : totals.passingTests, tone: totals.passingTests == null ? '' : 'healthy' }
      ]
    }) + '<div class="om-live-strip"><div class="om-strip-title"><span>Live now</span><span>' + esc(S.connection === 'online' ? 'control plane synced ' + relative(S.lastSync) : 'last updated ' + relative(S.lastSync)) + '</span></div><div class="om-role-grid">' +
      roleCard(run, 'planner', 'Orchestrator', 1) + roleCard(run, 'coder', 'Coder', 2) + roleCard(run, 'reviewer', 'Reviewer', 3) +
      '</div></div><div class="om-autoloop-layout"><section class="om-iterations"><div class="om-iterations-head"><h3>Iterations</h3><small>planner → coder → reviewer</small><button class="om-btn om-btn-ghost" data-action="collapse-all">Collapse all</button></div>' + timeline + (cards || '<div class="om-empty">No completed or open iterations are available.</div>') +
      '</section><aside class="om-autoloop-rail"><div class="om-autoloop-rail-scroll"><div><div class="om-section-label">Loop health</div><div class="om-panel om-health-card"><div class="om-health-row"><div class="om-dial" style="--pct:' + (items.length ? Math.round((totals.rejected || 0) / items.length * 100) : 0) + ';--dial-color:var(--color-accent)"><span>' + esc((totals.rejected || 0) + '/' + items.length) + '</span></div><p>' + esc(items.length ? (totals.rejected || 0) + ' rejected of ' + items.length + ' recorded iterations.' : 'No completed verdicts yet.') + '</p></div><div class="om-reason-tags">' + reasons + '</div></div></div><div><div class="om-section-label">Warnings</div><div class="om-warning-list">' + warningHtml +
      '</div></div></div><form class="om-directive" id="directiveForm"><div class="om-directive-head"><span class="om-section-label">Directive</span>' + chip(run.role_activity && run.role_activity.planner ? run.role_activity.planner.status : 'waiting') + '</div><textarea class="om-textarea" id="directiveInput" placeholder="Message the orchestrator…"></textarea><div class="om-directive-actions"><button class="om-btn om-btn-primary" type="submit" data-mutation>Send directive</button><button class="om-btn om-btn-secondary" type="button" disabled title="No safe diff attachment endpoint exists">Attach diff</button></div></form></aside></div></section>';
    bindAutoloop();
  }

  function providerName(value) { return value === 'anthropic' ? 'Claude' : value === 'openai' ? 'Codex' : value === 'google' ? 'Gemini' : titleCase(value); }
  function providerMark(value) { return value === 'anthropic' ? 'C' : value === 'openai' ? 'X' : value === 'google' ? 'G' : value.charAt(0).toUpperCase(); }
  function contextLabel(value) { return value == null ? '— not reported' : value >= 1000000 ? (value / 1000000).toFixed(value % 1000000 ? 1 : 0) + 'm' : Math.round(value / 1000) + 'k'; }
  function quotaLabel(model) {
    if (!model.quota || model.quota.status !== 'ok') return '— not reported';
    var five = model.quota.windows.find(function (window) { return window.id === 'five-hour' || /five hour/i.test(window.label); });
    var weekly = model.quota.windows.find(function (window) { return window.id === 'weekly' || window.id === 'weekly-all' || /weekly/i.test(window.label); });
    var chosen = five || weekly;
    return chosen ? chosen.label + ' ' + chosen.remainingPercent + '% remaining' : '— not reported';
  }
  function filteredModels() {
    if (!S.registry) return [];
    var query = S.query.trim().toLowerCase();
    var models = S.registry.models.filter(function (model) {
      if (S.provider !== 'all' && model.provider !== S.provider) return false;
      if (S.patched && !model.patched) return false;
      if (S.hideGated && model.quotaGated) return false;
      return !query || [model.id, model.label || '', (model.aliases || []).join(' ')].join(' ').toLowerCase().includes(query);
    });
    if (S.sort === 'name') models.sort(function (a, b) { return a.id.localeCompare(b.id); });
    else if (S.sort === 'recent') models.sort(function (a, b) { return String(b.lastUsed || '').localeCompare(String(a.lastUsed || '')); });
    else models.sort(function (a, b) { return Number(b.contextWindow || 0) - Number(a.contextWindow || 0); });
    return models;
  }
  function modelCard(model, index) {
    return '<button class="om-model-card" data-action="select-model" data-model="' + attr(model.id) + '" aria-selected="' + String(model.id === S.modelId) + '" style="animation-delay:' + Math.min(index, 7) * .035 + 's"><div class="om-model-top"><span class="om-model-avatar" data-provider="' + esc(model.provider) + '">' + providerMark(model.provider) + '</span><span class="om-model-id om-mono" title="' + attr(model.id) + '">' + esc(model.id) + '</span>' + (model.patched ? '<span class="om-chip om-patched" data-tone="warn">patched</span>' : '') + '</div><div class="om-model-meta"><span class="om-mono">' + esc(model.binary || '—') + '</span><span>' + esc(contextLabel(model.contextWindow)) + ' ctx</span><span>' + esc(quotaLabel(model)) + '</span></div><div class="om-model-actions"><span class="om-chip" data-action="copy-model" data-model="' + attr(model.id) + '">Copy id</span><time>' + esc(model.lastUsed ? relative(model.lastUsed) : 'never used in this process') + '</time></div></button>';
  }

  function renderModels() {
    if (!S.registry) {
      screen.innerHTML = '<section class="om-screen">' + hero({ kicker: 'System', status: 'Unavailable', live: false, summary: 'No registry snapshot', title: 'Models', description: 'Every identifier Claw knows how to route.' }) + '<div class="om-workspace">' + panelError('The compiled model registry could not be read.') + '</div></section>';
      bindCommon();
      return;
    }
    var models = filteredModels();
    var selected = S.registry.models.find(function (model) { return model.id === S.modelId; }) || models[0] || S.registry.models[0];
    if (selected && selected.id !== S.modelId) { S.modelId = selected.id; sessionStorage.setItem('clawo-model', selected.id); }
    var providers = Array.from(new Set(S.registry.models.map(function (model) { return model.provider; })));
    var providerRows = [{ id: 'all', label: 'All providers', count: S.registry.models.length }].concat(providers.map(function (provider) {
      return { id: provider, label: providerName(provider), count: S.registry.models.filter(function (model) { return model.provider === provider; }).length };
    })).map(function (provider) {
      return '<button class="om-provider-row" data-action="provider" data-provider="' + attr(provider.id) + '" aria-pressed="' + String(S.provider === provider.id) + '"><i class="om-dot" data-state="' + (provider.id === 'all' ? 'waiting' : 'idle') + '"></i><strong>' + esc(provider.label) + '</strong><small>' + provider.count + '</small></button>';
    }).join('');
    var aliases = selected ? (selected.aliases || []).map(function (alias) { return '<span class="om-chip om-mono">' + esc(alias) + '</span>'; }).join('') : '';
    var roles = selected ? (selected.roles || []).map(function (role) { return '<span class="om-chip" data-tone="healthy">' + esc(role.role + ' · ' + role.runId) + '</span>'; }).join('') : '';
    var detail = selected ? '<section class="om-panel om-model-detail"><div class="om-model-detail-head"><div class="om-model-top"><span class="om-model-avatar" data-provider="' + esc(selected.provider) + '">' + providerMark(selected.provider) + '</span><div><span class="om-section-label">' + esc(providerName(selected.provider)) + '</span><h4>' + esc(selected.label || selected.id) + '</h4></div>' + (selected.patched ? '<span class="om-chip om-patched" data-tone="warn">patched</span>' : '') + '</div></div><div class="om-model-detail-scroll"><div class="om-detail-group"><div class="om-section-label">Identifier</div><div class="om-panel" style="padding:11px 13px"><span class="om-mono">' + esc(selected.id) + '</span></div></div><div class="om-detail-group"><div class="om-section-label">Routing</div><div class="om-detail-row"><label>Binary</label><span class="om-mono">' + esc(selected.binary || '— not reported') + '</span></div><div class="om-detail-row"><label>Engine</label><span>' + esc(selected.engine || '— not reported') + '</span></div><div class="om-detail-row"><label>Context</label><span>' + esc(contextLabel(selected.contextWindow)) + '</span></div><div class="om-detail-row"><label>Quota</label><span>' + esc(quotaLabel(selected)) + '</span></div></div><div class="om-detail-group"><div class="om-section-label">Aliases</div><div class="om-detail-tags">' + (aliases || '<span>— not reported</span>') + '</div></div><div class="om-detail-group"><div class="om-section-label">Used as</div><div class="om-detail-tags">' + (roles || '<span>No active loop role is bound.</span>') + '</div></div><div class="om-detail-group"><div class="om-section-label">Notes</div><div>' + esc(selected.notes || '— not reported by the registry') + '</div></div><div class="om-detail-group"><div class="om-section-label">Start with it</div><div class="om-panel" style="padding:11px 13px"><span class="om-mono">clawo session-start --model ' + esc(selected.id) + '</span></div></div></div><div class="om-model-detail-actions"><button class="om-btn om-btn-primary" data-action="new-model-session" data-model="' + attr(selected.id) + '" data-mutation>New session</button><button class="om-btn om-btn-secondary" disabled title="No role-binding mutation exists in the control plane">Bind to loop</button></div></section>' : '<div class="om-empty">No model matches the current filters.</div>';
    var patchedCount = S.registry.models.filter(function (model) { return model.patched; }).length;
    var gatedCount = S.registry.models.filter(function (model) { return model.quotaGated; }).length;
    screen.innerHTML = '<section class="om-screen">' + hero({ kicker: 'System', status: (S.registry.models.length - gatedCount) + ' routable', live: S.connection === 'online', summary: S.registry.count + ' identifiers · ' + patchedCount + ' patched · ' + gatedCount + ' quota gated', title: 'Models', description: 'Every identifier Claw knows how to route. Copy one straight into a session or an autoloop.', actions: '<button class="om-btn om-btn-hero" data-action="refresh-models">Refresh registry</button><button class="om-btn om-btn-primary" data-action="copy-selected-model">Copy identifier</button>' }) + '<div class="om-models-layout"><aside class="om-provider-rail"><div class="om-section-label">Providers</div><div class="om-provider-list">' + providerRows + '</div><div class="om-section-label">Show</div><div class="om-model-filter-list"><button class="om-filter-chip" data-action="toggle-patched" aria-pressed="' + String(S.patched) + '">patched builds only</button><button class="om-filter-chip" data-action="toggle-gated" aria-pressed="' + String(S.hideGated) + '">hide quota-gated</button></div><div class="om-panel om-registry-source"><div class="om-section-label">Registry</div><div class="om-mono">' + esc(S.registry.source) + '</div><small>' + esc('synced ' + relative(S.registry.syncedAt) + ' · ' + S.registry.count + ' identifiers') + '</small></div></aside><section class="om-model-results"><div class="om-model-toolbar"><label class="om-search-wrap"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></svg><input class="om-input" id="modelFilter" value="' + attr(S.query) + '" placeholder="Filter identifiers" /></label><span><strong>' + models.length + '</strong> shown</span><div class="om-segments"><button data-action="model-sort" data-sort="name" aria-pressed="' + String(S.sort === 'name') + '">a–z</button><button data-action="model-sort" data-sort="recent" aria-pressed="' + String(S.sort === 'recent') + '">recent</button><button data-action="model-sort" data-sort="context" aria-pressed="' + String(S.sort === 'context') + '">context</button></div></div><div class="om-model-grid">' + (models.length ? models.map(modelCard).join('') : '<div class="om-empty">No identifiers match the current filters.</div>') + '</div></section>' + detail + '</div></section>';
    bindModels();
  }

  function sessionAttachment(name) {
    var match = String(name || '').match(/^autoloop-(.+)-(planner|coder|reviewer)$/);
    return match ? { runId: match[1], role: match[2] } : null;
  }
  function sessionTokenCount(item) {
    if (!item || item.engine === 'agy') return null;
    var stats = item.stats || {};
    var total = Number(stats.tokensIn || 0) + Number(stats.tokensOut || 0);
    return Number.isFinite(total) ? total : null;
  }
  function visibleSessions() {
    if (S.sessionFilter === 'All') return S.sessions;
    if (S.sessionFilter === 'Live') return S.sessions.filter(function (item) { return item.activity === 'working'; });
    return S.sessions.filter(function (item) { return item.activity !== 'working'; });
  }
  function historyKind(item) {
    var type = String(item.type || '').toLowerCase();
    if (type.includes('user') || type.includes('input')) return 'operator';
    if (type.includes('tool_use') || type.includes('tool-use')) return 'tool-use';
    if (type.includes('tool_result') || type.includes('tool-result')) return 'dim';
    if (type.includes('error')) return 'error';
    if (type.includes('command')) return 'command';
    return 'output';
  }
  function sessionCard(item, index) {
    var selected = item.name === S.sessionId;
    var stats = item.stats || {};
    var ctx = Number.isFinite(Number(stats.contextPercent)) ? Math.max(0, Math.min(100, Number(stats.contextPercent))) : null;
    var tokens = sessionTokenCount(item);
    var attached = sessionAttachment(item.name);
    var attachment = attached ? 'attached to ' + attached.runId + ' · ' + attached.role : 'unattached · operator driven';
    return '<button class="om-session-card" data-action="select-session" data-session="' + attr(item.name) + '" data-state="' + esc(item.activity || 'idle') + '" data-pressure="' + (ctx != null && ctx >= 90 ? 'high' : 'normal') + '" aria-selected="' + String(selected) + '" style="animation-delay:' + Math.min(index, 7) * .04 + 's"><div class="om-session-card-top"><i class="om-dot" data-state="' + esc(item.activity || 'idle') + '"></i><strong title="' + attr(item.name) + '">' + esc(item.name) + '</strong>' + chip(item.activity || 'idle') + '</div><div class="om-session-engine"><span class="om-mono">' + esc(item.model || '— not reported') + '</span><span>·</span><span class="om-mono">' + esc(item.engine || '—') + '</span><span class="om-session-spark" aria-hidden="true"><i></i><i></i><i></i><i></i></span></div><div class="om-session-stats"><span>' + esc(Number(stats.turns || 0) + ' turns') + '</span><span>|</span><span>' + esc(tokens == null ? '— tokens not reported' : compact(tokens) + ' tokens') + '</span><span>' + esc(ctx == null ? '— ctx' : Math.round(ctx) + '% ctx') + '</span></div><div class="om-context-bar"><i style="width:' + (ctx == null ? 0 : ctx) + '%"></i></div><div class="om-session-attachment" title="' + attr(attachment) + '">' + esc(attachment) + '</div></button>';
  }
  function transcriptLine(item, isNew) {
    var content = typeof item.content === 'string' ? item.content : JSON.stringify(item.content);
    return '<div class="om-log-line" data-kind="' + esc(historyKind(item)) + '" data-new="' + String(Boolean(isNew)) + '"><span>' + esc(content || '') + '</span></div>';
  }
  function renderSessions() {
    var all = S.sessions;
    var shown = visibleSessions();
    var selected = all.find(function (item) { return item.name === S.sessionId; }) || all[0];
    if (selected && selected.name !== S.sessionId) {
      S.sessionId = selected.name;
      sessionStorage.setItem('clawo-session', selected.name);
    }
    var working = all.filter(function (item) { return item.activity === 'working'; }).length;
    var totalTurns = all.reduce(function (sum, item) { return sum + Number((item.stats || {}).turns || 0); }, 0);
    var pressured = all.filter(function (item) { return Number((item.stats || {}).contextPercent || 0) >= 90; }).length;
    var heroActions = '<button class="om-btn om-btn-hero" disabled title="No attach mutation exists in the control plane">Attach to run</button><button class="om-btn om-btn-primary" data-action="new-session" data-mutation>New session</button>';
    if (!selected) {
      screen.innerHTML = '<section class="om-screen">' + hero({ kicker: 'Workspace', status: '0 live', live: false, summary: '0 sessions', title: 'Sessions', description: 'Attach to a model process, drive it directly, or hand it back to a loop.', actions: heroActions, stats: [{ label: 'Turns today', value: 0 }, { label: 'Sessions', value: 0 }, { label: 'Ctx pressure', value: '0 full' }] }) + '<div class="om-workspace"><div class="om-empty"><strong>No live sessions are running.</strong><span>Start one against a real working directory.</span><button class="om-btn om-btn-primary" data-action="new-session">New session</button></div></div></section>';
      bindSessions();
      return;
    }
    var stats = selected.stats || {};
    var ctx = Number.isFinite(Number(stats.contextPercent)) ? Math.max(0, Math.min(100, Number(stats.contextPercent))) : null;
    var tokens = sessionTokenCount(selected);
    var attachment = sessionAttachment(selected.name);
    var lineHtml = S.sessionHistory.length ? S.sessionHistory.map(function (item) { return transcriptLine(item, false); }).join('') : '<div class="om-empty">No retained transcript events are available for this live process.</div>';
    if (S.sessionStreaming) lineHtml += '<div class="om-log-line" id="sessionLiveLine" data-kind="output" data-new="true"><span>' + esc(S.sessionLiveText) + '</span></div><div class="om-stream-status"><i></i><span>streaming response…</span></div>';
    var canDirective = attachment && attachment.role === 'planner';
    var prefix = S.sessionMode === 'Directive' ? '⇢' : '>';
    var placeholder = S.sessionMode === 'Directive' ? 'Record a directive for ' + attachment.runId + '…' : 'Send to ' + selected.name + '…';
    screen.innerHTML = '<section class="om-screen">' + hero({ kicker: 'Workspace', status: working + ' live', live: working > 0, summary: all.length + ' sessions · ' + (all.length - working) + ' idle · synced ' + relative(S.lastSync), title: 'Sessions', description: 'Attach to a model process, drive it directly, or hand it back to a loop.', actions: heroActions, stats: [{ label: 'Turns today', value: totalTurns }, { label: 'Sessions', value: all.length }, { label: 'Ctx pressure', value: pressured + ' full', tone: pressured ? 'warn' : '' }] }) +
      '<div class="om-sessions-layout"><section class="om-processes"><div class="om-process-toolbar"><h3>Processes</h3><div class="om-segments"><button data-action="session-filter" data-filter="All" aria-pressed="' + String(S.sessionFilter === 'All') + '">All</button><button data-action="session-filter" data-filter="Live" aria-pressed="' + String(S.sessionFilter === 'Live') + '">Live</button><button data-action="session-filter" data-filter="Idle" aria-pressed="' + String(S.sessionFilter === 'Idle') + '">Idle</button></div></div><div class="om-process-list">' + (shown.length ? shown.map(sessionCard).join('') : '<div class="om-empty">No sessions match this filter.</div>') + '</div></section>' +
      '<section class="om-session-detail"><div class="om-panel om-session-header"><div class="om-dial" style="--pct:' + (ctx == null ? 0 : ctx) + ';--dial-color:' + (ctx != null && ctx >= 90 ? 'var(--color-accent-500)' : 'var(--color-accent-2-500)') + '"><span>' + (ctx == null ? '—' : Math.round(ctx) + '%') + '</span></div><div class="om-session-header-copy"><div class="om-session-header-title"><h3 title="' + attr(selected.name) + '">' + esc(selected.name) + '</h3>' + chip(selected.activity || 'idle') + '</div><div class="om-session-path om-mono" title="' + attr(selected.cwd || '') + '">' + esc((selected.model || '— not reported') + ' · ' + (selected.engine || '—') + ' · ' + (selected.cwd || '— not reported')) + '</div></div><div class="om-session-head-stats"><div class="om-stat"><label>Uptime</label><strong>' + esc(formatDuration(Number(stats.uptime || 0) * 1000)) + '</strong></div><div class="om-stat"><label>Turns</label><strong>' + esc(stats.turns || 0) + '</strong></div><div class="om-stat"><label>Tokens</label><strong>' + esc(tokens == null ? '—' : compact(tokens)) + '</strong></div><div class="om-session-head-actions"><button class="om-btn om-btn-secondary" disabled title="No safe fork operation exists">Fork</button><button class="om-btn om-btn-secondary" disabled title="No attach/detach mutation exists">Detach</button><button class="om-btn om-btn-ghost" data-action="stop-session" data-mutation>Stop</button></div></div></div>' +
      '<div class="om-panel om-transcript" data-streaming="' + String(S.sessionStreaming) + '"><div class="om-transcript-head"><span class="om-section-label">Transcript</span><small>' + esc((S.sessionTail ? 'following tail' : 'scroll locked') + ' · ' + S.sessionHistory.length + ' lines') + '</small><div class="om-transcript-controls"><button class="om-mini-toggle" data-action="toggle-tail" aria-pressed="' + String(S.sessionTail) + '">follow tail</button><button class="om-mini-toggle" data-action="toggle-wrap" aria-pressed="' + String(S.sessionWrap) + '">wrap</button><button class="om-mini-toggle" data-action="clear-transcript">clear</button></div></div><div class="om-transcript-lines" id="transcriptLines" data-wrap="' + String(S.sessionWrap) + '">' + lineHtml + '</div>' +
      '<form class="om-session-composer" id="sessionComposer"><div class="om-composer-top"><button class="om-mini-toggle" type="button" data-action="session-mode" data-mode="Prompt" aria-pressed="' + String(S.sessionMode === 'Prompt') + '">Prompt</button><button class="om-mini-toggle" type="button" disabled title="No safe HTTP worktree shell executor exists">Shell</button><button class="om-mini-toggle" type="button" data-action="session-mode" data-mode="Directive" aria-pressed="' + String(S.sessionMode === 'Directive') + '" ' + (canDirective ? '' : 'disabled title="Only an attached Planner session can receive loop directives"') + '>Directive</button><small>⌘↵ to send · ⌥↑ recall</small></div><div class="om-composer-row"><label class="om-composer-field"><span class="om-composer-prefix">' + prefix + '</span><textarea class="om-textarea" id="sessionDraft" placeholder="' + attr(placeholder) + '">' + esc(S.sessionDraft) + '</textarea></label><button class="om-btn om-btn-primary" type="submit" data-mutation>Send</button></div></form></div></section></div></section>';
    bindSessions();
    if (S.sessionTail) {
      var lines = document.getElementById('transcriptLines');
      if (lines) lines.scrollTop = lines.scrollHeight;
    }
  }
  async function loadSessions() {
    var data = await api('/session/list');
    S.sessions = data.sessions || [];
    if (!S.sessionId || !S.sessions.some(function (item) { return item.name === S.sessionId; })) S.sessionId = S.sessions[0] ? S.sessions[0].name : null;
    if (S.sessionId) {
      sessionStorage.setItem('clawo-session', S.sessionId);
      var history = await post('/session/grep', { name: S.sessionId, pattern: '.*', limit: 250 });
      S.sessionHistory = history.matches || [];
    } else S.sessionHistory = [];
    S.lastSync = new Date().toISOString();
    openSessionStream();
  }
  function openSessionStream() {
    if (S.sessionStream) S.sessionStream.close();
    if (S.councilStream) S.councilStream.close();
    if (S.forgeStream) S.forgeStream.close();
    var source = new EventSource('/session/events');
    S.sessionStream = source;
    source.onopen = function () { setConnection('online'); };
    source.onerror = function () { setConnection('degraded'); };
    source.addEventListener('snapshot', function (event) {
      var data = JSON.parse(event.data);
      S.sessions = data.sessions || [];
      if (S.screen === 'sessions') renderSessions();
    });
    source.addEventListener('session', function (event) {
      var data = JSON.parse(event.data);
      if (data.type === 'session-started' || data.type === 'turn-finished') {
        var next = data.session;
        S.sessions = S.sessions.filter(function (item) { return item.name !== data.name; }).concat(next ? [next] : []);
      } else if (data.type === 'session-stopped') {
        S.sessions = S.sessions.filter(function (item) { return item.name !== data.name; });
      }
      if (data.name !== S.sessionId) {
        if (S.screen === 'sessions') renderSessions();
        return;
      }
      if (data.type === 'turn-started') {
        S.sessionStreaming = true;
        S.sessionLiveText = '';
        if (S.screen === 'sessions') renderSessions();
      } else if (data.type === 'session-stream') {
        appendSessionStream(data);
      } else if (data.type === 'turn-finished') {
        S.sessionStreaming = false;
        S.sessionLiveText = '';
        void refreshSelectedSession();
      }
    });
  }
  var sessionFrame = null;
  var sessionBuffer = '';
  function appendSessionStream(data) {
    if (data.kind === 'text') sessionBuffer += String(data.content || '');
    else {
      S.sessionHistory.push({ type: data.kind, time: data.timestamp, content: data.content });
    }
    if (sessionFrame) return;
    sessionFrame = requestAnimationFrame(function () {
      S.sessionLiveText += sessionBuffer;
      sessionBuffer = '';
      sessionFrame = null;
      var line = document.querySelector('#sessionLiveLine span');
      if (line) line.textContent = S.sessionLiveText;
      else if (S.screen === 'sessions') renderSessions();
      var lines = document.getElementById('transcriptLines');
      if (lines && S.sessionTail) lines.scrollTop = lines.scrollHeight;
    });
  }
  async function refreshSelectedSession() {
    try {
      var data = await api('/session/list');
      S.sessions = data.sessions || [];
      if (S.sessionId && S.sessions.some(function (item) { return item.name === S.sessionId; })) {
        var history = await post('/session/grep', { name: S.sessionId, pattern: '.*', limit: 250 });
        S.sessionHistory = history.matches || [];
      }
      if (S.screen === 'sessions') renderSessions();
    } catch (_) { setConnection('degraded'); }
  }
  function bindSessions() {
    screen.querySelectorAll('[data-action="new-session"]').forEach(function (button) {
      button.onclick = async function () {
        if (!S.registry) {
          try { await loadModels(false); }
          catch (error) { toast(error.message); return; }
        }
        var first = S.registry.models.find(function (item) { return !item.quotaGated; });
        if (first) newSession(first.id);
      };
    });
    screen.querySelectorAll('[data-action="session-filter"]').forEach(function (button) {
      button.onclick = function () { S.sessionFilter = button.dataset.filter; renderSessions(); };
    });
    screen.querySelectorAll('[data-action="select-session"]').forEach(function (button) {
      button.onclick = async function () {
        S.sessionId = button.dataset.session;
        sessionStorage.setItem('clawo-session', S.sessionId);
        S.sessionStreaming = false;
        S.sessionLiveText = '';
        try {
          var history = await post('/session/grep', { name: S.sessionId, pattern: '.*', limit: 250 });
          S.sessionHistory = history.matches || [];
          renderSessions();
        } catch (error) { toast(error.message); }
      };
    });
    screen.querySelectorAll('[data-action="toggle-tail"]').forEach(function (button) {
      button.onclick = function () { S.sessionTail = !S.sessionTail; toast(S.sessionTail ? 'Following the transcript tail' : 'Transcript tail released'); renderSessions(); };
    });
    screen.querySelectorAll('[data-action="toggle-wrap"]').forEach(function (button) {
      button.onclick = function () { S.sessionWrap = !S.sessionWrap; renderSessions(); };
    });
    screen.querySelectorAll('[data-action="clear-transcript"]').forEach(function (button) {
      button.onclick = function () { S.sessionHistory = []; S.sessionLiveText = ''; toast('Cleared local transcript view only'); renderSessions(); };
    });
    screen.querySelectorAll('[data-action="session-mode"]').forEach(function (button) {
      button.onclick = function () { S.sessionMode = button.dataset.mode; renderSessions(); };
    });
    var transcript = document.getElementById('transcriptLines');
    if (transcript) transcript.onscroll = function () {
      if (transcript.scrollTop + transcript.clientHeight < transcript.scrollHeight - 20 && S.sessionTail) {
        S.sessionTail = false;
        var follow = screen.querySelector('[data-action="toggle-tail"]');
        if (follow) follow.setAttribute('aria-pressed', 'false');
      }
    };
    var form = document.getElementById('sessionComposer');
    if (form) {
      var draft = document.getElementById('sessionDraft');
      draft.oninput = function () { S.sessionDraft = draft.value; };
      draft.onkeydown = function (event) {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); form.requestSubmit(); }
        if (event.key === 'ArrowUp' && event.altKey) { event.preventDefault(); draft.value = S.sessionLastInput; S.sessionDraft = draft.value; }
      };
      form.onsubmit = async function (event) {
        event.preventDefault();
        var value = draft.value.trim();
        if (!value) { toast('Type a prompt first'); return; }
        event.submitter.disabled = true;
        S.sessionLastInput = value;
        S.sessionHistory.push({ type: S.sessionMode === 'Directive' ? 'command' : 'user', time: new Date().toISOString(), content: (S.sessionMode === 'Directive' ? '⇢ ' : '> ') + value });
        S.sessionDraft = '';
        renderSessions();
        try {
          if (S.sessionMode === 'Directive') {
            var selected = S.sessions.find(function (item) { return item.name === S.sessionId; });
            var attached = selected ? sessionAttachment(selected.name) : null;
            if (!attached || attached.role !== 'planner') throw new Error('Only an attached Planner session can receive a directive');
            await post('/autoloop/' + encodeURIComponent(attached.runId) + '/chat', { text: value });
            toast('Directive recorded for ' + attached.runId);
          } else {
            await post('/session/send', { name: S.sessionId, message: value });
          }
        } catch (error) { toast(error.message); }
        finally { await refreshSelectedSession(); }
      };
    }
    var stop = screen.querySelector('[data-action="stop-session"]');
    if (stop) stop.onclick = function () {
      var selected = S.sessions.find(function (item) { return item.name === S.sessionId; });
      if (!selected) return;
      openDialog('Stop session', 'This ends the live model process. Persisted resume behavior depends on the engine.', '<div class="om-panel" style="padding:13px 15px"><strong>' + esc(selected.name) + '</strong><div class="om-mono">' + esc(selected.model || '— not reported') + '</div></div>', async function () {
        await post('/session/stop', { name: selected.name });
        closeDialog();
        toast('Stopped ' + selected.name);
        S.sessionId = null;
        await loadSessions();
        renderSessions();
      });
    };
  }

  function limitWindow(provider, kind) {
    if (!provider || provider.status !== 'ok') return null;
    return provider.windows.find(function (window) {
      return kind === 'five' ? window.id === 'five-hour' || /five hour/i.test(window.label) || window.windowDurationMins === 300 : window.id === 'weekly' || window.id === 'weekly-all' || /weekly/i.test(window.label) || window.windowDurationMins === 10080;
    }) || null;
  }
  function resetLabel(window) {
    if (!window) return 'not reported';
    if (window.resetsAt) {
      try { return 'resets ' + new Date(window.resetsAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
      catch (_) {}
    }
    return window.resetsLabel || 'reset not reported';
  }
  function quotaCard(id, label) {
    var provider = S.limits && S.limits.providers ? S.limits.providers.find(function (item) { return item.provider === id; }) : null;
    var five = limitWindow(provider, 'five');
    var week = limitWindow(provider, 'week');
    var source = provider ? provider.source : 'source unavailable';
    function row(name, window) {
      return '<div class="om-quota-row"><label>' + esc(name) + '</label><strong>' + (window ? esc(window.remainingPercent + '%') : '—') + '</strong><span>' + esc(resetLabel(window)) + '</span></div>';
    }
    var pct = five ? five.remainingPercent : week ? week.remainingPercent : 0;
    return '<article class="om-panel om-quota-card"><div class="om-quota-card-head"><i class="om-dot" data-state="' + (provider && provider.status === 'ok' ? 'idle' : 'error') + '"></i><strong>' + esc(label) + '</strong><span class="om-mono" title="' + attr(source) + '">' + esc(source) + '</span></div>' + row('Five hour', five) + row('Weekly', week) + '<div class="om-quota-bar"><i style="width:' + Math.max(0, Math.min(100, pct)) + '%"></i></div></article>';
  }
  function councilStateLabel(value) {
    return value === 'running' ? 'Deliberating' : value === 'consensus' || value === 'accepted' ? 'Concluded' : titleCase(value);
  }
  function councilCard(item, index) {
    var members = item.config && item.config.agents ? item.config.agents : [];
    var maxRound = Math.max(0, ...(item.responses || []).map(function (response) { return Number(response.round || 0); }));
    var avatars = members.slice(0, 4).map(function (member) {
      return '<span class="om-member-avatar" title="' + attr(member.model || member.name) + '">' + esc((member.model || member.name || '?').charAt(0).toUpperCase()) + '</span>';
    }).join('');
    return '<button class="om-list-card" data-action="select-council" data-council="' + attr(item.id) + '" aria-selected="' + String(item.id === S.councilId) + '" style="animation-delay:' + Math.min(index, 6) * .04 + 's"><div style="display:flex;align-items:center;gap:9px"><i class="om-dot" data-state="' + (item.status === 'running' ? 'working' : 'idle') + '"></i>' + chip(councilStateLabel(item.status)) + '<span style="margin-left:auto;color:var(--color-neutral-600);font-size:11px">' + esc(relative(item.startTime)) + '</span></div><div class="om-council-card-title">' + esc(item.task) + '</div><div class="om-council-card-meta">' + avatars + '<span>' + esc('round ' + maxRound + ' / ' + Number((item.config || {}).maxRounds || 0)) + '</span></div></button>';
  }
  function councilMember(member, response, round) {
    var model = member.model || null;
    var registryModel = S.registry && model ? S.registry.models.find(function (item) { return item.id === model; }) : null;
    var provider = registryModel ? registryModel.provider : 'unknown';
    var draftingKey = String(round) + ':' + member.name;
    var status = response ? 'answered' : S.councilDrafting[draftingKey] ? 'drafting' : 'waiting';
    var stance = response ? (response.consensus ? 'Consensus' : 'Not consensus') : '—';
    return '<article class="om-panel om-member-column" data-provider="' + esc(provider) + '" data-status="' + status + '"><div class="om-member-head"><div class="om-member-identity"><span class="om-model-avatar" data-provider="' + esc(provider) + '">' + esc(providerMark(provider)) + '</span><div class="om-member-identity-copy"><label>' + esc(member.role || 'member') + '</label><strong title="' + attr(model || member.name) + '">' + esc(model || member.name) + '</strong></div>' + chip(status) + '</div><div class="om-member-stance"><strong>' + esc(stance) + '</strong><small>confidence — not reported</small></div></div><div class="om-member-answer">' + (response ? markdown(response.content) + '<div class="om-member-cite">response ' + esc(response.timestamp || 'timestamp not reported') + '</div>' : '<div class="om-empty">' + esc(status === 'drafting' ? 'This member is drafting from the real council stream.' : 'No answer exists for this member in round ' + round + '.') + '</div>') + '</div><div class="om-member-actions"><button class="om-btn om-btn-secondary" disabled title="The control plane cannot adopt one member response">Adopt answer</button><button class="om-btn om-btn-ghost" disabled title="The control plane cannot probe one member independently">Probe</button></div></article>';
  }
  function renderCouncils() {
    var selected = S.council || S.councils.find(function (item) { return item.id === S.councilId; }) || null;
    var liveCount = S.councils.filter(function (item) { return item.status === 'running'; }).length;
    var actions = '<button class="om-btn om-btn-hero" data-action="refresh-limits">Refresh limits</button><button class="om-btn om-btn-primary" data-action="new-council" data-mutation>New council</button>';
    var limitTime = S.limits ? 'updated ' + relative(S.limits.fetchedAt) : 'limits unavailable';
    var quota = '<div class="om-limits-heading"><span class="om-section-label">Account limits</span><small>' + esc(limitTime) + '</small><small>quota gates every council round</small></div><div class="om-quota-grid">' + quotaCard('codex', 'Codex') + quotaCard('claude', 'Claude Max') + quotaCard('gemini', 'Gemini / agy') + '</div>';
    if (!selected) {
      screen.innerHTML = '<section class="om-screen">' + hero({ kicker: 'Workspace', status: liveCount + ' deliberating', live: liveCount > 0, summary: S.councils.length + ' councils', title: 'Councils', description: 'Multi-agent consensus work — several models answer the same question, then you adopt one.', actions: actions }) + quota + '<div class="om-councils-layout"><section class="om-council-list"><div class="om-list-head"><h3>Councils</h3><span class="om-list-count">' + S.councils.length + '</span></div><div class="om-list-scroll">' + (S.councils.length ? S.councils.map(councilCard).join('') : '<div class="om-empty">No councils have been convened.</div>') + '</div></section><div class="om-empty">Select a council to inspect its real rounds and answers.</div></div></section>';
      bindCouncils();
      return;
    }
    var responses = selected.responses || [];
    var agents = selected.config && selected.config.agents ? selected.config.agents : [];
    var maxAnsweredRound = Math.max(0, ...responses.map(function (response) { return Number(response.round || 0); }));
    var maxRounds = Number((selected.config || {}).maxRounds || maxAnsweredRound || 1);
    var round = S.councilRound == null ? Math.max(1, maxAnsweredRound) : Math.max(1, Math.min(S.councilRound, maxRounds));
    S.councilRound = round;
    var roundResponses = responses.filter(function (response) { return Number(response.round) === round; });
    var yes = roundResponses.filter(function (response) { return response.consensus; }).length;
    var no = roundResponses.length - yes;
    var pct = roundResponses.length ? Math.round(Math.max(yes, no) / roundResponses.length * 100) : 0;
    var rounds = Array.from({ length: maxRounds }, function (_, index) { return index + 1; }).map(function (value) {
      return '<button data-action="council-round" data-round="' + value + '" aria-pressed="' + String(value === round) + '">Round ' + value + '</button>';
    }).join('');
    var members = agents.length ? agents.map(function (member) {
      var response = roundResponses.find(function (item) { return item.agent === member.name; });
      return councilMember(member, response, round);
    }).join('') : '<div class="om-empty">Member configuration is not present in the persisted council transcript.</div>';
    screen.innerHTML = '<section class="om-screen">' + hero({ kicker: 'Workspace', status: liveCount + ' deliberating', live: liveCount > 0, summary: S.councils.length + ' councils · ' + agents.length + ' members seated', title: 'Councils', description: 'Multi-agent consensus work — several models answer the same question, then you adopt one.', actions: actions }) + quota +
      '<div class="om-councils-layout"><section class="om-council-list"><div class="om-list-head"><h3>Councils</h3><span class="om-list-count">' + S.councils.length + '</span></div><div class="om-list-scroll">' + S.councils.map(councilCard).join('') + '</div></section><section class="om-council-main"><div class="om-panel om-council-header"><div class="om-council-header-top"><div class="om-council-question"><span class="om-section-label">Question</span><h3>' + esc(selected.task) + '</h3></div><div class="om-council-metrics"><div class="om-stat"><label>Rule</label><strong>—</strong></div><div class="om-stat"><label>Round</label><strong>' + round + ' / ' + maxRounds + '</strong></div><div class="om-stat"><label>Consensus</label><strong>' + (roundResponses.length ? pct + '%' : '—') + '</strong></div></div></div><div class="om-round-toolbar"><div class="om-segments">' + rounds + '</div><div class="om-consensus-bar"><i style="width:' + pct + '%"></i></div><small>' + esc(roundResponses.length ? yes + ' consensus · ' + no + ' dissent' : 'no answers yet') + '</small></div></div><div class="om-member-grid">' + members + '</div><div class="om-council-footer"><button class="om-btn om-btn-secondary" disabled title="No advance-round mutation exists">Advance round</button><button class="om-btn om-btn-primary" disabled title="No conclude-only mutation exists; councilAccept has different semantics">Conclude</button><small>Unavailable controls name the missing server contract; no outcome is simulated.</small></div></section></div></section>';
    bindCouncils();
  }
  async function loadCouncils() {
    var data = await Promise.all([api('/council/list'), api('/usage/limits')]);
    S.councils = data[0].councils || [];
    S.limits = data[1];
    if (!S.councilId || !S.councils.some(function (item) { return item.id === S.councilId; })) S.councilId = S.councils[0] ? S.councils[0].id : null;
    S.council = null;
    if (S.councilId) {
      sessionStorage.setItem('clawo-council', S.councilId);
      try { S.council = (await api('/council/' + encodeURIComponent(S.councilId) + '/state')).session; }
      catch (_) { S.council = S.councils.find(function (item) { return item.id === S.councilId; }) || null; }
    }
    if (!S.registry) {
      try { await loadModels(false); } catch (_) {}
    }
    S.lastSync = new Date().toISOString();
    openCouncilStream();
  }
  function openCouncilStream() {
    if (S.councilStream) S.councilStream.close();
    if (!S.councilId || !S.council || S.council.status !== 'running') return;
    var source = new EventSource('/council/' + encodeURIComponent(S.councilId) + '/events');
    S.councilStream = source;
    source.onopen = function () { setConnection('online'); };
    source.onerror = function () { setConnection('degraded'); };
    source.addEventListener('snapshot', function (event) {
      S.council = JSON.parse(event.data);
      if (S.screen === 'council') renderCouncils();
    });
    source.addEventListener('council-event', async function (event) {
      var data = JSON.parse(event.data);
      if (data.type === 'agent-start') S.councilDrafting[String(data.round) + ':' + data.agent] = true;
      if (data.type === 'agent-complete') delete S.councilDrafting[String(data.round) + ':' + data.agent];
      try {
        S.council = (await api('/council/' + encodeURIComponent(S.councilId) + '/state')).session;
        var index = S.councils.findIndex(function (item) { return item.id === S.councilId; });
        if (index >= 0) S.councils[index] = S.council;
      } catch (_) {}
      if (S.screen === 'council') renderCouncils();
    });
  }
  function bindCouncils() {
    screen.querySelectorAll('[data-action="select-council"]').forEach(function (button) {
      button.onclick = async function () {
        S.councilId = button.dataset.council;
        S.councilRound = null;
        try {
          S.council = (await api('/council/' + encodeURIComponent(S.councilId) + '/state')).session;
          sessionStorage.setItem('clawo-council', S.councilId);
          openCouncilStream();
          renderCouncils();
        } catch (_) {
          S.council = S.councils.find(function (item) { return item.id === S.councilId; }) || null;
          renderCouncils();
        }
      };
    });
    screen.querySelectorAll('[data-action="council-round"]').forEach(function (button) {
      button.onclick = function () { S.councilRound = Number(button.dataset.round); renderCouncils(); };
    });
    screen.querySelectorAll('[data-action="refresh-limits"]').forEach(function (button) {
      button.onclick = async function () {
        button.disabled = true;
        try { S.limits = await api('/usage/limits?refresh=1'); toast('Account limits refreshed from all three providers'); renderCouncils(); }
        catch (error) { toast(error.message); button.disabled = false; }
      };
    });
    screen.querySelectorAll('[data-action="new-council"]').forEach(function (button) { button.onclick = newCouncil; });
  }
  async function newCouncil() {
    if (!S.registry) {
      try { await loadModels(false); } catch (error) { toast(error.message); return; }
    }
    var available = S.registry.models.filter(function (model) { return !model.quotaGated && ['claude', 'agy', 'codex'].includes(model.engine); });
    var choices = available.map(function (model, index) {
      return '<label class="om-detail-row"><input type="checkbox" name="agents" value="' + attr(model.id) + '" ' + (index < 3 ? 'checked' : '') + '><span class="om-mono">' + esc(model.id) + '</span></label>';
    }).join('');
    openDialog('New council', 'Choose real registry models. The current server records roles but does not expose a configurable consensus rule.', '<label class="om-detail-group"><span class="om-section-label">Question</span><textarea class="om-textarea" name="task" required></textarea></label><label class="om-detail-group"><span class="om-section-label">Project directory</span><input class="om-input" name="projectDir" required placeholder="C:\\Dev\\Repository"></label><label class="om-detail-group"><span class="om-section-label">Rounds</span><input class="om-input" type="number" name="maxRounds" min="1" max="50" value="3" required></label><div class="om-detail-group"><span class="om-section-label">Members</span>' + choices + '</div>', async function (form) {
      var ids = form.getAll('agents').map(String);
      if (ids.length < 2) throw new Error('Seat at least two registry models');
      var agents = ids.map(function (id, index) { return { model: id, role: index === 0 ? 'chair' : index === ids.length - 1 ? 'auditor' : 'member' }; });
      var result = await post('/council/new', { task: String(form.get('task') || '').trim(), projectDir: String(form.get('projectDir') || '').trim(), maxRounds: Number(form.get('maxRounds')), agents: agents });
      closeDialog();
      S.councilId = result.id;
      toast('Council convened · ' + ids.length + ' real members');
      await loadCouncils();
      renderCouncils();
    });
  }

  function forgeModeLabel(mode) {
    return mode === 'interview' ? 'Interview' : mode === 'queued' ? 'Queued' : mode === 'building' ? 'Building' : mode === 'build-complete' ? 'Build complete' : mode === 'deploying' ? 'Deploying' : mode === 'done' ? 'Running' : mode === 'failed' ? 'Failed' : mode === 'cancelled' ? 'Cancelled' : titleCase(mode);
  }
  function realForgeStage(mode) {
    if (mode === 'interview') return 'Interview';
    if (mode === 'queued' || mode === 'building' || mode === 'failed' || mode === 'cancelled') return 'Build';
    if (mode === 'build-complete' || mode === 'deploying' || mode === 'done') return 'Run';
    return 'AppSpec';
  }
  function forgeProgress(mode) {
    return mode === 'interview' ? 8 : mode === 'queued' ? 34 : mode === 'building' ? 58 : mode === 'build-complete' ? 72 : mode === 'deploying' ? 84 : mode === 'done' ? 100 : mode === 'failed' || mode === 'cancelled' ? 58 : 18;
  }
  function forgeCard(item, index) {
    return '<button class="om-list-card" data-action="select-forge" data-forge="' + attr(item.runId) + '" aria-selected="' + String(item.runId === S.forgeId) + '" style="animation-delay:' + Math.min(index, 6) * .04 + 's"><div style="display:flex;align-items:center;gap:9px"><i class="om-dot" data-state="' + (item.mode === 'building' || item.mode === 'deploying' ? 'working' : item.mode === 'done' ? 'idle' : 'waiting') + '"></i><strong style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(item.title || item.runId) + '</strong>' + chip(forgeModeLabel(item.mode)) + '</div><div class="om-council-card-title">' + esc(item.title || '— title not reported') + '</div><div class="om-council-card-meta"><span class="om-mono">' + esc(item.runId) + '</span><span>' + esc(realForgeStage(item.mode)) + ' · ' + relative(item.updatedAt) + '</span></div><div class="om-context-bar"><i style="width:' + forgeProgress(item.mode) + '%"></i></div></button>';
  }
  function forgeStages(mode) {
    var names = ['Interview', 'AppSpec', 'Build', 'Run', 'Revise', 'Expose'];
    var actual = realForgeStage(mode);
    var actualIndex = names.indexOf(actual);
    var selectedIndex = names.indexOf(S.forgeStage || actual);
    return names.map(function (name, index) {
      var state = index < actualIndex ? 'complete' : index === selectedIndex ? 'current' : 'later';
      return '<button class="om-stage" data-action="forge-stage" data-stage="' + name + '" data-state="' + state + '"><span class="om-stage-dot">' + (index < actualIndex ? '✓' : index + 1) + '</span><span class="om-stage-label">' + name + '</span>' + (index < names.length - 1 ? '<span class="om-stage-line"></span>' : '') + '</button>';
    }).join('');
  }
  function buildEventLine(event) {
    var kind = event.type && /failed|cancelled|error/.test(event.type) ? 'error' : event.type && /complete|consensus/.test(event.type) ? 'dim' : 'output';
    return { type: kind, content: JSON.stringify(event), time: new Date().toISOString() };
  }
  function forgeInterview(detail) {
    var chat = detail.chat || [];
    var rows = chat.length ? chat.map(function (entry, index) {
      return '<div class="om-qa-row"><div class="om-qa-question"><span class="om-qa-number">' + (index + 1) + '</span><span>' + esc(entry.role + ' · ' + entry.kind) + '</span></div><div class="om-qa-answer">' + markdown(entry.text) + '</div></div>';
    }).join('') : '<div class="om-empty">No interview messages have been persisted yet.</div>';
    return '<div class="om-forge-pane"><section class="om-panel om-forge-surface"><div class="om-forge-surface-head"><span class="om-section-label">Interview</span><small>' + chat.length + ' persisted messages · answers become the spec</small></div><div class="om-forge-scroll">' + rows + '</div><form class="om-forge-footer" id="forgeAnswer"><textarea class="om-textarea" id="forgeAnswerText" placeholder="Answer the current real question — ⌘↵ to send"></textarea><button class="om-btn om-btn-primary" type="submit" data-mutation>Send answer</button></form></section><aside class="om-panel om-forge-side" style="padding:16px"><div class="om-section-label">Spec so far</div><div class="om-detail-row"><label>Name</label><span>' + esc(detail.spec.meta.name || '— not reported') + '</span></div><div class="om-detail-row"><label>Inputs</label><span>' + detail.spec.inputs.length + '</span></div><div class="om-detail-row"><label>Outputs</label><span>' + detail.spec.outputs.length + '</span></div><div class="om-detail-row"><label>Steps</label><span>' + detail.spec.pipeline.steps.length + '</span></div></aside></div>';
  }
  function forgeSpec(detail) {
    return '<div class="om-forge-pane"><section class="om-panel om-forge-surface"><div class="om-forge-surface-head"><span class="om-section-label">AppSpec</span><small>real editable spec · updated ' + esc(relative(detail.spec.updatedAt)) + '</small></div><form class="om-forge-scroll" id="forgeSpecForm"><textarea class="om-spec-editor" id="forgeSpecJson" spellcheck="false">' + esc(JSON.stringify(detail.spec, null, 2)) + '</textarea></form><div class="om-forge-footer"><button class="om-btn om-btn-primary" data-action="save-spec" data-mutation>Save spec</button><button class="om-btn om-btn-secondary" disabled title="No regenerate-from-answers endpoint exists">Regenerate from answers</button><span class="om-mono" style="margin-left:auto">spec-edit · replace root</span></div></section><aside class="om-panel om-forge-side" style="padding:16px"><div class="om-section-label">Derived structure</div><div class="om-detail-row"><label>Name</label><span class="om-mono">' + esc(detail.spec.meta.name || '— not reported') + '</span></div><div class="om-detail-row"><label>Purpose</label><span>' + esc(detail.spec.meta.description || '— not reported') + '</span></div><div class="om-detail-row"><label>Layout</label><span>' + esc(detail.spec.ui.layout) + '</span></div><div class="om-detail-row"><label>LLM</label><span>' + esc(String(detail.spec.runtime.needsLLM)) + '</span></div></aside></div>';
  }
  function forgeBuild(detail) {
    var lines = S.forgeEvents.length ? S.forgeEvents.map(function (event) { return transcriptLine(buildEventLine(event), true); }).join('') : '<div class="om-empty">Build logs are not persisted by the current store. New build events will stream here.</div>';
    var active = detail.state.mode === 'queued' || detail.state.mode === 'building' || detail.state.mode === 'deploying';
    return '<section class="om-panel om-forge-surface"><div class="om-forge-surface-head"><span class="om-section-label">Build</span><small>' + esc(forgeModeLabel(detail.state.mode)) + '</small></div><div class="om-transcript-lines">' + lines + '</div><div class="om-forge-footer"><button class="om-btn om-btn-primary" data-action="forge-build" ' + (active ? 'disabled' : '') + ' data-mutation>' + (active ? 'Building…' : 'Rebuild') + '</button><button class="om-btn om-btn-secondary" data-action="forge-cancel" ' + (active ? '' : 'disabled') + '>Cancel build</button><button class="om-btn om-btn-ghost" data-action="clear-forge-events">Clear local log</button></div></section>';
  }
  function forgeRun(detail) {
    var liveArtifact = S.forgeArtifacts.slice().reverse().find(function (artifact) { return artifact.deploy; }) || null;
    var running = detail.state.mode === 'done' || detail.state.mode === 'deploying';
    return '<div class="om-forge-pane"><section class="om-panel om-forge-surface"><div class="om-forge-surface-head"><span class="om-section-label">Process log</span><small>— not persisted by the current runtime contract</small></div><div class="om-forge-scroll"><div class="om-empty">' + esc(running ? 'The runtime is marked active, but no process-log stream is exposed.' : 'No running process is reported.') + '</div></div><div class="om-forge-footer"><button class="om-btn om-btn-primary" data-action="' + (running ? 'forge-stop' : 'forge-start') + '" data-mutation>' + (running ? 'Stop' : 'Start') + '</button><button class="om-btn om-btn-secondary" disabled title="No atomic restart endpoint exists">Restart</button></div></section><aside class="om-forge-side"><section class="om-panel" style="padding:16px"><div class="om-section-label">Health</div><div class="om-health-row" style="margin-top:13px"><div class="om-dial" style="--pct:' + (running ? 100 : 0) + '"><span>' + (running ? 'state' : 'off') + '</span></div><p>' + esc(running ? 'Run state reports active. Dedicated health checks are not exposed.' : 'Run state reports no active deployment.') + '</p></div></section><section class="om-panel" style="padding:16px;flex:1"><div class="om-section-label">Preview</div><div class="om-empty" style="margin-top:12px">' + (liveArtifact ? '<a href="' + attr(liveArtifact.deploy.url) + '" target="_blank" rel="noreferrer">' + esc(liveArtifact.deploy.url) + '</a>' : 'No deployed URL is recorded.') + '</div></section></aside></div>';
  }
  function forgeRevise() {
    var rows = S.forgeArtifacts.length ? S.forgeArtifacts.slice().reverse().map(function (artifact, index) {
      return '<div class="om-version-row" data-live="' + String(index === 0 && Boolean(artifact.deploy)) + '"><span class="om-version-tag">' + esc(artifact.version) + '</span><div class="om-version-copy"><strong title="' + attr(artifact.worktreePath) + '">' + esc(artifact.worktreePath) + '</strong><small>' + esc('built ' + relative(artifact.builtAt)) + '</small></div>' + chip(index === 0 && artifact.deploy ? 'live' : 'superseded') + '<button class="om-btn om-btn-secondary" data-action="promote-version" data-version="' + attr(artifact.version) + '" ' + (artifact.deploy ? '' : 'disabled title="Version has no deploy info"') + '>Promote</button></div>';
    }).join('') : '<div class="om-empty">No build versions have been recorded.</div>';
    return '<section class="om-panel om-forge-surface"><div class="om-forge-surface-head"><span class="om-section-label">Revisions</span><small>real artifact history</small></div><div class="om-forge-scroll om-version-list">' + rows + '</div><form class="om-forge-footer" id="forgeFeedback"><textarea class="om-textarea" id="forgeFeedbackText" placeholder="What should change in the next real version?"></textarea><button class="om-btn om-btn-primary" type="submit" data-mutation>Revise</button></form></section>';
  }
  function forgeExpose() {
    var artifact = S.forgeArtifacts.slice().reverse().find(function (item) { return item.deploy; }) || null;
    var url = artifact ? artifact.deploy.url : null;
    return '<section class="om-panel om-forge-surface" style="padding:20px;gap:18px"><div style="display:flex;align-items:center;gap:12px"><span class="om-section-label">Tailscale</span>' + chip(url ? 'deployed' : 'not exposed') + '<span class="om-mono" style="margin-left:auto">device — not reported</span></div><div class="om-expose-url"><span class="om-mono">' + esc(url || '—') + '</span><button class="om-btn om-btn-secondary" data-action="copy-forge-url" ' + (url ? '' : 'disabled title="No deployed URL exists"') + '>Copy</button></div><div class="om-detail-group"><div class="om-section-label">Visibility</div><div class="om-segments"><button disabled title="Tailscale serve state is not exposed">tailnet only</button><button disabled title="Tailscale funnel state is not exposed">public funnel</button></div></div><div class="om-empty">Claw does not currently expose Tailscale device, serve, or funnel state. Exposure mutations are disabled rather than simulated.</div></section>';
  }
  function renderForge() {
    var detail = S.forgeDetail;
    var actions = '<button class="om-btn om-btn-hero" data-action="forge-expose-view" ' + (detail ? '' : 'disabled title="Select a real Forge app first"') + '>Open on tailnet</button><button class="om-btn om-btn-primary" data-action="new-forge" data-mutation>New app</button>';
    if (!detail) {
      screen.innerHTML = '<section class="om-screen">' + hero({ kicker: 'Workspace', status: S.forge.filter(function (item) { return item.mode === 'done'; }).length + ' running', live: false, summary: S.forge.length + ' apps', title: 'Forge', description: 'Interview to running app — separate from the planner, coder and reviewer loop.', actions: actions }) + '<div class="om-forge-layout"><section class="om-council-list"><div class="om-list-head"><h3>Apps</h3><span class="om-list-count">' + S.forge.length + '</span></div><div class="om-list-scroll">' + (S.forge.length ? S.forge.map(forgeCard).join('') : '<div class="om-empty">No Forge apps exist.</div>') + '</div></section><div class="om-empty">Select a real app or start an interview.</div></div></section>';
      bindForge();
      return;
    }
    var stage = S.forgeStage || realForgeStage(detail.state.mode);
    S.forgeStage = stage;
    var artifact = S.forgeArtifacts.slice().reverse().find(function (item) { return item.deploy; }) || null;
    var pane = stage === 'Interview' ? forgeInterview(detail) : stage === 'AppSpec' ? forgeSpec(detail) : stage === 'Build' ? forgeBuild(detail) : stage === 'Run' ? forgeRun(detail) : stage === 'Revise' ? forgeRevise() : forgeExpose();
    screen.innerHTML = '<section class="om-screen">' + hero({ kicker: 'Workspace', status: S.forge.filter(function (item) { return item.mode === 'done'; }).length + ' running', live: detail.state.mode === 'building' || detail.state.mode === 'deploying' || detail.state.mode === 'done', summary: S.forge.length + ' apps · state ' + forgeModeLabel(detail.state.mode), title: 'Forge', description: 'Interview to running app — separate from the planner, coder and reviewer loop.', actions: actions }) +
      '<div class="om-forge-layout"><section class="om-council-list"><div class="om-list-head"><h3>Apps</h3><span class="om-list-count">' + S.forge.length + '</span></div><div class="om-list-scroll">' + S.forge.map(forgeCard).join('') + '</div></section><section class="om-forge-main"><div class="om-panel om-forge-header"><div class="om-forge-header-top"><div class="om-forge-title"><span class="om-section-label">App</span>' + chip(forgeModeLabel(detail.state.mode)) + '<h3>' + esc(detail.spec.meta.title || detail.spec.meta.name || detail.state.runId) + '</h3></div><div class="om-forge-head-stats"><div class="om-stat"><label>Port</label><strong>' + esc(artifact ? artifact.deploy.port : '—') + '</strong></div><div class="om-stat"><label>Uptime</label><strong>—</strong></div><div class="om-stat"><label>Revisions</label><strong>' + S.forgeArtifacts.length + '</strong></div></div></div><div class="om-stage-rail">' + forgeStages(detail.state.mode) + '</div></div>' + pane + '</section></div></section>';
    bindForge();
  }
  async function loadForge() {
    var list = await post('/ultraapp/list', {});
    S.forge = list.runs || [];
    if (!S.forgeId || !S.forge.some(function (item) { return item.runId === S.forgeId; })) S.forgeId = S.forge[0] ? S.forge[0].runId : null;
    S.forgeDetail = null;
    S.forgeArtifacts = [];
    if (S.forgeId) {
      sessionStorage.setItem('clawo-forge', S.forgeId);
      var data = await Promise.all([post('/ultraapp/' + encodeURIComponent(S.forgeId), {}), post('/ultraapp/' + encodeURIComponent(S.forgeId) + '/artifacts', {})]);
      S.forgeDetail = data[0];
      S.forgeArtifacts = data[1].artifacts || [];
      if (!S.forgeStage) S.forgeStage = realForgeStage(S.forgeDetail.state.mode);
      openForgeStream();
    }
    S.lastSync = new Date().toISOString();
  }
  function openForgeStream() {
    if (S.forgeStream) S.forgeStream.close();
    if (!S.forgeId) return;
    var source = new EventSource('/ultraapp/' + encodeURIComponent(S.forgeId) + '/events');
    S.forgeStream = source;
    source.onopen = function () { setConnection('online'); };
    source.onerror = function () { setConnection('degraded'); };
    source.addEventListener('ultraapp', async function (event) {
      var data = JSON.parse(event.data);
      S.forgeEvents.push(data);
      if (S.forgeEvents.length > 250) S.forgeEvents.splice(0, S.forgeEvents.length - 250);
      if (data.type === 'spec-updated' && S.forgeDetail) S.forgeDetail.spec = data.spec;
      try {
        var detail = await post('/ultraapp/' + encodeURIComponent(S.forgeId), {});
        S.forgeDetail = detail;
        if (data.type === 'build-event' || data.type === 'app-url') {
          var artifacts = await post('/ultraapp/' + encodeURIComponent(S.forgeId) + '/artifacts', {});
          S.forgeArtifacts = artifacts.artifacts || [];
        }
      } catch (_) {}
      if (S.screen === 'forge') renderForge();
    });
  }
  function bindForge() {
    screen.querySelectorAll('[data-action="select-forge"]').forEach(function (button) {
      button.onclick = async function () { S.forgeId = button.dataset.forge; S.forgeStage = null; await loadForge(); renderForge(); };
    });
    screen.querySelectorAll('[data-action="forge-stage"]').forEach(function (button) { button.onclick = function () { S.forgeStage = button.dataset.stage; renderForge(); }; });
    screen.querySelectorAll('[data-action="new-forge"]').forEach(function (button) {
      button.onclick = function () {
        openDialog('New app', 'Forge creates a real run and begins its interview.', '<div class="om-empty">The server creates the run first; answer its real interview in the next screen.</div>', async function () {
          var result = await post('/ultraapp/new', {});
          closeDialog();
          S.forgeId = result.runId;
          S.forgeStage = 'Interview';
          toast('Interview started for ' + result.runId);
          await loadForge();
          renderForge();
        });
      };
    });
    var answer = document.getElementById('forgeAnswer');
    if (answer) {
      var text = document.getElementById('forgeAnswerText');
      text.onkeydown = function (event) { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); answer.requestSubmit(); } };
      answer.onsubmit = async function (event) {
        event.preventDefault();
        var value = text.value.trim();
        if (!value) { toast('Type an answer first'); return; }
        event.submitter.disabled = true;
        try { await post('/ultraapp/' + encodeURIComponent(S.forgeId) + '/answer', { value: '', freeform: value }); text.value = ''; toast('Answer recorded for ' + S.forgeId); }
        catch (error) { toast(error.message); event.submitter.disabled = false; }
      };
    }
    var save = screen.querySelector('[data-action="save-spec"]');
    if (save) save.onclick = async function () {
      try {
        var spec = JSON.parse(document.getElementById('forgeSpecJson').value);
        await post('/ultraapp/' + encodeURIComponent(S.forgeId) + '/spec-edit', { patch: [{ op: 'replace', path: '', value: spec }] });
        toast('Saved AppSpec for ' + S.forgeId);
      } catch (error) { toast(error.message); }
    };
    var build = screen.querySelector('[data-action="forge-build"]');
    if (build) build.onclick = async function () { build.disabled = true; try { await post('/ultraapp/' + encodeURIComponent(S.forgeId) + '/build', {}); toast('Build queued for ' + S.forgeId); } catch (error) { toast(error.message); build.disabled = false; } };
    var cancel = screen.querySelector('[data-action="forge-cancel"]');
    if (cancel) cancel.onclick = async function () { try { await post('/ultraapp/' + encodeURIComponent(S.forgeId) + '/build/cancel', {}); toast('Cancelled build for ' + S.forgeId); } catch (error) { toast(error.message); } };
    var clear = screen.querySelector('[data-action="clear-forge-events"]');
    if (clear) clear.onclick = function () { S.forgeEvents = []; toast('Cleared local build log only'); renderForge(); };
    ['start', 'stop'].forEach(function (action) {
      var button = screen.querySelector('[data-action="forge-' + action + '"]');
      if (button) button.onclick = async function () { button.disabled = true; try { await post('/ultraapp/' + encodeURIComponent(S.forgeId) + '/' + action, {}); toast(titleCase(action) + ' requested for ' + S.forgeId); await loadForge(); renderForge(); } catch (error) { toast(error.message); button.disabled = false; } };
    });
    var feedback = document.getElementById('forgeFeedback');
    if (feedback) feedback.onsubmit = async function (event) {
      event.preventDefault();
      var text = document.getElementById('forgeFeedbackText');
      var value = text.value.trim();
      if (!value) { toast('Describe the revision first'); return; }
      event.submitter.disabled = true;
      try { await post('/ultraapp/' + encodeURIComponent(S.forgeId) + '/feedback', { text: value }); text.value = ''; toast('Revision queued from your feedback'); }
      catch (error) { toast(error.message); event.submitter.disabled = false; }
    };
    screen.querySelectorAll('[data-action="promote-version"]').forEach(function (button) {
      button.onclick = function () {
        openDialog('Promote version', 'This changes the deployed Forge version.', '<div class="om-panel" style="padding:13px 15px"><strong>' + esc(button.dataset.version) + '</strong></div>', async function () {
          await post('/ultraapp/' + encodeURIComponent(S.forgeId) + '/promote-version', { version: button.dataset.version });
          closeDialog();
          toast('Promoted ' + button.dataset.version);
          await loadForge();
          renderForge();
        });
      };
    });
    var copy = screen.querySelector('[data-action="copy-forge-url"]');
    if (copy) copy.onclick = function () {
      var artifact = S.forgeArtifacts.slice().reverse().find(function (item) { return item.deploy; });
      if (artifact) copyText(artifact.deploy.url, 'Copied ' + artifact.deploy.url);
    };
    var exposeView = screen.querySelector('[data-action="forge-expose-view"]');
    if (exposeView) exposeView.onclick = function () { S.forgeStage = 'Expose'; renderForge(); };
  }

  async function loadAutoloop() {
    var list = await api('/autoloop/list');
    S.runs = list.runs || [];
    if (!S.runId || !S.runs.some(function (run) { return run.run_id === S.runId; })) S.runId = S.runs[0] ? S.runs[0].run_id : null;
    if (!S.runId) { S.run = null; S.history = null; S.chat = []; return; }
    sessionStorage.setItem('clawo-run', S.runId);
    var id = encodeURIComponent(S.runId);
    var data = await Promise.all([api('/autoloop/' + id + '/state'), api('/autoloop/' + id + '/iterations'), api('/autoloop/' + id + '/chat_history'), api('/autoloop/' + id + '/push_log')]);
    S.run = data[0].state;
    S.history = data[1];
    S.chat = data[2].entries || [];
    S.pushes = data[3].entries || [];
    S.lastSync = new Date().toISOString();
    openStream();
  }
  async function loadModels(force) {
    S.registry = await api('/models/registry' + (force ? '?refresh=1' : ''));
    if (!S.modelId || !S.registry.models.some(function (model) { return model.id === S.modelId; })) S.modelId = S.registry.models[0] ? S.registry.models[0].id : null;
    S.lastSync = new Date().toISOString();
  }
  function closeStream() {
    clearTimeout(S.retry);
    if (S.stream) S.stream.close();
    if (S.sessionStream) S.sessionStream.close();
    S.stream = null;
    S.sessionStream = null;
    S.councilStream = null;
    S.forgeStream = null;
  }
  function openStream() {
    closeStream();
    if (!S.runId) return;
    var source = new EventSource('/autoloop/' + encodeURIComponent(S.runId) + '/events');
    S.stream = source;
    source.onopen = function () { S.failures = 0; setConnection('online'); };
    source.onerror = function () {
      setConnection('degraded');
      source.close();
      S.retry = setTimeout(async function () {
        try { await loadAutoloop(); renderAutoloop(); }
        catch (_) { setConnection('offline'); }
      }, Math.min(15000, 1000 * Math.pow(2, Math.min(S.failures++, 4))));
    };
    source.addEventListener('snapshot', function (event) { var data = JSON.parse(event.data); if (data.state) S.run = Object.assign({}, S.run || {}, data.state); S.lastSync = new Date().toISOString(); renderAutoloop(); });
    source.addEventListener('state', function (event) { S.run = Object.assign({}, S.run || {}, JSON.parse(event.data)); S.lastSync = new Date().toISOString(); renderAutoloop(); });
    source.addEventListener('message', function (event) {
      var message = JSON.parse(event.data);
      if (S.run && S.run.role_activity && S.run.role_activity[message.to]) { S.run.role_activity[message.to].status = 'working'; S.run.role_activity[message.to].last_activity_at = Date.now(); }
      renderAutoloop();
    });
    ['planner_reply', 'coder_reply', 'reviewer_reply', 'iter_done'].forEach(function (name) {
      source.addEventListener(name, async function () { try { await loadAutoloop(); renderAutoloop(); } catch (_) {} });
    });
  }

  async function activate(name) {
    closeStream();
    S.screen = name;
    screen.dataset.activeScreen = name;
    sessionStorage.setItem('clawo-screen', name);
    document.querySelectorAll('.om-nav-target').forEach(function (button) { if (button.dataset.screen === name) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
    renderLoading();
    try {
      if (name === 'autoloop') { await loadAutoloop(); renderAutoloop(); }
      else if (name === 'models') { await loadModels(false); renderModels(); }
      else if (name === 'sessions') { await loadSessions(); renderSessions(); }
      else if (name === 'council') { await loadCouncils(); renderCouncils(); }
      else { await loadForge(); renderForge(); }
      S.failures = 0;
      setConnection('online');
    } catch (error) {
      S.failures++;
      setConnection(S.failures > 2 ? 'offline' : 'degraded');
      screen.innerHTML = '<section class="om-screen">' + hero({ kicker: 'Control plane', status: 'Unavailable', live: false, summary: 'Last sync ' + relative(S.lastSync), title: titleCase(name), description: 'The control-plane request failed.' }) + '<div class="om-workspace">' + panelError(error.message) + '</div></section>';
      bindCommon();
    }
  }

  function bindCommon() {
    screen.querySelectorAll('[data-action="retry"]').forEach(function (button) { button.onclick = function () { activate(S.screen); }; });
    screen.querySelectorAll('[data-action="new-run"]').forEach(function (button) { button.onclick = newRun; });
  }
  function bindAutoloop() {
    bindCommon();
    screen.querySelectorAll('[data-action="toggle-iteration"]').forEach(function (button) {
      button.onclick = function () { var id = Number(button.dataset.iteration); S.expanded[id] = button.getAttribute('aria-expanded') !== 'true'; renderAutoloop(); };
    });
    var collapse = screen.querySelector('[data-action="collapse-all"]');
    if (collapse) collapse.onclick = function () { (S.history ? S.history.iterations : []).forEach(function (item) { S.expanded[item.iteration] = false; }); renderAutoloop(); };
    var toggle = screen.querySelector('[data-action="toggle-run"]');
    if (toggle) toggle.onclick = async function () {
      toggle.disabled = true;
      try {
        var resume = S.run.status === 'paused' || S.run.status === 'terminated';
        await post('/autoloop/' + encodeURIComponent(S.run.run_id) + '/' + (resume ? 'resume' : 'pause'), {});
        toast((resume ? 'Resumed ' : 'Paused ') + S.run.run_id);
        await loadAutoloop();
        renderAutoloop();
      } catch (error) { toast(error.message); toggle.disabled = false; }
    };
    screen.querySelectorAll('[data-action="choose-option"]').forEach(function (button) {
      button.onclick = async function () { try { await post('/autoloop/' + encodeURIComponent(S.runId) + '/chat', { text: button.dataset.option }); toast('Sent ' + button.dataset.option + ' to ' + S.runId); } catch (error) { toast(error.message); } };
    });
    var form = document.getElementById('directiveForm');
    if (form) {
      var directiveInput = document.getElementById('directiveInput');
      directiveInput.onkeydown = function (event) {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); form.requestSubmit(); }
      };
      form.onsubmit = async function (event) {
      event.preventDefault();
      var input = document.getElementById('directiveInput');
      var value = input.value.trim();
      if (!value) { toast('Type a directive first'); return; }
      event.submitter.disabled = true;
      try { await post('/autoloop/' + encodeURIComponent(S.runId) + '/chat', { text: value }); input.value = ''; toast('Sent directive to ' + S.runId); }
      catch (error) { toast(error.message); }
      finally { event.submitter.disabled = false; }
      };
    }
  }
  function newRun() {
    openDialog('New Autoloop', 'Create a real run against an existing workspace.', '<label class="om-detail-group"><span class="om-section-label">Workspace</span><input class="om-input" name="workspace" required placeholder="C:\\Dev\\Repository"></label><label class="om-detail-group"><span class="om-section-label">Run ID</span><input class="om-input" name="run_id" placeholder="optional"></label><label class="om-detail-group"><span class="om-section-label">Routing preset</span><select class="om-input" name="routing"><option value="best" selected>Best balance — Opus 5 / Gemini 3.7 Flash / GPT-5.6 Sol</option><option value="gemini-exhausted">Gemini exhausted — Opus 5 / Sonnet 5 / GPT-5.6 Sol</option><option value="claude-only">Claude-only compatibility — Opus 5 / Sonnet 5 / Opus 5</option></select><small class="om-muted">Planner → Coder → Reviewer. Availability depends on your authenticated provider accounts.</small></label>', async function (form) {
      var body = { workspace: String(form.get('workspace') || '').trim() };
      var id = String(form.get('run_id') || '').trim();
      if (id) body.run_id = id;
      var routing = String(form.get('routing') || 'best');
      var presets = {
        best: { planner_engine: 'claude', planner_model: 'claude-opus-5', coder_engine: 'agy', coder_model: 'gemini-3.7-flash-medium', reviewer_engine: 'codex', reviewer_model: 'gpt-5.6-sol' },
        'gemini-exhausted': { planner_engine: 'claude', planner_model: 'claude-opus-5', coder_engine: 'claude', coder_model: 'claude-sonnet-5', reviewer_engine: 'codex', reviewer_model: 'gpt-5.6-sol' },
        'claude-only': { planner_engine: 'claude', planner_model: 'claude-opus-5', coder_engine: 'claude', coder_model: 'claude-sonnet-5', reviewer_engine: 'claude', reviewer_model: 'claude-opus-5' }
      };
      Object.assign(body, presets[routing] || presets.best);
      var result = await post('/autoloop/new', body);
      closeDialog();
      S.runId = result.run_id;
      toast('Started ' + result.run_id);
      await activate('autoloop');
    });
  }
  function bindModels() {
    bindCommon();
    document.getElementById('modelFilter').oninput = function (event) { S.query = event.target.value; renderModels(); };
    screen.querySelectorAll('[data-action="provider"]').forEach(function (button) { button.onclick = function () { S.provider = button.dataset.provider; renderModels(); }; });
    screen.querySelectorAll('[data-action="toggle-patched"]').forEach(function (button) { button.onclick = function () { S.patched = !S.patched; renderModels(); }; });
    screen.querySelectorAll('[data-action="toggle-gated"]').forEach(function (button) { button.onclick = function () { S.hideGated = !S.hideGated; renderModels(); }; });
    screen.querySelectorAll('[data-action="model-sort"]').forEach(function (button) { button.onclick = function () { S.sort = button.dataset.sort; renderModels(); }; });
    screen.querySelectorAll('[data-action="select-model"]').forEach(function (button) {
      button.onclick = function (event) {
        var copy = event.target.closest('[data-action="copy-model"]');
        if (copy) { event.stopPropagation(); copyText(copy.dataset.model, 'Copied ' + copy.dataset.model); return; }
        S.modelId = button.dataset.model;
        sessionStorage.setItem('clawo-model', S.modelId);
        renderModels();
      };
    });
    var refresh = screen.querySelector('[data-action="refresh-models"]');
    if (refresh) refresh.onclick = async function () { refresh.disabled = true; try { await loadModels(true); toast('Registry refreshed from ' + S.registry.source); renderModels(); } catch (error) { toast(error.message); refresh.disabled = false; } };
    var copy = screen.querySelector('[data-action="copy-selected-model"]');
    if (copy) copy.onclick = function () { if (S.modelId) copyText(S.modelId, 'Copied ' + S.modelId); };
    var footer = screen.querySelector('.om-model-detail-actions');
    if (footer && !footer.querySelector('[data-action="copy-model-command"]')) {
      var commandButton = document.createElement('button');
      commandButton.className = 'om-btn om-btn-secondary';
      commandButton.dataset.action = 'copy-model-command';
      commandButton.textContent = 'Copy command';
      commandButton.onclick = function () { if (S.modelId) copyText('clawo session-start --model ' + S.modelId, 'Copied the session command'); };
      footer.insertBefore(commandButton, footer.firstChild);
    }
    var create = screen.querySelector('[data-action="new-model-session"]');
    if (create) create.onclick = function () { newSession(create.dataset.model); };
  }
  async function copyText(value, message) {
    try { await navigator.clipboard.writeText(value); toast(message); }
    catch (_) { toast('Clipboard blocked — select and copy the visible identifier'); }
  }
  function newSession(modelId) {
    var model = S.registry.models.find(function (entry) { return entry.id === modelId; });
    openDialog('New session', 'Spawn the selected model against a real working directory.', '<div class="om-panel" style="padding:11px 13px"><span class="om-mono">' + esc(modelId) + '</span></div><label class="om-detail-group"><span class="om-section-label">Working directory</span><input class="om-input" name="cwd" required placeholder="C:\\Dev\\Repository"></label><label class="om-detail-group"><span class="om-section-label">Session name</span><input class="om-input" name="name" required></label>', async function (form) {
      var result = await post('/session/start', { name: String(form.get('name') || '').trim(), cwd: String(form.get('cwd') || '').trim(), engine: model.engine, model: model.id });
      closeDialog();
      toast('Started ' + result.name + ' on ' + model.id);
      await activate('sessions');
    });
  }

  document.querySelectorAll('.om-nav-target').forEach(function (button) { button.onclick = function () { activate(button.dataset.screen); }; });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !dialogRoot.hidden) closeDialog();
    if (!event.ctrlKey && !event.metaKey && !event.altKey && /^[1-5]$/.test(event.key) && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
      activate(['autoloop', 'sessions', 'council', 'forge', 'models'][Number(event.key) - 1]);
    }
    if (event.key === '/' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) {
      var filter = document.getElementById('modelFilter');
      if (filter) { event.preventDefault(); filter.focus(); }
    }
    if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void activate('models').then(function () {
        var filter = document.getElementById('modelFilter');
        if (filter) filter.focus();
      });
    }
  });
  setInterval(function () {
    document.querySelectorAll('[data-relative]').forEach(function (node) { node.textContent = relative(node.dataset.relative); });
    document.querySelectorAll('[data-elapsed]').forEach(function (node) { node.textContent = elapsed(node.dataset.elapsed); });
  }, 1000);
  setInterval(async function () {
    try { await api('/health'); S.failures = 0; setConnection('online'); }
    catch (_) { S.failures++; setConnection(S.failures > 2 ? 'offline' : 'degraded'); }
  }, 10000);
  activate(S.screen);
})();
