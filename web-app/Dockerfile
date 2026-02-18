# Build stage
FROM node:22 AS build

# Install pnpm
RUN npm install -g pnpm@9.2.0

# Set working directory
WORKDIR /app

# Copy package files for better caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web-app/package.json ./web-app/
COPY contracts/package.json ./contracts/
COPY setup-permissions/package.json ./setup-permissions/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build arguments for environment variables
ARG VITE_COUNTER_CONTRACT_ADDRESS
ARG VITE_PRIVIDIUM_RPC_URL
ARG VITE_CHAIN_ID
ARG VITE_CHAIN_NAME
ARG VITE_NATIVE_CURRENCY_SYMBOL
ARG VITE_AUTH_BASE_URL
ARG VITE_PRIVIDIUM_API_URL
ARG VITE_CLIENT_ID
ARG VITE_COMPANY_NAME
ARG VITE_ACCENT_COLOR
ARG VITE_COMPANY_ICON

# Set environment variables for build stage (Vite uses these at build time)
ENV VITE_COUNTER_CONTRACT_ADDRESS=$VITE_COUNTER_CONTRACT_ADDRESS
ENV VITE_PRIVIDIUM_RPC_URL=$VITE_PRIVIDIUM_RPC_URL
ENV VITE_CHAIN_ID=$VITE_CHAIN_ID
ENV VITE_CHAIN_NAME=$VITE_CHAIN_NAME
ENV VITE_NATIVE_CURRENCY_SYMBOL=$VITE_NATIVE_CURRENCY_SYMBOL
ENV VITE_AUTH_BASE_URL=$VITE_AUTH_BASE_URL
ENV VITE_PRIVIDIUM_API_URL=$VITE_PRIVIDIUM_API_URL
ENV VITE_CLIENT_ID=$VITE_CLIENT_ID
ENV VITE_COMPANY_NAME=$VITE_COMPANY_NAME
ENV VITE_ACCENT_COLOR=$VITE_ACCENT_COLOR
ENV VITE_COMPANY_ICON=$VITE_COMPANY_ICON

# Build the application
RUN pnpm --filter web-app build

# Production stage
FROM node:22 AS production

# Install http-server globally
RUN npm install -g http-server

# Set working directory
WORKDIR /app

# Copy built files from build stage
COPY --from=build /app/web-app/dist ./dist

# Expose port 4000
EXPOSE 4000

# Start http-server with SPA support on port 4000
# The proxy flag to itself is a common trick for http-server to handle SPA routing
CMD ["http-server", "dist", "-p", "4000", "--proxy", "http://localhost:4000?"]
