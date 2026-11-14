# Taller 5 - Conexión IoT

## Trabajo pendiente

Los siguientes elementos aún deben incorporarse al proyecto:

1. Panel web (frontend): mostrar en tiempo real la temperatura, la humedad y el nivel de agua; indicador visual de estado (verde o rojo); gráfico de las lecturas; tabla con las diez últimas lecturas y aviso de alertas. Debe conectarse al WebSocket `/live` y, si la conexión falla, consultar periódicamente los endpoints de lectura.
2. Exposición pública del backend mediante Cloudflare Quick Tunnel, con una guía breve de uso y una colección de Postman para enviar lecturas de prueba. El backend deberá servir también el frontend compilado, de modo que una sola URL pública muestre el panel.
3. Documentos de arquitectura del sistema y de arquitectura del software.
4. Pruebas finales: prueba de carga y verificación de cada requisito del enunciado.
5. Opcional: una tercera base de datos de tipo grafo como funcionalidad adicional.

Valores por confirmar con el profesor: el umbral de temperatura de las alertas (actualmente 30 °C) y el nivel mínimo de agua (actualmente 1, equivalente a 25 %). Ambos se modifican en el archivo `.env`, sin cambiar el código.

## Guía para colaborar

Para mantener la estructura del proyecto, cada tipo de código tiene un lugar definido:

| Qué se agrega | Dónde va |
|---|---|
| Un endpoint nuevo | `backend/src/routes/`, un archivo por grupo de endpoints, registrado en `backend/src/app.js` |
| Lógica de negocio (cálculos, reglas, alertas) | `backend/src/services/` |
| Consultas a MongoDB o Valkey | `backend/src/repositories/`; ningún otro módulo debe acceder directamente a las bases de datos |
| Validación de datos de entrada | `backend/src/validation/` |
| Funcionalidad de tiempo real | `backend/src/realtime/` |
| Valores configurables (umbrales, puertos, direcciones) | `backend/src/config.js` y `.env.example`; nunca escritos directamente en el código |
| Scripts auxiliares (utilidades, pruebas manuales) | `backend/scripts/` |
| Código del panel web | `frontend/src/` |
| Pruebas | `backend/tests/` o `frontend/tests/`, con nombre `<modulo>.test.js` |
| Documentos de arquitectura | `documentacion/` |

Reglas generales:

- No modificar el formato del endpoint `POST /sensor-data` ni el JSON que recibe, ya que el profesor enviará los datos con ese formato.
- Trabajar en una rama propia y no directamente en `main`.
- Antes de subir cambios, ejecutar `npm test` y `npm run lint` en `backend/` (y `npm test` en `frontend/`); ambos deben terminar sin errores.
- Toda funcionalidad nueva debe incluir sus pruebas.
- No subir el archivo `.env`, la carpeta `node_modules` ni archivos compilados.
- No cambiar la estructura de carpetas sin acordarlo con el equipo.

## Introducción

Este proyecto recibe las mediciones que un dispositivo ESP32 envía cada diez segundos en formato JSON (identificador del dispositivo, temperatura, humedad y nivel de agua) y las pone a disposición de una aplicación web.

El backend expone el endpoint `POST /sensor-data` para recibir los datos, los valida y los almacena. MongoDB conserva el historial completo de lecturas y de alertas, y Valkey (base de datos clave-valor compatible con Redis) mantiene el estado reciente: la última lectura, las diez últimas lecturas, el indicador de dispositivo en línea y la publicación de nuevas lecturas y alertas. El sistema genera alertas cuando la temperatura supera un valor máximo o cuando el nivel de agua es bajo, con un tiempo de espera para no repetirlas continuamente. Las nuevas lecturas y alertas se transmiten en tiempo real a los navegadores conectados mediante WebSocket en la ruta `/live`. Además, ofrece endpoints de consulta para las últimas lecturas, las estadísticas por hora, los dispositivos, las alertas y el estado del servicio.

El frontend es un proyecto independiente, construido con Vite, destinado a mostrar los datos de los sensores.

## Librerías y dependencias

Requisitos generales: Node.js 20 o superior, npm y Docker con Docker Compose.

Backend (`backend/`), dependencias de ejecución:

