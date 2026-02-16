FROM node:22-alpine

WORKDIR /app

# Zero dependencies — just copy source
COPY package.json ./
COPY bin/ ./bin/
COPY src/ ./src/

# Copy init script for use by init container
COPY docker/init.sh /app/docker/init.sh
RUN chmod +x /app/docker/init.sh

EXPOSE 8422

CMD ["node", "bin/clawgateway.mjs", "--config", "/data/gateway.json"]
