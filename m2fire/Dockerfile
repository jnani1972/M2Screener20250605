# Use the official Node.js image
FROM node:14

# Set the working directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Expose the port (if applicable, change if needed)
EXPOSE 3000

# Command to run the application
CMD ["node", "main_bkp.js"]
