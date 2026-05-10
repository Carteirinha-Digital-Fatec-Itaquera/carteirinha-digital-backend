FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma/

RUN npm install
RUN npx prisma generate 

COPY . .

ENV DATABASE_URL="postgresql://neondb_owner:npg_MF1PejVXlpW0@ep-rough-waterfall-ac4k774j.sa-east-1.aws.neon.tech/neondb?sslmode=require"
ENV DIRECT_URL="postgresql://neondb_owner:npg_MF1PejVXlpW0@ep-rough-waterfall-ac4k774j.sa-east-1.aws.neon.tech/neondb?sslmode=require"
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

ENV NODE_ENV=production
EXPOSE 3000
# CMD ["npm", "run", "start:prod"]
CMD ["node", "dist/src/main.js"]