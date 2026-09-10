FROM node:22-alpine AS build
WORKDIR /build/apps/live-gateway
COPY apps/live-gateway/package.json apps/live-gateway/package-lock.json ./
RUN npm ci
COPY src /build/src
COPY apps/live-gateway ./
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production DATA_DIR=/data PORT=3390 HOST=0.0.0.0
WORKDIR /app
COPY --from=build /build/apps/live-gateway/package.json ./package.json
COPY --from=build /build/apps/live-gateway/src ./src
COPY --from=build /build/apps/live-gateway/public ./public
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 3390
VOLUME /data
CMD ["node","src/main.mjs"]
