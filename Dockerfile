# # ---------- Build stage ----------
# FROM node:20-alpine AS builder

# WORKDIR /usr/src/app

# COPY package*.json ./
# RUN npm install

# COPY . .
# RUN npm run build

# # ---------- Production stage ----------
# FROM node:20-alpine AS production

# WORKDIR /usr/src/app

# ENV NODE_ENV=production

# COPY package*.json ./
# RUN npm install --omit=dev

# COPY --from=builder /usr/src/app/dist ./dist

# EXPOSE 3000

# CMD ["node", "dist/main"]


# ---------- Development stage ----------
# Used by docker-compose for local dev: installs ALL deps (incl. devDependencies)
# and runs `nest start --watch`. Source code is bind-mounted in via docker-compose,
# so edits on your machine trigger a reload inside the container — no `npm run
# start:dev` on the host needed at all.
FROM node:20-alpine AS development

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install

COPY . .

CMD ["npm", "run", "start:dev"]

# ---------- Build stage (for production image) ----------
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# ---------- Production stage ----------
FROM node:20-alpine AS production

WORKDIR /usr/src/app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm install --omit=dev

COPY --from=builder /usr/src/app/dist ./dist

EXPOSE 3000

CMD ["node", "dist/main"]

