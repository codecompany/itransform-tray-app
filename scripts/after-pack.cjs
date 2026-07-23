"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const plist = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Info.plist");
  if (!fs.existsSync(plist)) return;
  for (const key of [
    "NSAppTransportSecurity",
    "NSAudioCaptureUsageDescription",
    "NSBluetoothAlwaysUsageDescription",
    "NSBluetoothPeripheralUsageDescription",
    "NSCameraUsageDescription",
    "NSMicrophoneUsageDescription"
  ]) {
    try {
      execFileSync("/usr/libexec/PlistBuddy", ["-c", `Delete :${key}`, plist]);
    } catch {
      // The key is optional and may be absent in future Electron versions.
    }
  }
};