- express: servidor HTTP y definición de endpoints.
- mongodb: controlador oficial para conectarse a MongoDB.
- ioredis: cliente para Valkey (compatible con el protocolo de Redis).
- ws: servidor WebSocket para la transmisión de datos en tiempo real.
- dotenv: carga de variables de entorno desde el archivo `.env`.

Backend, dependencias de desarrollo:

- vitest: ejecución de pruebas.
- supertest: pruebas de los endpoints HTTP.
- mongodb-memory-server: instancia temporal de MongoDB para las pruebas.
- ioredis-mock: simulación de Valkey para las pruebas.
- eslint: análisis estático del código.

Frontend (`frontend/`), dependencias de desarrollo:

- vite: servidor de desarrollo y empaquetado.
- vitest: ejecución de pruebas.

Infraestructura (`docker-compose.yml`):

- MongoDB 7 (imagen `mongo:7`).
- Valkey 8 (imagen `valkey/valkey:8`).

## Estructura del proyecto

```
.
├── docker-compose.yml        Servicios de MongoDB y Valkey
├── .env.example              Plantilla de variables de entorno
├── backend/
│   ├── package.json
│   ├── eslint.config.js
│   ├── scripts/
│   │   ├── smoke.js          Prueba de humo contra el sistema en ejecución
│   │   ├── simulator.js      Simulador del ESP32 (línea de comandos)
│   │   └── simulatorCore.js  Generación de lecturas y lectura de opciones
│   ├── src/
│   │   ├── server.js         Punto de entrada: conexiones y arranque
│   │   ├── app.js            Construcción de la aplicación Express
│   │   ├── config.js         Lectura de variables de entorno
│   │   ├── db/               Conexiones a MongoDB y Valkey
│   │   ├── middleware/       Lectura tolerante del cuerpo JSON
│   │   ├── validation/       Validación de los datos del sensor
│   │   ├── repositories/     Acceso a MongoDB (lecturas, alertas) y a Valkey
│   │   ├── services/         Lógica de ingesta y de alertas
│   │   ├── realtime/         Servidor WebSocket y puente con Valkey
│   │   └── routes/           Endpoints: sensor-data, consultas y alertas
│   └── tests/                Pruebas automatizadas del backend
└── frontend/
    ├── package.json
    ├── index.html
    ├── src/                  Código de la aplicación web
    └── tests/                Pruebas del frontend
```

## Instrucciones de ejecución

1. Iniciar las bases de datos desde la raíz del proyecto:

   ```
   docker compose up -d
   ```

2. Configurar y ejecutar el backend:

   ```
   cd backend
   npm install
   cp ../.env.example .env
   npm start
   ```

   Las variables de entorno tienen valores por defecto, por lo que el archivo `.env` es opcional para una ejecución local. El servidor queda disponible en `http://localhost:3000` y el canal de tiempo real en `ws://localhost:3000/live`.

3. Ejecutar las pruebas y el análisis de código del backend:

   ```
   npm test
   npm run lint
   ```

4. Con el servidor en ejecución, probar el sistema completo con datos reales:

   ```
   npm run smoke
   ```

5. Enviar una lectura de ejemplo:

   ```
   curl -X POST http://localhost:3000/sensor-data -H "Content-Type: application/json" -d '{"deviceId":"esp32_1","temperatura":"24.50","humedad":"60.00","nivelAgua":2}'
   ```

6. Simular el ESP32 (desde `backend/`, con el servidor en ejecución). Por defecto envía una lectura fija cada diez segundos al dispositivo `esp32_1` hasta que se detiene con Ctrl+C:

   ```
   npm run simulate
   ```

   Opciones disponibles:

   - `--mode fixed|random|alert`: lectura fija, valores aleatorios realistas o un ciclo que provoca alertas.
   - `--interval MS`: intervalo entre envíos en milisegundos (mínimo 100).
   - `--count N`: cantidad de envíos (0 para enviar sin límite).
   - `--url URL`: dirección del backend, por ejemplo la URL pública del túnel.
   - `--device ID`: identificador del dispositivo.
   - `--numbers`: envía temperatura y humedad como números en lugar de texto.

   Ejemplo: `npm run simulate -- --mode alert --interval 2000 --count 8`

7. Ejecutar el frontend:

   ```
   cd frontend
   npm install
   npm run dev
   ```

8. Detener las bases de datos:

   ```
   docker compose down
   ```
