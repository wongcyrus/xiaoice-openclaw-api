#!/bin/bash
set -e

# Clear screen and show a beautiful premium banner
clear
echo -e "\033[1;35m"
echo "  _  _                     _                     _                "
echo " | |/ /                    (_)                   | |               "
echo " | ' /  __ _  ___   _  ___  _  ___  ___  _ __    | |  _ __  _   _  "
echo " |  <  / _\` |/ _ \ | |/ _ \| |/ __|/ _ \| '_ \   | | | '_ \| | | | "
echo " | . \| (_| | (_) || | (_) | | (__| (_) | | | |  | |_| |_) | |_| | "
echo " |_|\_\\__,_|\___/ |_|\___/|_|\___|\___/|_| |_|  |_(_) .__/ \__, | "
echo "                                                     | |    __/ | "
echo "     Xiaoice-to-OpenClaw Dialogue Bridge API         |_|   |___/  "
echo -e "\033[0m"

# Get current script directory
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

# 1. Install dependencies if node_modules is missing
if [ ! -d "node_modules" ]; then
    echo -e "\033[1;34m[System] Installing Node dependencies...\033[0m"
    npm install
    echo -e "\033[1;32m[System] Dependencies installed successfully!\033[0m"
else
    echo -e "\033[1;32m[System] node_modules exists, skipping installation.\033[0m"
fi

# 2. Check if .env file exists, otherwise copy .env.example
if [ ! -f ".env" ]; then
    echo -e "\033[1;33m[Warning] .env file not found, creating from .env.example...\033[0m"
    cp .env.example .env
fi

# 3. Spin up the Express development server
echo -e "\033[1;36m[System] Starting local Express development server via tsx...\033[0m"
npm run dev
