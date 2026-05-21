# Stage 1: Build TypeScript into Javascript
FROM node:22-alpine AS builder

WORKDIR /app

# Copy dependency manifests
COPY package*.json ./

# Install all dependencies (including devDependencies for tsc)
RUN npm ci

# Copy tsconfig and source code
COPY tsconfig.json ./
COPY src/ ./src/

# Compile TypeScript
RUN npm run build


# Stage 2: Production execution environment
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Copy dependency manifests
COPY package*.json ./

# Install only production dependencies
RUN npm ci --omit=dev

# Copy compiled JavaScript files
COPY --from=builder /app/dist ./dist

# Copy static frontend public assets
COPY src/public/ ./src/public/

# Expose API Bridge Port
EXPOSE 3002

# Run the compiled production application
CMD ["npm", "start"]
