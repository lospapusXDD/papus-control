// PapusControl Client - Motor v2.0 (NVENC 60/120 FPS, Dock Integrado y Gestor Completo de Procesos)
(function () {
  'use strict';

  // Configuración & Estado
  let apiUrl = localStorage.getItem('papus_api_url') || window.location.origin;
  let jwtToken = localStorage.getItem('papus_jwt_token') || '';
  let sensitivity = 2.0;
  let isDragging = false;
  let currentFps = 60;
  let allProcesses = [];
  let currentSort = 'cpu';
  let isCamMode = false;
  let streamTimer = null;
  let recognition = null;
  let isListening = false;

  // Screen resolution (desktop coordinates)
  let desktopW = 1920;
  let desktopH = 1080;

  // DOM Elements
  const statusDot = document.getElementById('statusDot');
  const gpuBadge = document.getElementById('gpuBadge');
  const navTabs = document.querySelectorAll('.nav-tab');
  const viewPanels = document.querySelectorAll('.view-panel');

  // Screen & Integrated Dock Elements
  const visualViewport = document.getElementById('visualViewport');
  const visualFeedImg = document.getElementById('visualFeedImg');
  const liveGpuVideo = document.getElementById('liveGpuVideo');
  const visualEmpty = document.getElementById('visualEmpty');
  const clickRipple = document.getElementById('clickRipple');
  const btnToggleCamMode = document.getElementById('btnToggleCamMode');
  const btnRefreshVisual = document.getElementById('btnRefreshVisual');
  const fpsChips = document.querySelectorAll('.fps-chip');

  const screenTextInput = document.getElementById('screenTextInput');
  const btnScreenSendText = document.getElementById('btnScreenSendText');
  const btnScreenSendEnter = document.getElementById('btnScreenSendEnter');
  const btnScreenMic = document.getElementById('btnScreenMic');
  const btnScreenMouseLeft = document.getElementById('btnScreenMouseLeft');
  const btnScreenMouseRight = document.getElementById('btnScreenMouseRight');
  const btnScreenScrollUp = document.getElementById('btnScreenScrollUp');
  const btnScreenScrollDown = document.getElementById('btnScreenScrollDown');

  // Touchpad Elements
  const phoneTextInput = document.getElementById('phoneTextInput');
  const btnVoiceMic = document.getElementById('btnVoiceMic');
  const btnSendTextPhone = document.getElementById('btnSendTextPhone');
  const btnSendEnterPhone = document.getElementById('btnSendEnterPhone');
  const touchPad = document.getElementById('touchPad');
  const cursorBlob = document.getElementById('cursorBlob');
  const scrollBar = document.getElementById('scrollBar');
  const btnClickLeft = document.getElementById('btnClickLeft');
  const btnClickRight = document.getElementById('btnClickRight');
  const btnToggleDrag = document.getElementById('btnToggleDrag');
  const dragLabel = document.getElementById('dragLabel');

  // Process Manager Elements
  const badgeTotalProcs = document.getElementById('badgeTotalProcs');
  const procSearchInput = document.getElementById('procSearchInput');
  const btnSortCpu = document.getElementById('btnSortCpu');
  const btnSortMem = document.getElementById('btnSortMem');
  const processesTableBody = document.getElementById('processesTableBody');
  const btnRefreshProcesses = document.getElementById('btnRefreshProcesses');

  // TTS, Apps, Shell
  const ttsInput = document.getElementById('ttsInput');
  const btnSendTTS = document.getElementById('btnSendTTS');
  const appsGrid = document.getElementById('appsGrid');
  const btnFetchApps = document.getElementById('btnFetchApps');
  const customAppExec = document.getElementById('customAppExec');
  const btnLaunchCustom = document.getElementById('btnLaunchCustom');
  const terminalScreen = document.getElementById('terminalScreen');
  const shellForm = document.getElementById('shellForm');
  const shellInput = document.getElementById('shellInput');
  const shellPrompt = document.getElementById('shellPrompt');
  const tabShellMode = document.getElementById('tabShellMode');
  const tabSqlMode = document.getElementById('tabSqlMode');
  let isSqlMode = false;

  // Modal Auth
  const authModal = document.getElementById('authModal');
  const btnOpenAuth = document.getElementById('btnOpenAuth');
  const btnCloseAuth = document.getElementById('btnCloseAuth');
  const cfgServerUrl = document.getElementById('cfgServerUrl');
  const cfgNick = document.getElementById('cfgNick');
  const cfgPassword = document.getElementById('cfgPassword');
  const cfgJwt = document.getElementById('cfgJwt');
  const btnLoginApi = document.getElementById('btnLoginApi');
  const btnSaveConfig = document.getElementById('btnSaveConfig');

  // Toast
  const toastBox = document.getElementById('toastBox');
  const toastMessage = document.getElementById('toastMessage');

  function showToast(msg) {
    toastMessage.textContent = msg;
    toastBox.classList.add('visible');
    setTimeout(() => toastBox.classList.remove('visible'), 2400);
  }

  function vibrate(ms = 15) {
    if (navigator.vibrate) {
      try { navigator.vibrate(ms); } catch (e) {}
    }
  }

  // API Fetch Helper con JWT
  async function apiFetch(endpoint, method = 'GET', body = null, isBlob = false) {
    const headers = {};
    if (jwtToken) {
      headers['Authorization'] = jwtToken.startsWith('Bearer ') ? jwtToken : `Bearer ${jwtToken}`;
    }
    if (body && !(body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }

    const fullUrl = `${apiUrl.replace(/\/$/, '')}${endpoint}`;
    const options = { method, headers };
    if (body) {
      options.body = body instanceof FormData ? body : JSON.stringify(body);
    }

    const res = await fetch(fullUrl, options);
    if (!res.ok) {
      const errTxt = await res.text();
      throw new Error(`HTTP ${res.status}: ${errTxt}`);
    }

    return isBlob ? await res.blob() : await res.json();
  }

  // 1. PANTALLA EN VIVO & STREAMING GPU (60 / 120 FPS NVENC)
  function initScreenStream() {
    if (isCamMode) {
      refreshVisualFeed();
      return;
    }

    // Usamos refresco rápido de snapshot o video stream según soporte
    const intervalMs = currentFps >= 120 ? 8 : (currentFps === 60 ? 16 : 33);
    clearInterval(streamTimer);
    refreshVisualFeed();
    streamTimer = setInterval(refreshVisualFeed, intervalMs);
  }

  async function refreshVisualFeed() {
    const endpoint = isCamMode ? '/api/admin/power/webcam' : `/api/admin/power/screenshot?fps=${currentFps}`;
    try {
      const blob = await apiFetch(endpoint, 'GET', null, true);
      const url = URL.createObjectURL(blob);
      visualFeedImg.onload = () => {
        URL.revokeObjectURL(url);
        visualEmpty.style.display = 'none';
        visualFeedImg.style.display = 'block';
      };
      visualFeedImg.src = url;
    } catch (e) {
      visualEmpty.style.display = 'flex';
    }
  }

  // Selector de FPS (30, 60, 120 FPS)
  fpsChips.forEach(chip => {
    chip.addEventListener('click', () => {
      vibrate(15);
      fpsChips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      currentFps = parseInt(chip.dataset.fps, 10);
      showToast(`Stream configurado a ${currentFps} FPS (GTX 1050 Ti NVENC)`);
      initScreenStream();
    });
  });

  btnToggleCamMode.addEventListener('click', () => {
    isCamMode = !isCamMode;
    vibrate(15);
    btnToggleCamMode.classList.toggle('active', isCamMode);
    btnToggleCamMode.innerHTML = isCamMode ? '<i class="fa-solid fa-desktop"></i> Pantalla' : '<i class="fa-solid fa-camera"></i> Webcam';
    refreshVisualFeed();
  });

  btnRefreshVisual.addEventListener('click', () => {
    vibrate(10);
    refreshVisualFeed();
  });

  // CLIC DIRECTO SOBRE LA PANTALLA
  visualViewport.addEventListener('click', (e) => {
    const rect = visualFeedImg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    if (clickX < 0 || clickY < 0 || clickX > rect.width || clickY > rect.height) return;

    // Calcular coordenada exacta en la pantalla de Windows
    const targetX = Math.round((clickX / rect.width) * desktopW);
    const targetY = Math.round((clickY / rect.height) * desktopH);

    // Efecto visual
    const vpRect = visualViewport.getBoundingClientRect();
    clickRipple.style.left = `${e.clientX - vpRect.left}px`;
    clickRipple.style.top = `${e.clientY - vpRect.top}px`;
    clickRipple.classList.remove('animate');
    void clickRipple.offsetWidth;
    clickRipple.classList.add('animate');

    vibrate(20);
    sendMouseAction({ action: 'moveto', x: targetX, y: targetY });
    setTimeout(() => {
      sendMouseAction({ action: 'click', button: 'left' });
    }, 10);
  });

  // DOCK DE CONTROL INTEGRADO EN LA PANTALLA
  function sendScreenTyped(withEnter = false) {
    const text = screenTextInput.value;
    if (!text) return;
    vibrate(15);
    sendMouseAction({ action: 'type', text: withEnter ? text + '\n' : text });
    screenTextInput.value = '';
    showToast('Texto enviado a Windows');
  }

  btnScreenSendText.addEventListener('click', () => sendScreenTyped(false));
  btnScreenSendEnter.addEventListener('click', () => sendScreenTyped(true));
  screenTextInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendScreenTyped(true);
    }
  });

  btnScreenMouseLeft.addEventListener('click', () => {
    vibrate(20);
    sendMouseAction({ action: 'click', button: 'left' });
  });

  btnScreenMouseRight.addEventListener('click', () => {
    vibrate(20);
    sendMouseAction({ action: 'click', button: 'right' });
  });

  btnScreenScrollUp.addEventListener('click', () => {
    vibrate(10);
    sendMouseAction({ action: 'scroll', dy: 2 });
  });

  btnScreenScrollDown.addEventListener('click', () => {
    vibrate(10);
    sendMouseAction({ action: 'scroll', dy: -2 });
  });

  // 2. ADMINISTRADOR DE TODOS LOS PROCESOS (SIN LÍMITE)
  async function fetchAllProcesses() {
    try {
      processesTableBody.innerHTML = '<tr><td colspan="5" class="empty-table">Cargando todos los procesos...</td></tr>';
      const data = await apiFetch(`/api/admin/system/processes?sort=${currentSort}`);
      allProcesses = data.processes || (Array.isArray(data) ? data : []);
      renderFilteredProcesses();
    } catch (e) {
      processesTableBody.innerHTML = '<tr><td colspan="5" class="empty-table">Error al conectar con la API de procesos.</td></tr>';
    }
  }

  function renderFilteredProcesses() {
    const query = procSearchInput.value.toLowerCase().trim();
    let filtered = allProcesses;

    if (query) {
      filtered = allProcesses.filter(p => p.name.toLowerCase().includes(query) || String(p.pid).includes(query));
    }

    badgeTotalProcs.textContent = `${filtered.length} de ${allProcesses.length} procesos`;

    if (filtered.length === 0) {
      processesTableBody.innerHTML = '<tr><td colspan="5" class="empty-table">No se encontraron procesos coincidentes.</td></tr>';
      return;
    }

    processesTableBody.innerHTML = '';
    filtered.forEach(p => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${p.pid}</td>
        <td><strong>${p.name}</strong></td>
        <td>${p.cpu}%</td>
        <td>${p.mem_mb} MB</td>
        <td><button class="btn-kill-proc" data-pid="${p.pid}" data-name="${p.name}">Kill</button></td>
      `;
      processesTableBody.appendChild(tr);
    });

    processesTableBody.querySelectorAll('.btn-kill-proc').forEach(b => {
      b.addEventListener('click', async () => {
        const pid = b.dataset.pid;
        const name = b.dataset.name;
        if (confirm(`¿Forzar finalización de "${name}" (PID: ${pid})?`)) {
          vibrate(25);
          await apiFetch('/api/admin/system/process/kill', 'POST', { pid: parseInt(pid, 10) });
          showToast(`Proceso ${name} terminado`);
          fetchAllProcesses();
        }
      });
    });
  }

  procSearchInput.addEventListener('input', renderFilteredProcesses);

  btnSortCpu.addEventListener('click', () => {
    currentSort = 'cpu';
    btnSortCpu.classList.add('active');
    btnSortMem.classList.remove('active');
    fetchAllProcesses();
  });

  btnSortMem.addEventListener('click', () => {
    currentSort = 'mem';
    btnSortMem.classList.add('active');
    btnSortCpu.classList.remove('active');
    fetchAllProcesses();
  });

  btnRefreshProcesses.addEventListener('click', () => {
    vibrate(10);
    fetchAllProcesses();
  });

  // 3. TOUCHPAD GESTURES
  let lastX = 0, lastY = 0, touchStartT = 0, hasMoved = false;

  touchPad.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    const rect = touchPad.getBoundingClientRect();
    lastX = t.clientX;
    lastY = t.clientY;
    touchStartT = performance.now();
    hasMoved = false;

    cursorBlob.style.display = 'block';
    cursorBlob.style.left = `${t.clientX - rect.left}px`;
    cursorBlob.style.top = `${t.clientY - rect.top}px`;
  }, { passive: false });

  touchPad.addEventListener('touchmove', (e) => {
    e.preventDefault();
    const t = e.touches[0];
    const dx = (t.clientX - lastX) * sensitivity;
    const dy = (t.clientY - lastY) * sensitivity;

    if (Math.hypot(dx, dy) > 2) hasMoved = true;

    if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) {
      sendMouseAction({ action: 'move', dx: Math.round(dx), dy: Math.round(dy) });
    }

    lastX = t.clientX;
    lastY = t.clientY;

    const rect = touchPad.getBoundingClientRect();
    cursorBlob.style.left = `${t.clientX - rect.left}px`;
    cursorBlob.style.top = `${t.clientY - rect.top}px`;
  }, { passive: false });

  touchPad.addEventListener('touchend', (e) => {
    cursorBlob.style.display = 'none';
    const elapsed = performance.now() - touchStartT;
    if (!hasMoved && elapsed < 260) {
      vibrate(20);
      sendMouseAction({ action: 'click', button: 'left' });
    }
  });

  // Scroll Slider
  let lastScrollY = 0;
  scrollBar.addEventListener('touchstart', (e) => { lastScrollY = e.touches[0].clientY; }, { passive: true });
  scrollBar.addEventListener('touchmove', (e) => {
    e.preventDefault();
    const curY = e.touches[0].clientY;
    const diff = curY - lastScrollY;
    if (Math.abs(diff) > 10) {
      sendMouseAction({ action: 'scroll', dy: diff > 0 ? -1 : 1 });
      lastScrollY = curY;
    }
  }, { passive: false });

  async function sendMouseAction(payload) {
    try {
      await apiFetch('/api/admin/system/mouse', 'POST', payload);
    } catch (e) {}
  }

  btnClickLeft.addEventListener('click', () => { vibrate(20); sendMouseAction({ action: 'click', button: 'left' }); });
  btnClickRight.addEventListener('click', () => { vibrate(20); sendMouseAction({ action: 'click', button: 'right' }); });

  btnToggleDrag.addEventListener('click', () => {
    isDragging = !isDragging;
    vibrate(30);
    btnToggleDrag.classList.toggle('active', isDragging);
    dragLabel.textContent = isDragging ? 'ARRASTRANDO' : 'ARRASTRE';
    sendMouseAction({ action: isDragging ? 'mousedown' : 'mouseup', button: 'left' });
  });

  // Enviar texto desde tab Mouse
  function sendPhoneText(withEnter = false) {
    const text = phoneTextInput.value;
    if (!text) return;
    vibrate(15);
    sendMouseAction({ action: 'type', text: withEnter ? text + '\n' : text });
    phoneTextInput.value = '';
    showToast('Texto enviado a Windows');
  }

  btnSendTextPhone.addEventListener('click', () => sendPhoneText(false));
  btnSendEnterPhone.addEventListener('click', () => sendPhoneText(true));

  // Botones de teclas rápidas
  document.querySelectorAll('[data-sendkey]').forEach(btn => {
    btn.addEventListener('click', () => {
      vibrate(15);
      sendMouseAction({ action: 'key', key: btn.dataset.sendkey });
    });
  });

  // 4. RECONOCIMIENTO DE VOZ & MICRÓFONO
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRec) {
    recognition = new SpeechRec();
    recognition.lang = 'es-ES';
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onresult = (e) => {
      const text = e.results[0][0].transcript;
      screenTextInput.value = text;
      phoneTextInput.value = text;
      showToast(`Voz: "${text}"`);
      sendMouseAction({ action: 'type', text: text });
    };

    recognition.onend = () => {
      isListening = false;
      btnScreenMic.classList.remove('recording');
      btnVoiceMic.classList.remove('recording');
    };
  }

  function toggleVoice() {
    if (!recognition) {
      alert('Tu navegador no soporta entrada de voz. Usa Chrome.');
      return;
    }
    vibrate(20);
    if (isListening) {
      recognition.stop();
    } else {
      isListening = true;
      btnScreenMic.classList.add('recording');
      btnVoiceMic.classList.add('recording');
      recognition.start();
    }
  }

  btnScreenMic.addEventListener('click', toggleVoice);
  btnVoiceMic.addEventListener('click', toggleVoice);

  // TTS (Texto a Voz para que la PC hable)
  btnSendTTS.addEventListener('click', async () => {
    const text = ttsInput.value.trim();
    if (!text) return;
    vibrate(15);
    try {
      await apiFetch('/api/admin/system/tts', 'POST', { text: text, lang: 'es' });
      showToast('PC hablando mensaje...');
      ttsInput.value = '';
    } catch (e) {
      showToast('Error en TTS');
    }
  });

  // 5. APPS
  async function fetchApps() {
    try {
      appsGrid.innerHTML = '<div class="loading-apps">Cargando aplicaciones...</div>';
      const apps = await apiFetch('/api/admin/system/apps');
      appsGrid.innerHTML = '';
      apps.forEach(app => {
        const box = document.createElement('div');
        box.className = 'app-box';
        box.innerHTML = `
          <div class="app-box-icon"><i class="fa-solid fa-cube"></i></div>
          <span>${app.name || app.id}</span>
        `;
        box.addEventListener('click', async () => {
          vibrate(20);
          showToast(`Lanzando ${app.name}...`);
          await apiFetch('/api/admin/system/app/launch', 'POST', { id: app.id, exec: app.exec });
        });
        appsGrid.appendChild(box);
      });
    } catch (e) {
      appsGrid.innerHTML = '<div class="loading-apps">Error al obtener apps.</div>';
    }
  }

  btnFetchApps.addEventListener('click', fetchApps);

  btnLaunchCustom.addEventListener('click', async () => {
    const cmd = customAppExec.value.trim();
    if (!cmd) return;
    vibrate(20);
    showToast(`Ejecutando: ${cmd}`);
    try {
      await apiFetch('/api/admin/system/app/launch', 'POST', { exec: cmd });
      customAppExec.value = '';
    } catch (e) {
      showToast('Error al ejecutar');
    }
  });

  // 6. SHELL & SQL
  tabShellMode.addEventListener('click', () => {
    isSqlMode = false;
    tabShellMode.classList.add('active');
    tabSqlMode.classList.remove('active');
    shellPrompt.textContent = 'PS >';
    shellInput.placeholder = 'Comando PowerShell / CMD...';
  });

  tabSqlMode.addEventListener('click', () => {
    isSqlMode = true;
    tabSqlMode.classList.add('active');
    tabShellMode.classList.remove('active');
    shellPrompt.textContent = 'SQL >';
    shellInput.placeholder = 'SELECT * FROM users LIMIT 10;';
  });

  shellForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const cmd = shellInput.value.trim();
    if (!cmd) return;

    vibrate(15);
    appendTerminal(`\n${isSqlMode ? 'SQL' : 'PS'} > ${cmd}`, 'cmd');
    shellInput.value = '';

    try {
      const endpoint = isSqlMode ? '/api/admin/sql' : '/api/admin/shell';
      const payload = isSqlMode ? { query: cmd } : { cmd: cmd };
      const res = await apiFetch(endpoint, 'POST', payload);

      if (isSqlMode) {
        appendTerminal(JSON.stringify(res.rows || res, null, 2));
      } else {
        if (res.stdout) appendTerminal(res.stdout);
        if (res.stderr) appendTerminal(res.stderr, 'err');
      }
    } catch (err) {
      appendTerminal(err.message, 'err');
    }
  });

  function appendTerminal(text, type = 'normal') {
    const row = document.createElement('div');
    row.className = `term-row ${type}`;
    row.textContent = text;
    terminalScreen.appendChild(row);
    terminalScreen.scrollTop = terminalScreen.scrollHeight;
  }

  document.querySelectorAll('.q-cmd').forEach(btn => {
    btn.addEventListener('click', () => {
      shellInput.value = btn.dataset.cmd;
      shellForm.dispatchEvent(new Event('submit'));
    });
  });

  // 7. POWER ACTIONS
  document.querySelectorAll('[data-poweraction]').forEach(btn => {
    btn.addEventListener('click', async () => {
      vibrate(20);
      const action = btn.dataset.poweraction;
      if (action === 'shutdown' && !confirm('¿Apagar la PC en 15 segundos?')) return;

      try {
        if (action === 'screen_off') await apiFetch('/api/admin/power/screen', 'POST', { state: 'off' });
        else if (action === 'suspend') await apiFetch('/api/admin/power/suspend', 'POST', {});
        else if (action === 'shutdown') await apiFetch('/api/admin/power/shutdown', 'POST', {});
        showToast(`Acción "${action}" ejecutada.`);
      } catch (e) {
        showToast('Error al ejecutar');
      }
    });
  });

  // 8. TABS & NAVEGACIÓN
  navTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      vibrate(10);
      navTabs.forEach(t => t.classList.remove('active'));
      viewPanels.forEach(p => p.classList.remove('active'));

      tab.classList.add('active');
      const target = document.getElementById(tab.dataset.tab);
      if (target) target.classList.add('active');

      if (tab.dataset.tab === 'tabMediaCam') initScreenStream();
      else clearInterval(streamTimer);

      if (tab.dataset.tab === 'tabMonitor') fetchAllProcesses();
      if (tab.dataset.tab === 'tabApps') fetchApps();
    });
  });

  // 9. CONFIG & AUTH MODAL
  btnOpenAuth.addEventListener('click', () => {
    cfgServerUrl.value = apiUrl;
    cfgJwt.value = jwtToken;
    authModal.classList.add('open');
  });

  btnCloseAuth.addEventListener('click', () => authModal.classList.remove('open'));

  btnSaveConfig.addEventListener('click', () => {
    apiUrl = cfgServerUrl.value.trim() || window.location.origin;
    jwtToken = cfgJwt.value.trim();
    localStorage.setItem('papus_api_url', apiUrl);
    localStorage.setItem('papus_jwt_token', jwtToken);
    authModal.classList.remove('open');
    showToast('Configuración guardada');
  });

  btnLoginApi.addEventListener('click', async () => {
    const nick = cfgNick.value.trim();
    const password = cfgPassword.value.trim();
    if (!nick || !password) return alert('Ingresa usuario y contraseña');

    try {
      showToast('Autenticando...');
      const targetUrl = cfgServerUrl.value.trim() || apiUrl;
      const res = await fetch(`${targetUrl.replace(/\/$/, '')}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nick, password })
      });
      const data = await res.json();
      if (data.accessToken) {
        jwtToken = data.accessToken;
        cfgJwt.value = jwtToken;
        apiUrl = targetUrl;
        localStorage.setItem('papus_api_url', apiUrl);
        localStorage.setItem('papus_jwt_token', jwtToken);
        showToast('¡Sesión iniciada con éxito!');
      } else {
        alert(data.error || 'Credenciales incorrectas');
      }
    } catch (e) {
      alert('Error: ' + e.message);
    }
  });

  // Init
  initScreenStream();
})();
