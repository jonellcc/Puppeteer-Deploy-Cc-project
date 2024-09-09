FROM node:latest

RUN apt-get update && \
    apt-get install -y wget gnupg ca-certificates chromium ffmpeg 

WORKDIR /app

COPY package.json ./

RUN npm install

COPY . .

EXPOSE 3000

CMD ["node", "index.js"]