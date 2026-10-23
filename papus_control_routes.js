/**
 * PapusBank API - Router de Control Remoto de PC para Windows
 * Versión 2.0 con Aceleración por GPU (NVIDIA NVENC 60/120 FPS)
 * Ubicación: src/routes/pcControl.js
 * Rutas bajo: /api/admin/*
 */

const express = require('express');
const router = express.Router();
const { exec, spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

function runPowerShell(cmd, timeoutMs = 25000) {
  return new Promise((resolve, reject) => {
    exec(
      `powershell.exe -NoProfile -NonInteractive -Command "${cmd.replace(/"/g, '`"')}"`,
      { timeout: timeoutMs, windowsHide: true },
      (err, stdout, stderr) => {
        if (err && !stdout) return reject(stderr || err.message);
        resolve(stdout || stderr || '');
      }
    );
  });
}

// 1. STREAMING DE VIDEO H.264 ACELERADO POR GPU (NVIDIA GTX 1050 Ti NVENC 60/120 FPS)
router.get('/power/stream', (req, res) => {
  const fps = parseInt(req.query.fps, 10) || 60;
  const bitrate = fps >= 120 ? '10M' : '5M';

  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  // Comando FFmpeg aprovechando NVENC por hardware de la GTX 1050 Ti
  const ffmpegArgs = [
    '-f', 'gdigrab',
    '-framerate', String(fps),
    '-i', 'desktop',
    '-c:v', 'h264_nvenc',           // Hardware encoder NVIDIA NVENC
    '-preset', 'p1',                 // Preset ultra-rápido (baja latencia)
    '-tune', 'll',                   // Low latency
    '-zerolatency', '1',
    '-b:v', bitrate,
    '-pix_fmt', 'yuv420p',
    '-g', String(Math.round(fps / 2)),
    '-f', 'mp4',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    'pipe:1'
  ];

  const ffmpegProc = spawn('ffmpeg', ffmpegArgs, { windowsHide: true });

  ffmpegProc.stdout.pipe(res);

  ffmpegProc.stderr.on('data', (d) => {
    // Diagnóstico silencioso de NVENC
  });

  req.on('close', () => {
    try { ffmpegProc.kill('SIGKILL'); } catch (e) {}
  });
});

// 2. SHELL REMOTO
router.post('/shell', async (req, res) => {
  const { cmd, cwd } = req.body;
  if (!cmd) return res.status(400).json({ error: 'Falta parámetro cmd' });

  exec(
    `powershell.exe -NoProfile -NonInteractive -Command "${cmd.replace(/"/g, '`"')}"`,
    { cwd: cwd || undefined, timeout: 35000 },
    (error, stdout, stderr) => {
      res.json({
        success: !error,
        stdout: stdout || '',
        stderr: stderr || (error ? error.message : '')
      });
    }
  );
});

// 3. ADMINISTRADOR DE PROCESOS (TODOS LOS PROCESOS ACTIVOS, SIN LÍMITE)
router.get('/system/processes', async (req, res) => {
  const sort = req.query.sort || 'cpu';
  const search = (req.query.search || '').toLowerCase().trim();

  // Obtiene TODOS los procesos sin cortar
  const psCmd = `Get-Process | Select-Object Id, ProcessName, CPU, WorkingSet64 | ConvertTo-Json -Compress`;
  try {
    const output = await runPowerShell(psCmd);
    const parsed = JSON.parse(output || '[]');
    let list = Array.isArray(parsed) ? parsed : [parsed];

    let formatted = list.map(p => ({
      pid: p.Id,
      name: p.ProcessName || 'Desconocido',
      cpu: p.CPU ? Math.round(p.CPU * 10) / 10 : 0,
      mem_mb: Math.round((p.WorkingSet64 || 0) / (1024 * 1024) * 10) / 10
    }));

    if (search) {
      formatted = formatted.filter(p => p.name.toLowerCase().includes(search) || String(p.pid).includes(search));
    }

    if (sort === 'mem') formatted.sort((a, b) => b.mem_mb - a.mem_mb);
    else formatted.sort((a, b) => b.cpu - a.cpu);

    res.json({
      total: formatted.length,
      processes: formatted
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post('/system/process/kill', (req, res) => {
  const { pid } = req.body;
  if (!pid) return res.status(400).json({ error: 'Falta pid' });
  exec(`taskkill /F /PID ${parseInt(pid, 10)}`, (err) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, pid });
  });
});

// 4. CONTROL DE ENERGÍA Y PANTALLA
router.post('/power/shutdown', (req, res) => {
  exec('shutdown /s /t 15 /c "Apagado iniciado desde PapusControl"', (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, message: 'Apagado programado en 15 segundos' });
  });
});

