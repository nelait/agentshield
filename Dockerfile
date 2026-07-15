FROM node:20-alpine

# Install OPA binary for Rego policy compilation
RUN apk add --no-cache wget tar && \
    wget -q -O /usr/local/bin/opa https://openpolicyagent.org/downloads/v1.4.2/opa_linux_amd64_static && \
    chmod +x /usr/local/bin/opa && \
    apk del wget

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY . .

EXPOSE 3000

CMD ["node", "src/index.js"]
