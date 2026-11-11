# Taller 5 - Conexión IoT

## Introducción

Este proyecto recibe las mediciones que un dispositivo ESP32 envía cada diez segundos en formato JSON (identificador del dispositivo, temperatura, humedad y nivel de agua) y las pone a disposición de una aplicación web.

El backend expone el endpoint `POST /sensor-data` para recibir los datos, los valida y los almacena. MongoDB conserva el historial completo de lecturas y de alertas, y Valkey (base de datos clave-valor compatible con Redis) mantiene el estado reciente: la última lectura, las diez últimas lecturas, el indicador de dispositivo en línea y los avisos de nuevas lecturas. El sistema genera alertas cuando la temperatura supera un valor máximo o cuando el nivel de agua es bajo, con un tiempo de espera para no repetirlas continuamente. Además, ofrece endpoints de consulta para las últimas lecturas, las estadísticas por hora, los dispositivos, las alertas y el estado del servicio.

El frontend es un proyecto independiente, construido con Vite, destinado a mostrar los datos de los sensores.

## Librerías y dependencias

Requisitos generales: Node.js 20 o superior, npm y Docker con Docker Compose.

Backend (`backend/`), dependencias de ejecución:

- express: servidor HTTP y definición de endpoints.
- mongodb: controlador oficial para conectarse a MongoDB.
- ioredis: cliente para Valkey (compatible con el protocolo de Redis).
- ws: biblioteca de WebSocket, prevista para la transmisión de datos en tiempo real.
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
│   │   └── smoke.js          Prueba de humo contra el sistema en ejecución
│   ├── src/
│   │   ├── server.js         Punto de entrada: conexiones y arranque
│   │   ├── app.js            Construcción de la aplicación Express
│   │   ├── config.js         Lectura de variables de entorno
│   │   ├── db/               Conexiones a MongoDB y Valkey
│   │   ├── middleware/       Lectura tolerante del cuerpo JSON
│   │   ├── validation/       Validación de los datos del sensor
│   │   ├── repositories/     Acceso a MongoDB (lecturas, alertas) y a Valkey
│   │   ├── services/         Lógica de ingesta y de alertas
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

   Las variables de entorno tienen valores por defecto, por lo que el archivo `.env` es opcional para una ejecución local. El servidor queda disponible en `http://localhost:3000`.

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

6. Ejecutar el frontend:

   ```
   cd frontend
   npm install
   npm run dev
   ```

7. Detener las bases de datos:

   ```
   docker compose down
   ```
