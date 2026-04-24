FROM node:20-alpine

ENV NODE_ENV=development \
    NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

RUN addgroup -S nodejs && adduser -S nextjs -G nodejs

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3000

CMD ["npm", "run", "dev", "--", "--hostname", "0.0.0.0", "--port", "3000"]
