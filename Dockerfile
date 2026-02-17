FROM node:22-alpine

WORKDIR /app

# Zero dependencies — just copy source
COPY package.json ./
COPY bin/ ./bin/
COPY src/ ./src/

EXPOSE 8422

CMD ["node", "bin/clawgateway.mjs"]