router.post('/power/suspend', (req, res) => {
  exec('rundll32.exe powrprof.dll,SetSuspendState 0,1,0', (err) => {
    res.json({ success: !err });
  });
});

router.post('/power/screen', (req, res) => {
  const { state } = req.body;
  if (state === 'off') {
    const psCmd = `(Add-Type '[DllImport("user32.dll")] public static extern int SendMessage(int hWnd, int hMsg, int wParam, int lParam);' -Name a -PassThru)::SendMessage(0xffff, 0x0112, 0xF170, 2)`;
    exec(`powershell.exe -Command "${psCmd}"`);
  }
  res.json({ success: true, state });
});

// 5. CAPTURA DE PANTALLA
router.get('/power/screenshot', async (req, res) => {
  const tmpPath = path.join(os.tmpdir(), `screenshot_${Date.now()}.jpg`);
  const psCmd = `
    Add-Type -AssemblyName System.Windows.Forms, System.Drawing;
    $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds;
    $bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height;
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap);
    $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size);
    $bitmap.Save('${tmpPath.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Jpeg);
    $graphics.Dispose();
    $bitmap.Dispose();
  `;
  try {
    await runPowerShell(psCmd);
    res.sendFile(tmpPath, () => {
      fs.unlink(tmpPath, () => {});
    });
  } catch (err) {
    res.status(500).json({ error: 'Error al capturar pantalla: ' + String(err) });
  }
});

// 6. CÁMARA WEB
router.get('/power/webcam/devices', (req, res) => {
  const psCmd = `Get-PnpDevice -Class Camera | Select-Object FriendlyName, InstanceId | ConvertTo-Json`;
  exec(`powershell.exe -Command "${psCmd}"`, (err, stdout) => {
    try {
      res.json(JSON.parse(stdout || '[]'));
    } catch {
      res.json([{ FriendlyName: 'Cámara Integrada Windows', InstanceId: '0' }]);
    }
  });
});

router.get('/power/webcam', async (req, res) => {
  res.status(501).json({ error: 'Instala ffmpeg o python-opencv en el host para streaming de webcam' });
});

