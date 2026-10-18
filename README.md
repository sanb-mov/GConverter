# GConverter

**Convierte lo que sea. Consérvalo todo.**

Conversor de audio, vídeo e imágenes de escritorio construido sobre FFmpeg,
diseñado alrededor de una única regla: **nunca degradar la calidad en
silencio**, y decirle siempre al usuario exactamente qué le está pasando a su
archivo. Incluye además un descargador de YouTube (vídeo, solo audio o solo
un fragmento) basado en yt-dlp.

![Electron](https://img.shields.io/badge/Electron-43-47848F)
![TypeScript](https://img.shields.io/badge/TypeScript-7-3178C6)
![Tests](https://img.shields.io/badge/tests-160%20pasando-22C77E)
![Idiomas](https://img.shields.io/badge/idiomas-ES%20%7C%20EN-5B8CFF)

---

## Índice

- [Requisitos previos](#requisitos-previos)
- [Compilación](#compilación)
- [Comandos disponibles](#comandos-disponibles)
- [Problemas frecuentes al compilar](#problemas-frecuentes-al-compilar)
- [Arquitectura](#arquitectura)
- [Decisiones de diseño](#decisiones-de-diseño)
- [Tests](#tests)
- [Estructura del proyecto](#estructura-del-proyecto)

---

## Requisitos previos

| Herramienta | Versión mínima | Comprobar con |
|---|---|---|
| **Node.js** | 20.19 o 22.12+ (probado en 24) | `node --version` |
| **npm** | 10 | `npm --version` |
| **Git** | cualquiera | `git --version` |

El mínimo de Node lo impone Vite 7, no la aplicación en sí.

No hace falta instalar FFmpeg: se descarga automáticamente como dependencia
de npm y se empaqueta con la aplicación. Lo mismo con **yt-dlp** (el motor de
la página de YouTube): `npm run ytdlp` descarga el binario oficial a `bin/`,
comprobando su SHA-256, y los comandos `dist:*` lo hacen solos antes de
empaquetar.

Espacio en disco necesario: alrededor de **1,5 GB**. Solo `node_modules`
ocupa unos **950 MB**, casi todo binarios:

| Paquete | Tamaño |
|---|---|
| `electron` | ~350 MB |
| `ffprobe-static` | ~335 MB (binarios de todas las plataformas) |
| `ffmpeg-static` | ~79 MB |

---

## Compilación

### 1. Clonar e instalar

```bash
git clone https://github.com/sanb-mov/GConverter.git
cd GConverter
npm install
```

La instalación descarga los binarios de Electron, FFmpeg y FFprobe, así que
puede tardar varios minutos la primera vez.

> Del paquete de FFprobe solo se empaqueta el binario de tu plataforma; los
> demás se descartan al generar el instalador. Por eso el instalador acaba
> ocupando ~136 MB y no más de 200 MB.

### 2. Generar los recursos

Los iconos y los archivos de prueba **no** están en el repositorio: se
generan, para no versionar binarios.

```bash
npm run icons      # crea build/icon.png, icon-512.png e icon.ico desde icon.svg
npm run fixtures   # crea archivos multimedia pequeños para los tests
npm run ytdlp      # descarga yt-dlp a bin/ (necesario para probar YouTube en dev)
```

`npm run icons` usa el propio Electron para rasterizar el SVG, así que no
necesita ImageMagick ni ninguna librería nativa de imágenes.

### 3. Ejecutar en desarrollo

```bash
npm run dev
```

Arranca la aplicación con recarga en caliente: los cambios en la interfaz se
reflejan al instante y los del proceso principal reinician la app sola.

### 4. Compilar

```bash
npm run build      # compila a out/ (sin empaquetar)
npm run typecheck  # comprueba los tipos de los tres proyectos TS
npm test           # ejecuta los 160 tests
```

### 5. Generar el instalador

```bash
npm run dist:win     # Windows  → dist/GConverter Setup 1.1.0.exe   (NSIS)
npm run dist:linux   # Linux    → dist/GConverter-1.1.0.AppImage + .deb
npm run dist:mac     # macOS    → dist/GConverter 1.1.0.dmg         (x64 + arm64)
```

El resultado queda en la carpeta `dist/`. También se genera
`dist/win-unpacked/` con la aplicación sin empaquetar, útil para probar el
build de producción sin instalar nada.

> **Compilación cruzada:** cada instalador debe generarse en su propio
> sistema operativo. No se puede crear un DMG desde Windows ni un `.exe`
> firmado desde Linux.

---

## Comandos disponibles

| Comando | Qué hace |
|---|---|
| `npm run dev` | Aplicación en modo desarrollo con recarga en caliente |
| `npm run build` | Compila el código a `out/` |
| `npm run start` | Previsualiza el build de producción |
| `npm run typecheck` | Comprueba tipos en main, preload y renderer |
| `npm test` | Ejecuta toda la batería de tests |
| `npm run test:watch` | Tests en modo observación |
| `npm run icons` | Regenera los iconos desde `build/icon.svg` |
| `npm run fixtures` | Regenera los archivos multimedia de prueba |
| `npm run ytdlp` | Descarga yt-dlp a `bin/` (verificado por SHA-256) |
| `npm run dist` | Instalador para la plataforma actual |
| `npm run dist:win` / `:linux` / `:mac` | Instalador para una plataforma concreta |

---

## Problemas frecuentes al compilar

Estos son fallos reales que aparecen al montar el proyecto desde cero.

### La aplicación se cierra al arrancar con `Cannot read properties of undefined (reading 'requestSingleInstanceLock')`

La variable de entorno `ELECTRON_RUN_AS_NODE` está definida en tu terminal.
Eso obliga a Electron a comportarse como Node normal, así que
`require('electron')` devuelve una ruta en vez del módulo.

```powershell
Remove-Item Env:\ELECTRON_RUN_AS_NODE   # PowerShell
```

```bash
unset ELECTRON_RUN_AS_NODE              # bash / zsh
```

### `npm run dev` falla porque no encuentra el ejecutable de Electron

El script de post-instalación de Electron no llegó a ejecutarse (suele pasar
con `--ignore-scripts` o si se cortó la instalación). Lánzalo a mano:

```bash
node node_modules/electron/install.js
```

### `ERESOLVE unable to resolve dependency tree` al instalar

Las versiones están fijadas a propósito porque `electron-vite` todavía no
admite Vite 8. Instala con el `package-lock.json` del repositorio:

```bash
npm ci
```

### Los iconos no se generan y el proceso se queda colgado

`build/make-icons.cjs` es CommonJS **a propósito**. Con un punto de entrada
ESM, un `await app.whenReady()` de nivel superior se bloquea para siempre,
porque Electron solo emite `ready` cuando el módulo principal ha terminado de
evaluarse. No lo conviertas a `.mjs`.

### El instalador ocupa más de 200 MB

Comprueba que `electron-builder.yml` conserva los filtros de `files` por
plataforma. Sin ellos se empaquetan los binarios de FFprobe de **todos** los
sistemas operativos (unos 335 MB de más).

---

## Arquitectura

La interfaz nunca habla con FFmpeg. Cada capa solo conoce la que tiene
debajo, de modo que el motor de conversión se puede probar entero sin
Electron, y se podría sustituir por otro backend sin tocar la interfaz.

```
  Renderer (React)          src/renderer
        │  contextBridge — el renderer no tiene acceso a Node
  Preload                   src/preload
        │  contrato IPC tipado (src/shared/ipc.ts)
  Proceso principal         src/main/index.ts
        │
  ┌─────┴──────────────────────────────────────────────┐
  │ QueueManager      ciclo de vida y concurrencia      │
  │ ConversionEngine  control del proceso y progreso    │
  │ Planner           decide copiar o recodificar       │
  │ CommandFactory    ajustes → parámetros de FFmpeg    │
  │ CommandBuilder    construcción segura de argumentos │
  │ MediaProbe        FFprobe → modelo de dominio       │
  │ HardwareDetector  codificadores GPU verificados     │
  └─────┬──────────────────────────────────────────────┘
        │
     FFmpeg / FFprobe
```

| Módulo | Responsabilidad |
|---|---|
| `core/ffmpeg/resolver.ts` | Localizar FFmpeg: ruta del usuario → incluido → PATH |
| `core/ffmpeg/commandBuilder.ts` | Construir listas de argumentos, nunca cadenas de shell |
| `core/media/probe.ts` | FFprobe JSON → `MediaFile`, con HDR y capítulos |
| `core/media/paths.ts` | Nombres de salida, colisiones y validación previa |
| `core/conversion/planner.ts` | Decidir copiar o recodificar por pista; veredictos honestos |
| `core/conversion/commandFactory.ts` | Traducir ajustes y plan a parámetros de FFmpeg |
| `core/conversion/engine.ts` | Lanzar el proceso, leer el progreso, cancelar con seguridad |
| `core/conversion/errorMapper.ts` | stderr de FFmpeg → causa y solución en lenguaje claro |
| `core/conversion/smart.ts` | Conversión inteligente; límites que nunca amplían |
| `core/queue/queueManager.ts` | Cola, concurrencia, reintentos e historial |
| `core/hardware/detector.ts` | Detectar **y verificar** NVENC/AMF/QSV/VideoToolbox |
| `core/automation/watcher.ts` | Carpetas vigiladas y acciones posteriores |
| `core/youtube/ytdlp.ts` | Localizar yt-dlp, construir sus argumentos y explicar sus errores |
| `core/youtube/downloader.ts` | Lista de descargas: progreso, fragmentos, cancelación y limpieza |
| `core/youtube/auth.ts` | Ventana aislada de YouTube para el captcha «No soy un robot» |
| `shared/formats.ts` | Registro de contenedores y códecs que gobierna la compatibilidad |
| `shared/i18n.ts` | Diccionario ES/EN compartido por los dos procesos |

Añadir un códec o un contenedor consiste en editar `shared/formats.ts`: el
motor, la interfaz y el planificador leen todos de ese mismo registro.

---

## Decisiones de diseño

**Los argumentos nunca son cadenas de shell.** Cada llamada a FFmpeg es una
lista de argumentos pasada a `spawn` con `shell: false`. Un archivo llamado
`mi "gran" película & rm -rf.mkv` se transmite tal cual; hay un test que lo
comprueba exactamente así.

**Los codificadores por hardware se verifican, no se suponen.** Una compilación
de FFmpeg anuncia `h264_nvenc` exista o no una GPU NVIDIA. GConverter ejecuta
una codificación real de un fotograma con cada candidato antes de ofrecerlo.

**La detección de remultiplexado lo gobierna todo.** Si el contenedor de
destino admite los códecs del origen, las pistas se copian. La batería de
integración lo demuestra comparando el MD5 del flujo de vídeo antes y después:
tiene que coincidir exactamente.

**Se rechazan las recodificaciones inútiles.** Pedir salida H.264 de un origen
H.264 sin ningún otro cambio produce una copia, no una pérdida de generación.

**Cancelar no deja restos.** Un trabajo cancelado o fallido borra su salida
parcial.

**El progreso viene de `-progress pipe:1`**, no de raspar la salida de error
pensada para humanos, así que es fiable entre versiones de FFmpeg.

---

## Tests

```bash
npm test
```

160 tests en siete baterías. Las de integración, cola e imágenes ejecutan
**conversiones reales con FFmpeg** sobre los archivos generados y vuelven a
analizar la salida:

- remultiplexado sin pérdida MKV↔MP4↔MOV, verificado por hash del flujo
- ida y vuelta WAV → FLAC → WAV comparada byte a byte
- AVI→MP4, MP4→WebM, vídeo→MP3, FLAC→MP3
- conversión y eliminación de subtítulos, capítulos y metadatos
- nombres con espacios, comillas, `&`, `#` y caracteres no ASCII
- cancelación a mitad de codificación con limpieza del archivo parcial
- concurrencia de la cola, reintentos, lotes y rutas de salida únicas
- detección de hardware con verificación real
- imágenes PNG → JPG/WebP/AVIF/BMP/TIFF/TGA/ICO/GIF, transparencia, tamaño y fotogramas de vídeo
- argumentos de yt-dlp, fragmentos, validación de enlaces y de tiempos, cookies
- cobertura de traducciones: falla si a un idioma le falta una clave

```bash
npm run typecheck   # TypeScript estricto en main, preload y renderer
```

---

## Estructura del proyecto

```
src/
  main/        Proceso principal de Electron y todos los servicios
  preload/     Superficie de API expuesta por contextBridge
  renderer/    Interfaz en React
  shared/      Modelos, registro de formatos, contrato IPC, traducciones
tests/         Baterías unitarias y de integración con FFmpeg real
build/         Icono fuente, generación y recursos de empaquetado
docs/          Documentación de usuario (se distribuye con la app)
```

---

## Documentación de usuario

La aplicación incluye un manual completo en **Ayuda** (o pulsando **F1**), con
un artículo por sección y una explicación de para qué sirve cada opción.
También está en [docs/README.md](docs/README.md).

---

## Licencia

MIT. Incluye FFmpeg, que se distribuye bajo sus propios términos LGPL/GPL —
consulta <https://ffmpeg.org/legal.html>.

---

## Autor

**sanb-mov**

- GitHub — <https://github.com/sanb-mov>
- Linktree — <https://linktr.ee/gripg>
