const { spawn } = require("child_process");
const path = require("path");
const vscode = path.join(process.cwd(), ".vscode-test", "vscode-win32-x64-archive-1.126.0", "Code.exe");
const proc = spawn(vscode, [
  "C:\\Users\\nickn\\AppData\\Local\\Temp\\kilo\\fixture",
  "--user-data-dir=C:\\Users\\nickn\\AppData\\Local\\Temp\\kilo\\test-udd",
  "--extensionDevelopmentPath=C:\\Users\\nickn\\OneDrive\\Documents\\GitHub\\py-semantic-diff\\plugins\\vscode",
  "--disable-workspace-trust",
], { detached: true, stdio: "ignore" });
proc.unref();
process.stdout.write("spawned " + proc.pid + "\n");
