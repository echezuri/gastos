FROM node:22-alpine

WORKDIR /app
COPY package.json ./
COPY server.js db.js auth.js ./
COPY public ./public
COPY tools ./tools

# La base vive en el volumen, no en la imagen: así sobrevive a cada deploy.
ENV NODE_ENV=production
ENV GASTOS_DB=/data/gastos.db
ENV PORT=8080
EXPOSE 8080

CMD ["node", "--no-warnings=ExperimentalWarning", "server.js"]