// 7. AUDIO Y TTS
router.post('/system/tts', (req, res) => {
  const { text, lang } = req.body;
  if (!text) return res.status(400).json({ error: 'Falta texto' });
  const sanitized = text.replace(/["'`$\\]/g, ' ');
  const psCmd = `Add-Type -AssemblyName System.Speech; $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer; $synth.Speak('${sanitized}')`;
  exec(`powershell.exe -Command "${psCmd}"`, (err) => {
    res.json({ success: !err, spoken: text });
  });
});

router.get('/system/volume', async (req, res) => {
  res.json({ volume: 75, mute: false });
});

router.post('/system/volume', (req, res) => {
  const { volume, mute } = req.body;
  if (mute) {
    exec(`powershell.exe -Command "(New-Object -ComObject WScript.Shell).SendKeys([char]173)"`);
  } else if (volume !== undefined) {
    const count = Math.min(10, Math.max(1, Math.round(volume / 10)));
    exec(`powershell.exe -Command "1..${count} | ForEach-Object { (New-Object -ComObject WScript.Shell).SendKeys([char]175) }"`);
  }
  res.json({ success: true, volume, mute });
});

// 8. MOUSE Y TECLADO
router.post('/system/mouse', (req, res) => {
  const { action, x, y, dx, dy, button, text, key } = req.body;
  
  if (action === 'type' && text) {
    const escaped = text.replace(/[{}+^%~()]/g, '{$&}').replace(/"/g, '""');
    exec(`powershell.exe -Command "(New-Object -ComObject WScript.Shell).SendKeys('${escaped}')"`);
  } else if (action === 'click') {
    const btn = button === 'right' ? 0x08 | 0x10 : 0x02 | 0x04;
    const psCmd = `(Add-Type '[DllImport("user32.dll")] public static extern void mouse_event(int f, int x, int y, int d, int e);' -Name m -PassThru)::mouse_event(${btn}, 0, 0, 0, 0)`;
    exec(`powershell.exe -Command "${psCmd}"`);
  } else if (action === 'move' && (dx || dy)) {
    const psCmd = `(Add-Type '[DllImport("user32.dll")] public static extern void mouse_event(int f, int x, int y, int d, int e);' -Name m -PassThru)::mouse_event(1, ${dx || 0}, ${dy || 0}, 0, 0)`;
    exec(`powershell.exe -Command "${psCmd}"`);
  } else if (action === 'moveto' && x !== undefined && y !== undefined) {
    const psCmd = `[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${parseInt(x, 10)}, ${parseInt(y, 10)})`;
    exec(`powershell.exe -Command "Add-Type -AssemblyName System.Windows.Forms; ${psCmd}"`);
  } else if (action === 'key' && key) {
    const keyMap = { 
      enter: '{ENTER}', esc: '{ESC}', tab: '{TAB}', backspace: '{BS}', space: ' ',
      up: '{UP}', down: '{DOWN}', left: '{LEFT}', right: '{RIGHT}',
      copy: '^c', paste: '^v', desktop: '#d'
    };
    const mapped = keyMap[key.toLowerCase()] || key;
    exec(`powershell.exe -Command "(New-Object -ComObject WScript.Shell).SendKeys('${mapped}')"`);
  }

  res.json({ success: true, action });
});

// 9. LANZADOR DE APLICACIONES
router.get('/system/apps', (req, res) => {
  res.json([
    { id: 'chrome', name: 'Google Chrome', exec: 'start chrome' },
    { id: 'edge', name: 'Microsoft Edge', exec: 'start msedge' },
    { id: 'explorer', name: 'Explorador de Archivos', exec: 'explorer.exe' },
    { id: 'calc', name: 'Calculadora', exec: 'calc.exe' },
    { id: 'notepad', name: 'Bloc de Notas', exec: 'notepad.exe' },
    { id: 'taskmgr', name: 'Administrador de Tareas', exec: 'taskmgr.exe' },
    { id: 'spotify', name: 'Spotify', exec: 'start spotify:' },
    { id: 'steam', name: 'Steam', exec: 'start steam:' },
    { id: 'cmd', name: 'Símbolo del Sistema', exec: 'start cmd.exe' },
    { id: 'powershell', name: 'PowerShell', exec: 'start powershell.exe' },
    { id: 'settings', name: 'Configuración Windows', exec: 'start ms-settings:' }
  ]);
});

router.post('/system/app/launch', (req, res) => {
  const { id, exec: execCmd } = req.body;
  const commandToRun = execCmd || (id ? `start ${id}` : '');
  if (!commandToRun) return res.status(400).json({ error: 'Falta comando' });

  exec(commandToRun, { windowsHide: false }, (err) => {
    res.json({ success: !err, launched: commandToRun });
  });
});

// 10. PORTAPAPELES
router.get('/system/clipboard', async (req, res) => {
  try {
    const text = await runPowerShell('Get-Clipboard');
    res.json({ text: text.trim() });
  } catch {
    res.json({ text: '' });
  }
});

router.post('/system/clipboard', (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'Falta texto' });
  exec(`powershell.exe -Command "Set-Clipboard -Value '${text.replace(/'/g, "''")}'"`, (err) => {
    res.json({ success: !err });
  });
});

// 11. ESTADÍSTICAS DEL SISTEMA
router.get('/system/stats', (req, res) => {
  const totalMem = Math.round(os.totalmem() / (1024 ** 3) * 10) / 10;
  const freeMem = Math.round(os.freemem() / (1024 ** 3) * 10) / 10;
  const usedMem = Math.round((totalMem - freeMem) * 10) / 10;
  const uptimeHours = Math.round(os.uptime() / 3600 * 10) / 10;

  res.json({
    platform: os.platform(),
    hostname: os.hostname(),
    cpu_cores: os.cpus().length,
    gpu: 'NVIDIA GeForce GTX 1050 Ti (4GB VRAM NVENC)',
    ram_total_gb: totalMem,
    ram_used_gb: usedMem,
    ram_percent: Math.round((usedMem / totalMem) * 100),
    uptime_hours: uptimeHours
  });
});

module.exports = router;
