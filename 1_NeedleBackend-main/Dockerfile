# Start from an official Node image
FROM node:18-bullseye

# Install ffmpeg or sox if you need them
RUN apt-get update && apt-get install -y ffmpeg sox

# Create app directory
WORKDIR /usr/src/app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the code
COPY . .

# Expose the port your app will run on (e.g., 3000)
EXPOSE 3000

# Define the command to run your server
CMD ["npm", "start"]