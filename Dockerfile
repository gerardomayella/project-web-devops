FROM node:20-alpine

ENV NODE_ENV=development

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

USER node

EXPOSE 3000

CMD ["npm", "run", "dev"]
