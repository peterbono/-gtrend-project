# Image cloud : web app + listener WhatsApp + Chromium, dans un seul process.
FROM node:22-slim

# Dependances systeme de Chromium (pour puppeteer / whatsapp-web.js).
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium ca-certificates fonts-liberation \
    libnss3 libatk-bridge2.0-0 libatk1.0-0 libcups2 libdrm2 libxkbcommon0 \
    libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 \
  && rm -rf /var/lib/apt/lists/*

# On utilise le Chromium de Debian (pas le telechargement de puppeteer).
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "src/app.js"]
