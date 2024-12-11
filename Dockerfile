FROM node:18

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY . .

# Install dependencies
RUN npm ci --production

# Start the application
CMD ["npm", "run", "start"]
