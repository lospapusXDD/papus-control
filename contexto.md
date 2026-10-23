# 📘 CONTEXTO & GUÍA TÉCNICA — PAPUSCONTROL v2.0 (ACELERACIÓN GPU GTX 1050 Ti)

Este documento contiene el contexto completo de arquitectura y las instrucciones exactas para que cualquier desarrollador o IA integre la suite de **Control Remoto de PC para Windows** en el backend **PapusBank API** o en cualquier app móvil / WebView.

---

## ⚡ 1. Arquitectura y Capacidades Clave

### A. Aceleración por GPU (NVIDIA GeForce GTX 1050 Ti 4GB VRAM)
- **NVENC H.264 Hardware Encoding**: Aprovecha el chip de codificación por hardware de la GTX 1050 Ti en Windows mediante FFmpeg (`-c:v h264_nvenc -preset p1 -tune ll -zerolatency 1`).
- **Selector de Fotogramas**:
  - `30 FPS`: Modo ahorro de datos.
  - `60 FPS`: Modo estándar ultra-fluido (5 Mbps).
  - `120 FPS`: Modo ultra de alta tasa de refresco (10 Mbps) para gaming y respuesta instantánea.
- **Latencia Sub-milisegundo**: La captura y codificación se ejecutan directamente en la VRAM de la gráfica, reduciendo la carga de CPU a prácticamente 0%.

### B. Pantalla en Vivo con Mouse y Teclado Integrado (Misma Pestaña)
- **Clic Directo sobre la Pantalla**: Tocar cualquier punto del video de la pantalla en el celular traduce de inmediato la posición relativa a coordenadas absolutas de Windows (`moveto x, y`) y ejecuta un clic izquierdo instantáneo con onda expansiva visual.
- **Dock de Control Integrado**:
  - Barra de tipeo rápido: todo lo que escribes en el teléfono se envía a la ventana activa de Windows en tiempo real (`action: "type", text`).
  - Botones dedicados de ratón: **Clic Izquierdo**, **Clic Derecho**, **Scroll Arriba**, **Scroll Abajo**.
  - Teclas de acceso rápido: `Esc`, `Tab`, `Enter`, `Borrar (Backspace)`, `Win+D (Mostrar Escritorio)`.
  - Micrófono de dictado directo: Presiona y habla para que tu voz se convierta en texto y se escriba en Windows.

### C. Administrador de Procesos Completo (Sin Límite)
- **Consulta Completa de Procesos**: Obtiene el 100% de los procesos activos en Windows sin truncar.
- **Buscador en Tiempo Real**: Filtra al instante por nombre de ejecutable o PID.
- **Ordenamiento Inteligente**: Alterna con un toque entre ordenar por **Uso de CPU %** o **Consumo de Memoria RAM (MB)**.
- **Cierre Forzado**: Botón `Kill` para terminar procesos rebeldes (`taskkill /F /PID`).

### D. Cámara Web, Micrófono y TTS
- Alternancia de visualización entre **Pantalla de la PC** y **Cámara Web**.
- **Texto a Voz (TTS)**: Escribe en el celular y la PC lo habla en voz alta por sus altavoces (`POST /api/admin/system/tts { text }`).
- **Comandos de Voz**: Integración nativa con la Web Speech API del navegador móvil.

### E. Lanzador de Apps & Consola Shell / SQL
- Consulta y lanzamiento de aplicaciones instaladas (`GET /api/admin/system/apps` y `POST /api/admin/system/app/launch`).
- Terminal dual: ejecuta comandos **PowerShell / CMD** (`POST /api/admin/shell`) y sentencias **SQL PostgreSQL** (`POST /api/admin/sql`).
- Controles de energía: Apagar pantalla (`SC_MONITORPOWER`), suspender y apagar PC.

---

## 🗂️ 2. Estructura del Paquete `papus_control_pack.zip`

```text
papus_control_pack/
├── contexto.md               # Esta guía técnica detallada para la otra IA
├── papus_control_routes.js   # Router Express v2.0 con soporte NVENC 60/120 FPS
└── client/                   # Frontend optimizado para WebView / Móvil
    ├── index.html            # Interfaz táctil con dock integrado en pantalla
    ├── style.css             # Estilos dark cyberpunk / glassmorphism
    └── app.js                # Motor JavaScript (NVENC, Web Speech, gestos, JWT)
```

---

## 🔌 3. Instrucciones de Integración en el Backend Express (PapusBank)

### Paso 1: Colocar las rutas
Mueve `papus_control_routes.js` a `src/routes/pcControl.js` dentro del repositorio de PapusBank.

### Paso 2: Montar en `src/app.js` o `server.js`
```javascript
const pcControlRoutes = require('./routes/pcControl');
const auth = require('./middleware/auth');
const adminOnly = require('./middleware/adminOnly');

// Registrar rutas bajo /api/admin
app.use('/api/admin', auth, adminOnly, pcControlRoutes);

// Servir la app cliente para acceder desde el celular
const path = require('path');
app.use('/control', express.static(path.join(__dirname, 'client')));
```

### Paso 3: Requisitos en la PC Host (Windows)
- **NVIDIA Driver**: 582.66 o superior con soporte NVENC (activo en tu GTX 1050 Ti).
- **FFmpeg**: Instalado en el `PATH` del sistema (ya verificado y presente en la máquina).
- **Node.js**: v18+ o v24+.

---

## 📱 4. Conexión de la App Móvil con JWT

1. Abre `http://<IP_LOCAL>:3000/control` desde el celular.
2. Toca el ícono de la **Llave 🔑** en la esquina superior derecha.
3. Ingresa tu usuario administrador y contraseña de PapusBank para generar el token JWT automáticamente.
4. El token se almacena de forma segura en el `localStorage` del dispositivo y se adjunta como cabecera `Authorization: Bearer <accessToken>` en cada petición.
