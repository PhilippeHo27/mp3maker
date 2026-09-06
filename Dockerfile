FROM node:24.14.0-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY server.js ./
COPY lib ./lib
COPY public ./public
ENV NODE_ENV=production PORT=3003 INTERNAL_PORT=3004 INTERNAL_HOST=0.0.0.0 DATA_DIR=/data
USER node
EXPOSE 3003
CMD ["node", "server.js"]
