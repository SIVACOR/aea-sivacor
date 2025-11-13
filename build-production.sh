#!/bin/bash
set -e

echo "Building SIVACOR for production..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "!! Node.js is required but not installed."
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "!! npm is required but not installed."
    exit 1
fi

# Install dependencies
echo "Installing dependencies..."
npm ci

# Run linting
echo "Running linter..."
npm run lint

# Run type checking
echo "Running type checks..."
npm run check

# Build for production
echo "Building for production..."
npm run build:production

echo "Production build completed successfully!"
echo "Built files are in the 'build' directory"
echo "To build Docker image, run: docker build -t sivacor ."
echo "To start with Docker Compose, run: docker-compose up -d"
