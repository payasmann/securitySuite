// ─── SafeGuard Dashboard Client JS ─────────────────────

(function() {
  'use strict';

  var App = {};
  var ws = null;
  var wsReconnectTimer = null;
  var alertState = { filter: 'all', offset: 0, limit: 30, total: 0 };
  var cameraLayout = 'grid';
  var assignableRoles = [];
  var settingsSaveTimer = null;

  // ─── Fetch Helpers ──────────────────────────────────

  function api(method, url, body) {
    var opts = {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin'
    };
    if (body) {
      opts.body = JSON.stringify(body);
    }
    return fetch(url, opts).then(function(res) {
      if (res.status === 401) {
        window.location.href = '/login';
        return Promise.reject(new Error('Unauthorized'));
      }
      return res.json().then(function(data) {
        if (!res.ok) {
          return Promise.reject(new Error(data.error || 'Request failed'));
        }
        return data;
      });
    });
  }

  function get(url) { return api('GET', url); }
  function post(url, body) { return api('POST', url, body); }
  function patch(url, body) { return api('PATCH', url, body); }
  function del(url) { return api('DELETE', url); }

  // ─── WebSocket ──────────────────────────────────────

  function connectWS() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    var url = proto + '//' + location.host + '/ws';

    try {
      ws = new WebSocket(url);
    } catch (e) {
      scheduleReconnect();
      return;
    }

    ws.onopen = function() {
      console.log('[WS] Connected');
      if (wsReconnectTimer) {
        clearTimeout(wsReconnectTimer);
        wsReconnectTimer = null;
      }
    };

    ws.onmessage = function(evt) {
      try {
        var messages = evt.data.split('\n');
        messages.forEach(function(raw) {
          if (!raw.trim()) return;
          var msg = JSON.parse(raw);
          handleWSEvent(msg);
        });
      } catch (e) {
        console.warn('[WS] Parse error:', e);
      }
    };

    ws.onclose = function() {
      console.log('[WS] Disconnected');
      scheduleReconnect();
    };

    ws.onerror = function() {
      ws.close();
    };
  }

  function scheduleReconnect() {
    if (!wsReconnectTimer) {
      wsReconnectTimer = setTimeout(function() {
        wsReconnectTimer = null;
        connectWS();
      }, 3000);
    }
  }

  function handleWSEvent(msg) {
    switch (msg.event) {
      case 'alert:new':
        onNewAlert(msg.data);
        break;
      case 'camera:statusChange':
        onCameraStatusChange(msg.data);
        break;
      case 'dashboard:update':
        onDashboardUpdate(msg.data);
        break;
      case 'motion:detected':
        onMotionDetected(msg.data);
        break;
      case 'bridge:status':
        // Could update bridge indicator
        break;
    }
  }

  function onNewAlert(data) {
    // Update alert badge
    var badge = document.getElementById('alert-badge');
    if (badge) {
      var count = parseInt(badge.textContent || '0', 10) + 1;
      badge.textContent = count;
      badge.classList.remove('hidden');
    }
    // Refresh alerts list if on alerts page
    var alertList = document.getElementById('alert-list');
    if (alertList) {
      App.loadAlerts();
    }
  }

  function onCameraStatusChange(data) {
    // Update camera status pill if visible
    var statusEl = document.querySelector('[data-camera-db-id="' + data.cameraDatabaseId + '"] .camera-status');
    if (statusEl) {
      statusEl.className = 'camera-status pill pill-' + data.status.toLowerCase();
      statusEl.textContent = data.status;
    }
  }

  function onDashboardUpdate(data) {
    if (data.stats) {
      updateStatCards(data.stats);
    }
  }

  function onMotionDetected(data) {
    // Flash the camera card
    var flash = document.querySelector('[data-camera-db-id="' + data.cameraDatabaseId + '"] .motion-flash');
    if (flash) {
      flash.classList.add('active');
      setTimeout(function() { flash.classList.remove('active'); }, 1000);
    }
  }

  // ─── Live Clock ─────────────────────────────────────

  function startClock() {
    var el = document.getElementById('live-clock');
    if (!el) return;

    function tick() {
      var now = new Date();
      el.textContent = now.toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    }
    tick();
    setInterval(tick, 1000);
  }

  // ─── Login ──────────────────────────────────────────

  function setupLoginForm() {
    var form = document.getElementById('login-form');
    if (!form) return;

    form.addEventListener('submit', function(e) {
      e.preventDefault();
      var btn = document.getElementById('login-btn');
      var errorEl = document.getElementById('login-error');
      var email = form.querySelector('[name="email"]').value;
      var password = form.querySelector('[name="password"]').value;

      btn.disabled = true;
      btn.textContent = 'Signing in...';
      errorEl.classList.add('hidden');

      post('/api/auth/login', { email: email, password: password })
        .then(function(data) {
          window.location.href = data.redirect || '/';
        })
        .catch(function(err) {
          errorEl.textContent = err.message || 'Invalid email or password';
          errorEl.classList.remove('hidden');
          btn.disabled = false;
          btn.textContent = 'Sign In';
        });
    });
  }

  // ─── Logout ─────────────────────────────────────────

  App.logout = function() {
    post('/api/auth/logout', {}).then(function() {
      window.location.href = '/login';
    }).catch(function() {
      window.location.href = '/login';
    });
  };

  // ─── Dashboard ──────────────────────────────────────

  App.loadDashboard = function() {
    var schoolId = window.__SCHOOL_ID__;
    if (!schoolId) return;

    get('/api/dashboard/stats?schoolId=' + schoolId).then(function(data) {
      updateStatCards(data.stats);
      renderMotionBars(data.motionByCamera);
      renderZones(data.zones);
      renderRecentActivity(data.recentActivity);
    }).catch(function(err) {
      console.error('[Dashboard] Load error:', err);
    });
  };

  function updateStatCards(stats) {
    setText('stat-cameras', stats.camerasOnline + '/' + stats.camerasTotal);
    setText('stat-alerts', String(stats.activeAlerts));
    setText('stat-motion', String(stats.motionEvents));
    if (stats.storageFree) {
      setText('stat-storage', stats.storageUsed + '% (' + stats.storageFree + ' free)');
    }
  }

  function renderMotionBars(bars) {
    var container = document.getElementById('motion-bars');
    if (!container || !bars) return;

    if (bars.length === 0) {
      container.innerHTML = '<div class="text-text-muted text-sm">No motion detected in the last 60 minutes</div>';
      return;
    }

    var maxCount = Math.max.apply(null, bars.map(function(b) { return b.count; }));

    container.innerHTML = bars.map(function(bar) {
      var pct = maxCount > 0 ? Math.round((bar.count / maxCount) * 100) : 0;
      return '<div class="motion-bar-container">' +
        '<span class="motion-bar-label" title="' + esc(bar.cameraName) + '">' + esc(bar.cameraId) + '</span>' +
        '<div class="motion-bar-track"><div class="motion-bar-fill" style="width:' + pct + '%"></div></div>' +
        '<span class="motion-bar-value">' + bar.count + '</span>' +
        '</div>';
    }).join('');
  }

  function renderZones(zones) {
    var container = document.getElementById('zones');
    if (!container || !zones) return;

    if (zones.length === 0) {
      container.innerHTML = '<div class="text-text-muted text-sm">No zones configured</div>';
      return;
    }

    container.innerHTML = zones.map(function(z) {
      var statusClass = 'pill-online';
      if (z.status === 'Motion') statusClass = 'pill-info';
      if (z.status === 'Alert') statusClass = 'pill-alert';
      return '<div class="zone-item">' +
        '<span class="text-sm">' + esc(z.name) + '</span>' +
        '<span class="pill ' + statusClass + '">' + esc(z.status) + '</span>' +
        '</div>';
    }).join('');
  }

  function renderRecentActivity(items) {
    var container = document.getElementById('recent-activity');
    if (!container || !items) return;

    if (items.length === 0) {
      container.innerHTML = '<div class="text-text-muted text-sm">No recent activity</div>';
      return;
    }

    container.innerHTML = items.map(function(item) {
      var typeClass = 'status-dot-online';
      if (item.type === 'critical') typeClass = 'status-dot-alert';
      if (item.type === 'warning') typeClass = 'status-dot-warning';
      return '<div class="flex items-center gap-3 py-2 border-b border-border/50 last:border-0">' +
        '<span class="' + typeClass + '"></span>' +
        '<span class="timestamp w-12">' + esc(item.time) + '</span>' +
        '<span class="text-sm flex-1">' + esc(item.message) + '</span>' +
        '</div>';
    }).join('');
  }

  // ─── Cameras ────────────────────────────────────────

  App.loadCameras = function() {
    get('/api/cameras').then(function(data) {
      renderCameraGrid(data.cameras || []);
    }).catch(function(err) {
      console.error('[Cameras] Load error:', err);
    });
  };

  function renderCameraGrid(cameras) {
    var container = document.getElementById('camera-grid');
    if (!container) return;

    if (cameras.length === 0) {
      container.innerHTML = '<div class="text-text-muted text-sm col-span-full text-center py-8">No cameras found</div>';
      return;
    }

    if (cameraLayout === 'list') {
      container.className = 'space-y-2';
    } else {
      container.className = 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4';
    }

    container.innerHTML = cameras.map(function(cam) {
      var statusPill = getStatusPill(cam.status);
      return '<div class="camera-card" data-camera-db-id="' + esc(cam.id) + '">' +
        '<div class="camera-feed">' +
        '<div class="motion-flash"></div>' +
        '<div class="flex flex-col items-center gap-1">' +
        '<svg class="w-8 h-8 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>' +
        '<span class="text-xs">Live Feed</span>' +
        '</div>' +
        '</div>' +
        '<div class="p-3 flex items-center justify-between">' +
        '<div>' +
        '<div class="text-sm font-medium">' + esc(cam.name) + '</div>' +
        '<div class="camera-id">' + esc(cam.cameraId) + ' &middot; ' + esc(cam.zone) + '</div>' +
        '</div>' +
        '<span class="camera-status ' + statusPill.cls + '">' + cam.status + '</span>' +
        '</div>' +
        '</div>';
    }).join('');
  }

  App.setCameraLayout = function(layout) {
    cameraLayout = layout;
    document.querySelectorAll('.layout-btn').forEach(function(btn) {
      btn.classList.toggle('active', btn.id === 'btn-' + layout);
    });
    App.loadCameras();
  };

  // ─── Alerts ─────────────────────────────────────────

  App.loadAlerts = function() {
    var params = 'limit=' + alertState.limit + '&offset=' + alertState.offset;

    // Determine school context
    var schoolId = window.__SCHOOL_ID__;
    if (schoolId) {
      params += '&schoolId=' + schoolId;
    }

    if (alertState.filter === 'unresolved') {
      params += '&resolved=false';
    } else if (alertState.filter !== 'all') {
      params += '&type=' + alertState.filter;
    }

    get('/api/alerts?' + params).then(function(data) {
      alertState.total = data.total || 0;
      renderAlertList(data.alerts || []);
      updateAlertPagination();
    }).catch(function(err) {
      console.error('[Alerts] Load error:', err);
    });
  };

  function renderAlertList(alerts) {
    var container = document.getElementById('alert-list');
    if (!container) return;

    if (alerts.length === 0) {
      container.innerHTML = '<div class="text-text-muted text-sm text-center py-8">No alerts found</div>';
      return;
    }

    container.innerHTML = alerts.map(function(a) {
      var resolvedClass = a.resolved ? ' resolved' : '';
      var cameraInfo = a.camera ? (a.camera.name + ' (' + a.camera.cameraId + ')') : '';
      var time = formatTime(a.createdAt);
      var resolveBtn = '';
      if (!a.resolved) {
        resolveBtn = '<button onclick="App.resolveAlert(\'' + a.id + '\')" class="px-2 py-1 rounded text-xs bg-bg-card border border-border hover:border-border-hover transition-colors">Resolve</button>';
      }

      return '<div class="alert-item' + resolvedClass + '">' +
        '<div class="alert-type-indicator ' + a.type + '"></div>' +
        '<div class="flex-1 min-w-0">' +
        '<div class="flex items-center gap-2">' +
        '<span class="' + getAlertPill(a.type) + '">' + a.type + '</span>' +
        (a.resolved ? '<span class="pill pill-online text-[10px]">RESOLVED</span>' : '') +
        '</div>' +
        '<div class="text-sm mt-1">' + esc(a.title) + '</div>' +
        (cameraInfo ? '<div class="camera-id mt-0.5">' + esc(cameraInfo) + '</div>' : '') +
        '</div>' +
        '<div class="flex items-center gap-3 shrink-0">' +
        '<span class="timestamp">' + esc(time) + '</span>' +
        resolveBtn +
        '</div>' +
        '</div>';
    }).join('');
  }

  function updateAlertPagination() {
    var countEl = document.getElementById('alert-count');
    var prevBtn = document.getElementById('alert-prev');
    var nextBtn = document.getElementById('alert-next');

    if (countEl) {
      var from = alertState.total > 0 ? alertState.offset + 1 : 0;
      var to = Math.min(alertState.offset + alertState.limit, alertState.total);
      countEl.textContent = from + '-' + to + ' of ' + alertState.total;
    }
    if (prevBtn) prevBtn.disabled = alertState.offset === 0;
    if (nextBtn) nextBtn.disabled = alertState.offset + alertState.limit >= alertState.total;
  }

  App.filterAlerts = function(filter) {
    alertState.filter = filter;
    alertState.offset = 0;
    document.querySelectorAll('.filter-btn').forEach(function(btn) {
      btn.classList.toggle('active', btn.dataset.filter === filter);
    });
    App.loadAlerts();
  };

  App.prevAlertPage = function() {
    alertState.offset = Math.max(0, alertState.offset - alertState.limit);
    App.loadAlerts();
  };

  App.nextAlertPage = function() {
    if (alertState.offset + alertState.limit < alertState.total) {
      alertState.offset += alertState.limit;
      App.loadAlerts();
    }
  };

  App.resolveAlert = function(id) {
    post('/api/alerts/' + id + '/resolve', {}).then(function() {
      App.loadAlerts();
    }).catch(function(err) {
      alert('Failed to resolve alert: ' + err.message);
    });
  };

  // ─── Management ─────────────────────────────────────

  App.loadManagement = function() {
    get('/api/cameras').then(function(data) {
      renderManagementTable(data.cameras || []);
    }).catch(function(err) {
      console.error('[Management] Load error:', err);
    });
  };

  function renderManagementTable(cameras) {
    var tbody = document.getElementById('management-table-body');
    if (!tbody) return;

    if (cameras.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="px-4 py-8 text-center text-text-muted">No cameras found</td></tr>';
      return;
    }

    tbody.innerHTML = cameras.map(function(cam) {
      var statusPill = getStatusPill(cam.status);
      var lastSeen = cam.lastSeenAt ? formatTime(cam.lastSeenAt) : 'Never';
      return '<tr class="border-b border-border/50 hover:bg-bg-card/50 transition-colors">' +
        '<td class="px-4 py-3 camera-id">' + esc(cam.cameraId) + '</td>' +
        '<td class="px-4 py-3">' + esc(cam.name) + '</td>' +
        '<td class="px-4 py-3 text-text-secondary">' + esc(cam.zone) + '</td>' +
        '<td class="px-4 py-3 text-text-secondary">' + esc(cam.type) + '</td>' +
        '<td class="px-4 py-3 text-text-secondary">' + esc(cam.resolution) + '</td>' +
        '<td class="px-4 py-3"><span class="' + statusPill.cls + '">' + cam.status + '</span></td>' +
        '<td class="px-4 py-3 timestamp">' + esc(lastSeen) + '</td>' +
        '</tr>';
    }).join('');
  }

  // ─── Users ──────────────────────────────────────────

  App.loadUsers = function() {
    get('/api/users').then(function(data) {
      assignableRoles = data.assignableRoles || [];
      renderUserTable(data.users || []);
      populateRoleSelect();
    }).catch(function(err) {
      console.error('[Users] Load error:', err);
    });
  };

  function renderUserTable(users) {
    var tbody = document.getElementById('user-table-body');
    if (!tbody) return;

    if (users.length === 0) {
      var colspan = window.__SCHOOL_ID__ ? '5' : '6';
      tbody.innerHTML = '<tr><td colspan="' + colspan + '" class="px-4 py-8 text-center text-text-muted">No users found</td></tr>';
      return;
    }

    tbody.innerHTML = users.map(function(u) {
      var statusPill = u.active ? '<span class="pill pill-online">Active</span>' : '<span class="pill pill-alert">Inactive</span>';
      var schoolCol = !window.__SCHOOL_ID__ ? '<td class="px-4 py-3 text-text-secondary">' + esc(u.school ? u.school.name : '-') + '</td>' : '';
      var actions = '';
      if (u.active) {
        actions = '<button onclick="App.deactivateUser(\'' + u.id + '\')" class="px-2 py-1 rounded text-xs bg-bg-card border border-border hover:border-status-alert text-status-alert transition-colors">Deactivate</button>';
      } else {
        actions = '<button onclick="App.activateUser(\'' + u.id + '\')" class="px-2 py-1 rounded text-xs bg-bg-card border border-border hover:border-status-online text-status-online transition-colors">Activate</button>';
      }

      return '<tr class="border-b border-border/50 hover:bg-bg-card/50 transition-colors">' +
        '<td class="px-4 py-3">' + esc(u.name) + '</td>' +
        '<td class="px-4 py-3 text-text-secondary">' + esc(u.email) + '</td>' +
        '<td class="px-4 py-3"><span class="pill pill-info text-[10px]">' + esc(u.role) + '</span></td>' +
        schoolCol +
        '<td class="px-4 py-3">' + statusPill + '</td>' +
        '<td class="px-4 py-3">' + actions + '</td>' +
        '</tr>';
    }).join('');
  }

  function populateRoleSelect() {
    var select = document.getElementById('create-user-role');
    if (!select) return;
    select.innerHTML = '<option value="">Select role...</option>';
    assignableRoles.forEach(function(role) {
      var opt = document.createElement('option');
      opt.value = role;
      opt.textContent = role;
      select.appendChild(opt);
    });
  }

  App.showCreateUserModal = function() {
    var modal = document.getElementById('create-user-modal');
    if (modal) {
      modal.classList.remove('hidden');
      var errorEl = document.getElementById('create-user-error');
      if (errorEl) errorEl.classList.add('hidden');

      // Load schools for ops users
      if (!window.__SCHOOL_ID__) {
        loadSchoolsForSelect();
      } else {
        var schoolWrapper = document.getElementById('school-select-wrapper');
        if (schoolWrapper) schoolWrapper.classList.add('hidden');
      }
    }
  };

  App.hideCreateUserModal = function() {
    var modal = document.getElementById('create-user-modal');
    if (modal) modal.classList.add('hidden');
  };

  function loadSchoolsForSelect() {
    get('/api/schools').then(function(data) {
      var select = document.getElementById('create-user-school');
      if (!select) return;
      select.innerHTML = '<option value="">Select school...</option>';
      (data.schools || []).forEach(function(s) {
        var opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.name;
        select.appendChild(opt);
      });
    });
  }

  function setupCreateUserForm() {
    var form = document.getElementById('create-user-form');
    if (!form) return;

    form.addEventListener('submit', function(e) {
      e.preventDefault();
      var errorEl = document.getElementById('create-user-error');
      errorEl.classList.add('hidden');

      var body = {
        name: form.querySelector('[name="name"]').value,
        email: form.querySelector('[name="email"]').value,
        password: form.querySelector('[name="password"]').value,
        role: form.querySelector('[name="role"]').value
      };

      var schoolSelect = form.querySelector('[name="schoolId"]');
      if (schoolSelect && schoolSelect.value) {
        body.schoolId = schoolSelect.value;
      } else if (window.__SCHOOL_ID__) {
        body.schoolId = window.__SCHOOL_ID__;
      }

      post('/api/users', body).then(function() {
        App.hideCreateUserModal();
        form.reset();
        App.loadUsers();
      }).catch(function(err) {
        errorEl.textContent = err.message;
        errorEl.classList.remove('hidden');
      });
    });
  }

  App.deactivateUser = function(id) {
    if (!confirm('Deactivate this user?')) return;
    del('/api/users/' + id).then(function() {
      App.loadUsers();
    }).catch(function(err) {
      alert('Failed: ' + err.message);
    });
  };

  App.activateUser = function(id) {
    patch('/api/users/' + id, { active: true }).then(function() {
      App.loadUsers();
    }).catch(function(err) {
      alert('Failed: ' + err.message);
    });
  };

  // ─── Ops: Schools ───────────────────────────────────

  App.loadOpsSchools = function() {
    get('/api/schools').then(function(data) {
      renderOpsSchoolsTable(data.schools || []);
    });
  };

  function renderOpsSchoolsTable(schools) {
    var tbody = document.getElementById('ops-schools-table');
    if (!tbody) return;

    if (schools.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="px-4 py-8 text-center text-text-muted">No schools found</td></tr>';
      return;
    }

    tbody.innerHTML = schools.map(function(s) {
      var bridgeStatus = s.streamBridge
        ? (s.streamBridge.online ? '<span class="pill pill-online">Online</span>' : '<span class="pill pill-alert">Offline</span>')
        : '<span class="text-text-muted text-xs">N/A</span>';

      var flags = [];
      if (s.flags.localStorage) flags.push('LS');
      if (s.flags.cloudStorage) flags.push('CS');
      if (s.flags.remoteAccess) flags.push('RA');
      if (s.flags.localView) flags.push('LV');

      return '<tr class="border-b border-border/50 hover:bg-bg-card/50 transition-colors">' +
        '<td class="px-4 py-3 font-medium">' + esc(s.name) + '</td>' +
        '<td class="px-4 py-3"><span class="stat-online">' + s.stats.camerasOnline + '</span>/' + s.stats.camerasTotal + '</td>' +
        '<td class="px-4 py-3"><span class="' + (s.stats.alertsCount > 0 ? 'stat-alert' : '') + '">' + s.stats.alertsCount + '</span></td>' +
        '<td class="px-4 py-3">' + s.stats.usersCount + '</td>' +
        '<td class="px-4 py-3">' + bridgeStatus + '</td>' +
        '<td class="px-4 py-3"><span class="text-xs text-text-muted">' + flags.join(', ') + '</span></td>' +
        '<td class="px-4 py-3"><a href="/ops/schools/' + s.id + '" class="text-accent hover:underline text-sm">View</a></td>' +
        '</tr>';
    }).join('');
  }

  App.loadOpsSchoolCards = function() {
    get('/api/schools').then(function(data) {
      renderOpsSchoolCards(data.schools || []);
    });
  };

  function renderOpsSchoolCards(schools) {
    var container = document.getElementById('ops-school-cards');
    if (!container) return;

    if (schools.length === 0) {
      container.innerHTML = '<div class="text-text-muted text-sm col-span-full text-center py-8">No schools found</div>';
      return;
    }

    container.innerHTML = schools.map(function(s) {
      var bridgeDot = s.streamBridge && s.streamBridge.online ? 'status-dot-online' : 'status-dot-alert';
      return '<a href="/ops/schools/' + s.id + '" class="card-hover p-4 block">' +
        '<div class="flex items-center justify-between mb-3">' +
        '<h3 class="font-medium">' + esc(s.name) + '</h3>' +
        '<span class="' + bridgeDot + '"></span>' +
        '</div>' +
        (s.address ? '<div class="text-xs text-text-muted mb-3">' + esc(s.address) + '</div>' : '') +
        '<div class="grid grid-cols-2 gap-2 text-sm">' +
        '<div><span class="text-text-muted">Cameras:</span> <span class="stat-online">' + s.stats.camerasOnline + '</span>/' + s.stats.camerasTotal + '</div>' +
        '<div><span class="text-text-muted">Alerts:</span> <span class="' + (s.stats.alertsCount > 0 ? 'stat-alert' : '') + '">' + s.stats.alertsCount + '</span></div>' +
        '<div><span class="text-text-muted">Users:</span> ' + s.stats.usersCount + '</div>' +
        '<div><span class="text-text-muted">Retention:</span> ' + s.limits.retentionDays + 'd</div>' +
        '</div>' +
        '</a>';
    }).join('');
  }

  // ─── Ops: School Detail ─────────────────────────────

  App.loadOpsSchoolDetail = function(schoolId) {
    get('/api/schools/' + schoolId).then(function(data) {
      var s = data.school;
      setText('school-name', s.name);
      setText('school-cameras', s.cameras.length + ' cameras');
      setText('school-alerts', s.alerts.length + ' active');
      setText('school-users', s.users.length + ' users');

      // Cameras
      var camTbody = document.getElementById('school-detail-cameras');
      if (camTbody) {
        if (s.cameras.length === 0) {
          camTbody.innerHTML = '<tr><td colspan="4" class="px-4 py-4 text-center text-text-muted">No cameras</td></tr>';
        } else {
          camTbody.innerHTML = s.cameras.map(function(c) {
            return '<tr class="border-b border-border/50">' +
              '<td class="px-4 py-2 camera-id">' + esc(c.cameraId) + '</td>' +
              '<td class="px-4 py-2">' + esc(c.name) + '</td>' +
              '<td class="px-4 py-2 text-text-secondary">' + esc(c.zone) + '</td>' +
              '<td class="px-4 py-2"><span class="' + getStatusPill(c.status).cls + '">' + c.status + '</span></td>' +
              '</tr>';
          }).join('');
        }
      }

      // Alerts
      var alertTbody = document.getElementById('school-detail-alerts');
      if (alertTbody) {
        if (s.alerts.length === 0) {
          alertTbody.innerHTML = '<tr><td colspan="4" class="px-4 py-4 text-center text-text-muted">No unresolved alerts</td></tr>';
        } else {
          alertTbody.innerHTML = s.alerts.map(function(a) {
            var cam = a.camera ? a.camera.name : '-';
            return '<tr class="border-b border-border/50">' +
              '<td class="px-4 py-2"><span class="' + getAlertPill(a.type) + '">' + a.type + '</span></td>' +
              '<td class="px-4 py-2">' + esc(a.title) + '</td>' +
              '<td class="px-4 py-2 text-text-secondary">' + esc(cam) + '</td>' +
              '<td class="px-4 py-2 timestamp">' + esc(formatTime(a.createdAt)) + '</td>' +
              '</tr>';
          }).join('');
        }
      }
    }).catch(function(err) {
      console.error('[SchoolDetail] Load error:', err);
    });
  };

  // ─── Ops: School Settings ───────────────────────────

  App.loadOpsSchoolSettings = function(schoolId) {
    window.__SETTINGS_SCHOOL_ID__ = schoolId;

    get('/api/schools/' + schoolId).then(function(data) {
      var s = data.school;
      setText('settings-school-name', s.name);

      setChecked('flag-localStorage', s.localStorageEnabled);
      setChecked('flag-cloudStorage', s.cloudStorageEnabled);
      setChecked('flag-remoteAccess', s.remoteAccessEnabled);
      setChecked('flag-localView', s.localViewEnabled);

      setValue('limit-retentionDays', s.retentionDays);
      setValue('limit-maxCameras', s.maxCameras);
      setValue('limit-maxUsers', s.maxUsers);
    });
  };

  App.saveSettings = function() {
    // Debounce saves
    if (settingsSaveTimer) clearTimeout(settingsSaveTimer);
    settingsSaveTimer = setTimeout(doSaveSettings, 500);
  };

  function doSaveSettings() {
    var schoolId = window.__SETTINGS_SCHOOL_ID__;
    if (!schoolId) return;

    var body = {
      localStorageEnabled: getChecked('flag-localStorage'),
      cloudStorageEnabled: getChecked('flag-cloudStorage'),
      remoteAccessEnabled: getChecked('flag-remoteAccess'),
      localViewEnabled: getChecked('flag-localView'),
      retentionDays: getIntValue('limit-retentionDays'),
      maxCameras: getIntValue('limit-maxCameras'),
      maxUsers: getIntValue('limit-maxUsers')
    };

    var successEl = document.getElementById('settings-success');
    var errorEl = document.getElementById('settings-error');
    successEl.classList.add('hidden');
    errorEl.classList.add('hidden');

    patch('/api/schools/' + schoolId + '/settings', body).then(function() {
      successEl.classList.remove('hidden');
      setTimeout(function() { successEl.classList.add('hidden'); }, 3000);
    }).catch(function(err) {
      errorEl.textContent = err.message;
      errorEl.classList.remove('hidden');
    });
  }

  // ─── Utility Functions ──────────────────────────────

  function esc(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function setChecked(id, val) {
    var el = document.getElementById(id);
    if (el) el.checked = !!val;
  }

  function getChecked(id) {
    var el = document.getElementById(id);
    return el ? el.checked : false;
  }

  function setValue(id, val) {
    var el = document.getElementById(id);
    if (el) el.value = val;
  }

  function getIntValue(id) {
    var el = document.getElementById(id);
    return el ? parseInt(el.value, 10) || 1 : 1;
  }

  function getStatusPill(status) {
    switch (status) {
      case 'ONLINE':  return { cls: 'pill pill-online' };
      case 'OFFLINE': return { cls: 'pill pill-alert' };
      case 'WARNING': return { cls: 'pill pill-warning' };
      default:        return { cls: 'pill' };
    }
  }

  function getAlertPill(type) {
    switch (type) {
      case 'CRITICAL': return 'pill pill-alert';
      case 'WARNING':  return 'pill pill-warning';
      case 'INFO':     return 'pill pill-info';
      default:         return 'pill';
    }
  }

  function formatTime(isoStr) {
    if (!isoStr) return '';
    try {
      var d = new Date(isoStr);
      var now = new Date();
      var diffMs = now - d;
      var diffMin = Math.floor(diffMs / 60000);

      if (diffMin < 1) return 'just now';
      if (diffMin < 60) return diffMin + 'm ago';
      if (diffMin < 1440) return Math.floor(diffMin / 60) + 'h ago';

      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
        ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    } catch (e) {
      return isoStr;
    }
  }

  // ─── Init ───────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', function() {
    startClock();
    setupLoginForm();
    setupCreateUserForm();

    // Connect WebSocket if authenticated (not on login page)
    if (window.__USER__) {
      connectWS();
    }
  });

  // Export
  window.App = App;

})();
