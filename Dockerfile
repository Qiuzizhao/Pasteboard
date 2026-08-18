FROM node:22-alpine

WORKDIR /srv

# 零依赖，无需 npm install
COPY app ./app

ENV NODE_ENV=production
ENV CLIPBOARD_DATA_DIR=/data

EXPOSE 8000

CMD ["node", "app/server.js"]
