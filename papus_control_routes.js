/**
 * PapusBank API - Router de Control Remoto Multiplataforma (CachyOS Linux & Windows)
 * Soporta CachyOS (Arch Linux) y Windows 10/11
 * Ubicación: src/routes/pcControl.js
 * Rutas bajo: /api/admin/*
 */

const express = require('express');
const router = express.Router();
const { exec, spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

const isLinux = os.platform() === 'linux';
const isWin = os.platform() === 'win32';

// Helper de ejecución multiplataforma
function runCommand(cmd, timeoutMs = 25000) {
  return new Promise((resolve, reject) => {
    const shellExec = isLinux ? '/bin/bash' : 'powershell.exe';
    const shellArgs = isLinux ? ['-c', cmd] : ['-NoProfile', '-NonInteractive', '-Command', cmd];

    exec(
      isLinux ? cmd : `powershell.exe -NoProfile -NonInteractive -Command "${cmd.replace(/"/g, '`"')}"`,
      { timeout: timeoutMs, windowsHide: true },
      (err, stdout, stderr) => {
        if (err && !stdout) return reject(stderr || err.message);
        resolve(stdout || stderr || '');
      }
    );
  });
}

// 1. STREAMING DE VIDEO (GPU NVENC EN WINDOWS O FFMPEG EN CACHYOS LINUX)
router.get('/power/stream', (req, res) => {
  const fps = parseInt(req.query.fps, 10) || 60;
  const bitrate = fps >= 120 ? '10M' : '5M';

  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  let ffmpegArgs = [];
  if (isLinux) {
    // CachyOS / Linux con X11 o KMS
    const display = process.env.DISPLAY || ':0';
    ffmpegArgs = [
      '-f', 'x11grab',
      '-framerate', String(fps),
      '-video_size', '1920x1080',
      '-i', display,
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-tune', 'zerolatency',
      '-b:v', bitrate,
      '-pix_fmt', 'yuv420p',
      '-g', String(Math.round(fps / 2)),
      '-f', 'mp4',
      '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
      'pipe:1'
    ];
  } else {
    // Windows con hardware NVENC de la GTX 1050 Ti
    ffmpegArgs = [
      '-f', 'gdigrab',
      '-framerate', String(fps),
      '-i', 'desktop',
      '-c:v', 'h264_nvenc',
      '-preset', 'p1',
      '-tune', 'll',
      '-zerolatency', '1',
      '-b:v', bitrate,
      '-pix_fmt', 'yuv420p',
      '-g', String(Math.round(fps / 2)),
      '-f', 'mp4',
      '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
      'pipe:1'
    ];
  }

  const ffmpegProc = spawn('ffmpeg', ffmpegArgs, { windowsHide: true });
  ffmpegProc.stdout.pipe(res);

  req.on('close', () => {
    try { ffmpegProc.kill('SIGKILL'); } catch (e) {}
  });
});

// 2. SHELL REMOTO (BASH EN CACHYOS / POWERSHELL EN WINDOWS)
router.post('/shell', async (req, res) => {
  const { cmd, cwd } = req.body;
  if (!cmd) return res.status(400).json({ error: 'Falta comando cmd' });

  exec(
    cmd,
    { cwd: cwd || undefined, timeout: 35000, shell: isLinux ? '/bin/bash' : 'powershell.exe' },
    (error, stdout, stderr) => {
      res.json({
        success: !error,
        stdout: stdout || '',
        stderr: stderr || (error ? error.message : '')
      });
    }
  );
});

// 3. ADMINISTRADOR DE PROCESOS (TODOS LOS PROCESOS EN LINUX Y WINDOWS)
router.get('/system/processes', async (req, res) => {
  const sort = req.query.sort || 'cpu';
  const search = (req.query.search || '').toLowerCase().trim();

  try {
    let formatted = [];

    if (isLinux) {
      // CachyOS / Linux
      const output = await runCommand('ps -eo pid,comm,%cpu,rss --sort=-%cpu --no-headers');
      const lines = output.trim().split('\n');
      formatted = lines.map(line => {
        const parts = line.trim().split(/\s+/);
        const pid = parseInt(parts[0], 10);
        const name = parts[1] || 'desconocido';
        const cpu = parseFloat(parts[2]) || 0;
        const mem_mb = Math.round((parseInt(parts[3], 10) || 0) / 1024 * 10) / 10;
        return { pid, name, cpu, mem_mb };
      }).filter(p => !isNaN(p.pid));
    } else {
      // Windows
      const psCmd = `Get-Process | Select-Object Id, ProcessName, CPU, WorkingSet64 | ConvertTo-Json -Compress`;
      const output = await runCommand(psCmd);
      const parsed = JSON.parse(output || '[]');
      const list = Array.isArray(parsed) ? parsed : [parsed];
      formatted = list.map(p => ({
        pid: p.Id,
        name: p.ProcessName || 'Desconocido',
        cpu: p.CPU ? Math.round(p.CPU * 10) / 10 : 0,
        mem_mb: Math.round((p.WorkingSet64 || 0) / (1024 * 1024) * 10) / 10
      }));
    }

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
  const cmd = isLinux ? `kill -9 ${parseInt(pid, 10)}` : `taskkill /F /PID ${parseInt(pid, 10)}`;
  exec(cmd, (err) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, pid });
  });
});

// 4. CONTROL DE ENERGÍA Y PANTALLA
router.post('/power/shutdown', (req, res) => {
  const cmd = isLinux ? 'shutdown -h now' : 'shutdown /s /t 15';
  exec(cmd, (err) => {
    res.json({ success: !err, message: 'Apagado iniciado' });
  });
});

router.post('/power/suspend', (req, res) => {
  const cmd = isLinux ? 'systemctl suspend' : 'rundll32.exe powrprof.dll,SetSuspendState 0,1,0';
  exec(cmd, (err) => {
    res.json({ success: !err });
  });
});

router.post('/power/screen', (req, res) => {
  const { state } = req.body;
  if (state === 'off') {
    const cmd = isLinux ? 'xset dpms force off' : `powershell.exe -Command "(Add-Type '[DllImport(\\"user32.dll\\")] public static extern int SendMessage(int a, int b, int c, int d);' -Name a -PassThru)::SendMessage(0xffff, 0x0112, 0xF170, 2)"`;
    exec(cmd);
  }
  res.json({ success: true, state });
});

// 5. CAPTURA DE PANTALLA
router.get('/power/screenshot', async (req, res) => {
  const tmpPath = path.join(os.tmpdir(), `screenshot_${Date.now()}.jpg`);
  try {
    if (isLinux) {
      await runCommand(`ffmpeg -y -f x11grab -video_size 1920x1080 -i :0 -vframes 1 "${tmpPath}"`);
    } else {
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
      await runCommand(psCmd);
    }

    res.sendFile(tmpPath, () => {
      fs.unlink(tmpPath, () => {});
    });
  } catch (err) {
    res.status(500).json({ error: 'Error al capturar pantalla: ' + String(err) });
  }
});

// 6. CÁMARA WEB (LINUX /dev/video0 o WINDOWS)
router.get('/power/webcam', (req, res) => {
  const device = req.query.device || (isLinux ? '/dev/video0' : 'video="Integrated Camera"');
  const tmpPath = path.join(os.tmpdir(), `webcam_${Date.now()}.jpg`);
  const inputFmt = isLinux ? '-f v4l2' : '-f dshow';
  const cmd = `ffmpeg -y ${inputFmt} -i "${device}" -vframes 1 "${tmpPath}"`;

  exec(cmd, (err) => {
    if (err) return res.status(500).json({ error: 'No se pudo capturar webcam' });
    res.sendFile(tmpPath, () => {
      fs.unlink(tmpPath, () => {});
    });
  });
});

// 7. TTS (TEXTO A VOZ)
router.post('/system/tts', (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'Falta texto' });
  const sanitized = text.replace(/["'`$\\]/g, ' ');
  const cmd = isLinux 
    ? `espeak -v es "${sanitized}" || spd-say "${sanitized}"`
    : `powershell.exe -Command "Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak('${sanitized}')"`;
  exec(cmd, (err) => {
    res.json({ success: !err, spoken: text });
  });
});

// 8. MOUSE Y TECLADO (XDOTOOL EN LINUX O POWERSHELL EN WINDOWS)
router.post('/system/mouse', (req, res) => {
  const { action, x, y, dx, dy, button, text, key } = req.body;

  if (isLinux) {
    // CachyOS / Linux xdotool
    if (action === 'type' && text) {
      exec(`xdotool type --delay 5 "${text.replace(/"/g, '\\"')}"`);
    } else if (action === 'click') {
      const b = button === 'right' ? 3 : 1;
      exec(`xdotool click ${b}`);
    } else if (action === 'move') {
      exec(`xdotool mousemove_relative -- ${dx || 0} ${dy || 0}`);
    } else if (action === 'moveto') {
      exec(`xdotool mousemove ${x || 0} ${y || 0}`);
    } else if (action === 'scroll') {
      const b = (dy || 0) > 0 ? 4 : 5;
      exec(`xdotool click ${b}`);
    } else if (action === 'key' && key) {
      exec(`xdotool key "${key}"`);
    }
  } else {
    // Windows
    if (action === 'type' && text) {
      const escaped = text.replace(/[{}+^%~()]/g, '{$&}').replace(/"/g, '""');
      exec(`powershell.exe -Command "(New-Object -ComObject WScript.Shell).SendKeys('${escaped}')"`);
    } else if (action === 'click') {
      const btn = button === 'right' ? 0x08 | 0x10 : 0x02 | 0x04;
      exec(`powershell.exe -Command "(Add-Type '[DllImport(\\"user32.dll\\")] public static extern void mouse_event(int a, int b, int c, int d, int e);' -Name m -PassThru)::mouse_event(${btn}, 0, 0, 0, 0)"`);
    } else if (action === 'move') {
      exec(`powershell.exe -Command "(Add-Type '[DllImport(\\"user32.dll\\")] public static extern void mouse_event(int a, int b, int c, int d, int e);' -Name m -PassThru)::mouse_event(1, ${dx || 0}, ${dy || 0}, 0, 0)"`);
    } else if (action === 'moveto') {
      exec(`powershell.exe -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${parseInt(x, 10)}, ${parseInt(y, 10)})"`);
    } else if (action === 'key' && key) {
      const keyMap = { enter: '{ENTER}', esc: '{ESC}', tab: '{TAB}', backspace: '{BS}', space: ' ', desktop: '#d' };
      const mapped = keyMap[key.toLowerCase()] || key;
      exec(`powershell.exe -Command "(New-Object -ComObject WScript.Shell).SendKeys('${mapped}')"`);
    }
  }

  res.json({ success: true, action });
});

// 9. APLICACIONES Y FLATPAK (LINUX / WINDOWS)
router.get('/system/apps', (req, res) => {
  if (isLinux) {
    res.json([
      { id: 'browser', name: 'Navegador Web', exec: 'xdg-open https://google.com' },
      { id: 'terminal', name: 'Terminal CachyOS', exec: 'x-terminal-emulator || kitty || alacritty' },
      { id: 'files', name: 'Explorador de Archivos', exec: 'thunar || dolphin || nautilus' },
      { id: 'steam', name: 'Steam', exec: 'steam' },
      { id: 'spotify', name: 'Spotify', exec: 'spotify' },
      { id: 'discord', name: 'Discord', exec: 'discord' },
      { id: 'htop', name: 'Monitor Htop', exec: 'htop' }
    ]);
  } else {
    res.json([
      { id: 'chrome', name: 'Google Chrome', exec: 'start chrome' },
      { id: 'edge', name: 'Microsoft Edge', exec: 'start msedge' },
      { id: 'explorer', name: 'Explorador de Archivos', exec: 'explorer.exe' },
      { id: 'calc', name: 'Calculadora', exec: 'calc.exe' },
      { id: 'notepad', name: 'Bloc de Notas', exec: 'notepad.exe' },
      { id: 'taskmgr', name: 'Administrador de Tareas', exec: 'taskmgr.exe' },
      { id: 'spotify', name: 'Spotify', exec: 'start spotify:' },
      { id: 'steam', name: 'Steam', exec: 'start steam:' }
    ]);
  }
});

router.post('/system/app/launch', (req, res) => {
  const { id, exec: execCmd } = req.body;
  const cmd = execCmd || (isLinux ? id : `start ${id}`);
  exec(cmd, (err) => {
    res.json({ success: !err, launched: cmd });
  });
});

// Flatpak para CachyOS / Arch Linux
router.get('/system/flatpak/search', (req, res) => {
  const q = req.query.q || '';
  exec(`flatpak search "${q}"`, (err, stdout) => {
    res.json({ success: !err, results: stdout || '' });
  });
});

// 10. ESTADÍSTICAS DEL SISTEMA
router.get('/system/stats', (req, res) => {
  const totalMem = Math.round(os.totalmem() / (1024 ** 3) * 10) / 10;
  const freeMem = Math.round(os.freemem() / (1024 ** 3) * 10) / 10;
  const usedMem = Math.round((totalMem - freeMem) * 10) / 10;

  res.json({
    platform: isLinux ? 'CachyOS (Arch Linux)' : 'Windows',
    hostname: os.hostname(),
    cpu_cores: os.cpus().length,
    gpu: isLinux ? 'NVIDIA / Driver CachyOS' : 'NVIDIA GeForce GTX 1050 Ti (4GB NVENC)',
    ram_total_gb: totalMem,
    ram_used_gb: usedMem,
    ram_percent: Math.round((usedMem / totalMem) * 100),
    uptime_hours: Math.round(os.uptime() / 3600 * 10) / 10
  });
});

module.exports = router;
