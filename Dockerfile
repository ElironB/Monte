FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --ignore-scripts

COPY src ./src
RUN npm run build

RUN npm prune --production && apk del python3 make g++

EXPOSE 3000

CMD ["node", "dist/index.js"]
