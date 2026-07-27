import { app, BrowserWindow } from "electron";
import { readFileSync } from "fs";
import { modelFromArtifact, renderReviewShell } from "./reviewArtifact";
import { loadReviewArtifactFromArgs } from "./mainModel";

async function createWindow(): Promise<void> {
  const artifact = loadReviewArtifactFromArgs(process.argv, (path) => readFileSync(path, "utf8"));
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(renderReviewShell(modelFromArtifact(artifact)))}`);
}

void app.whenReady().then(createWindow);


void app.whenReady().then(createWindow);