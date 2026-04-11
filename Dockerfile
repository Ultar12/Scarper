# Use a base image with Java and Python (needed for Android SDK and Appium)
FROM ubuntu:22.04

# Avoid prompts during installation
ENV DEBIAN_FRONTEND=noninteractive

# 1. Install System Dependencies
RUN apt-get update && apt-get install -y \
    openjdk-11-jdk \
    wget \
    unzip \
    curl \
    git \
    python3 \
    libpulse0 \
    libglu1-mesa \
    xvfb \
    && rm -rf /var/lib/apt/lists/*

# 2. Install Node.js
RUN curl -sL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs

# 3. Setup Android SDK
ENV ANDROID_SDK_ROOT /opt/android-sdk
RUN mkdir -p $ANDROID_SDK_ROOT/cmdline-tools \
    && wget https://dl.google.com/android/repository/commandlinetools-linux-9477386_latest.zip -O /tmp/tools.zip \
    && unzip /tmp/tools.zip -d $ANDROID_SDK_ROOT/cmdline-tools \
    && mv $ANDROID_SDK_ROOT/cmdline-tools/cmdline-tools $ANDROID_SDK_ROOT/cmdline-tools/latest

ENV PATH $PATH:$ANDROID_SDK_ROOT/cmdline-tools/latest/bin:$ANDROID_SDK_ROOT/platform-tools

# Accept Licenses and Install Emulator + Platform Tools
RUN yes | sdkmanager --licenses \
    && sdkmanager "platform-tools" "emulator" "platforms;android-30" "system-images;android-30;google_apis;x86_64"

# 4. Install Appium
RUN npm install -g appium
RUN appium driver install uiautomator2

# 5. App code setup
WORKDIR /app
COPY package.json .
RUN npm install
COPY . .

# Start Xvfb (Virtual Display) and Appium
CMD Xvfb :99 -screen 0 1080x1920x24 & export DISPLAY=:99 && appium

