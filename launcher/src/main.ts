import { Client } from "discord-rpc-patch";
import { app, dialog, ipcMain, net, BrowserWindow, Menu } from "electron";
import started from "electron-squirrel-startup";
import md5file from "md5-file";
import { mkdirp } from "mkdirp";
import { DownloaderHelper, DownloadEndedStats } from "node-downloader-helper";
import StreamZip from "node-stream-zip";
import { setExternalVBSLocation } from "regedit";
import { getAppManifest, getAppPath } from "steam-path";
import {
  makeUserNotifier,
  updateElectronApp,
  UpdateSourceType,
} from "update-electron-app";
import childProcess from "node:child_process";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";

interface FileEntry {
  path: string;
  md5: string;
}

interface Config {
  serverAddress: string;
  serverPassword: string;
  files: FileEntry[];
}

const DIST_URL = "https://.../";
const APP_NAME = "ProjectZomboid";
const SERVER_NAME = "좀보이드";
const STEAM_APP_ID = 108600;
const DISCORD_CLIENT_ID = "...";

let CONFIG: Config | null = null;

const downloadFile = async (
  url: string,
  dest: string,
  fileName: string | undefined,
  updateProgress: (progress: number) => void
) => {
  updateProgress(0);
  await mkdirp(dest);
  const dl = new DownloaderHelper(url, dest, {
    timeout: 10000,
    fileName,
    retry: { maxRetries: 5, delay: 1000 },
    override: true,
  });
  return new Promise<DownloadEndedStats>((resolve, reject) => {
    dl.on("error", reject);
    dl.on("end", resolve);
    dl.on("progress", (e) => e.progress && updateProgress(e.progress));
    dl.start().catch(reject);
  });
};

const findInstallPath = async (window: BrowserWindow) => {
  try {
    return (await getAppPath(STEAM_APP_ID)).path;
  } catch {}
  const defaultPath = path.join(
    "C:\\Program Files (x86)\\Steam\\steamapps\\common",
    APP_NAME
  );
  const { filePaths } = await dialog.showOpenDialog(window, {
    title: `${APP_NAME} 설치 경로를 선택해주세요`,
    properties: ["openDirectory"],
    defaultPath: fs.existsSync(defaultPath) ? defaultPath : undefined,
  });
  if (!filePaths.length) {
    throw new Error("No selected directories");
  }
  const installPath = filePaths[0];
  if (!fs.existsSync(path.join(installPath, `${APP_NAME}64.exe`))) {
    throw new Error("Invalid install path");
  }
  return installPath;
};

app.disableHardwareAcceleration();

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

setExternalVBSLocation(
  MAIN_WINDOW_VITE_DEV_SERVER_URL
    ? "node_modules/regedit/vbs"
    : path.join(process.resourcesPath, "vbs")
);

Menu.setApplicationMenu(null);

updateElectronApp({
  updateSource: {
    type: UpdateSourceType.StaticStorage,
    baseUrl: `https://.../${process.platform}/${process.arch}`,
  },
  onNotifyUser: makeUserNotifier({
    title: "런처 업데이트",
    detail:
      "새 버전이 다운로드되었습니다. 업데이트를 적용하려면 런처를 다시 시작하세요.",
    restartButtonText: "다시 시작",
    laterButtonText: "나중에",
  }),
});

const createWindow = async () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 960,
    height: 540,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#ffffff00",
      symbolColor: "#be7474ff",
      height: 30,
    },
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
    );
  }

  const updateStatus = (status: string, progress: number) => {
    mainWindow.webContents.send("update-status", status, progress);
  };

  ipcMain.on("start", async () => {
    if (!CONFIG) {
      return;
    }
    try {
      updateStatus("설치 경로 찾는 중", 0);
      let isBuild42 = false;
      try {
        const appManifest = await getAppManifest(STEAM_APP_ID);
        isBuild42 = appManifest.AppState.buildid === 22430415;
      } catch {}
      if (isBuild42) {
        throw new Error("Steam에서 기본 공개(stable) 버전을 선택하여 주세요!")
      }

      const installPath = await findInstallPath(mainWindow);
      const javaPath = path.join(installPath, "jdk/bin/java.exe");

      if (!fs.existsSync(javaPath)) {
        const jdk = await downloadFile(
          "https://corretto.aws/downloads/latest/amazon-corretto-17-x64-windows-jdk.zip",
          path.join(app.getPath("userData"), "downloads"),
          "jdk.zip",
          (p) => updateStatus("Java 다운로드 중", p)
        );

        const res = await net.fetch(
          "https://corretto.aws/downloads/latest_checksum/amazon-corretto-17-x64-windows-jdk.zip"
        );
        const md5 = await res.text();
        if ((await md5file(jdk.filePath)) !== md5) {
          throw new Error("Java checksum failed!");
        }

        updateStatus("Java 설치 중", 0);
        const zip = new StreamZip.async({
          file: jdk.filePath,
          storeEntries: true,
        });
        const entries = Object.keys(await zip.entries());
        let count = 0;
        zip.on("extract", () => {
          updateStatus("Java 설치 중", (count++ * 100) / entries.length);
        });
        await zip.extract(entries[0], path.join(installPath, "jdk"));
        await zip.close();
        updateStatus("Java 설치 중", 100);
      }

      const totalFiles = CONFIG.files.length;
      for (let i = 0; i < totalFiles; i++) {
        const status = `파일 설치 중 (${i + 1}/${totalFiles})`;
        updateStatus(status, (i / totalFiles) * 100);
        const file = CONFIG.files[i];
        const filePath = path.join(installPath, file.path);
        if (
          !fs.existsSync(filePath) ||
          (await md5file(filePath)) !== file.md5
        ) {
          const backup = `${filePath}.bak`;
          if (fs.existsSync(filePath) && !fs.existsSync(backup)) {
            await fsPromises.rename(filePath, backup);
          }
          await downloadFile(
            `${DIST_URL}${file.path}`,
            path.dirname(filePath),
            path.basename(filePath),
            (p) => updateStatus(status, (i * 100 + p) / totalFiles)
          );
        }
      }

      try {
        const discordClient = new Client({ transport: "ipc" });
        discordClient.on("ready", () => {
          discordClient.setActivity({
            details: `${SERVER_NAME} 하는 중`,
            state: APP_NAME,
            largeImageKey: "large",
            largeImageText: SERVER_NAME,
            startTimestamp: new Date().getTime(),
            instance: false,
          });
        });
        await discordClient.login({ clientId: DISCORD_CLIENT_ID });
      } catch {}

      const totalmem = os.totalmem();
      const mem =
        totalmem >= 16 * 1073741824
          ? "8G"
          : totalmem >= 8 * 1073741824
            ? "4G"
            : totalmem >= 6 * 1073741824
              ? "3G"
              : "2G";
      const classPath = [
        "./",
        "istack-commons-runtime.jar",
        "jassimp.jar",
        "javacord-2.0.17-shaded.jar",
        "javax.activation-api.jar",
        "jaxb-api.jar",
        "jaxb-runtime.jar",
        "lwjgl.jar",
        "lwjgl-glfw.jar",
        "lwjgl-jemalloc.jar",
        "lwjgl-opengl.jar",
        "lwjgl_util.jar",
        "sqlite-jdbc-3.27.2.1.jar",
        "trove-3.0.3.jar",
        "uncommons-maths-1.2.3.jar",
        "commons-compress-1.18.jar",
        "lwjgl-natives-windows.jar",
        "lwjgl-glfw-natives-windows.jar",
        "lwjgl-jemalloc-natives-windows.jar",
        "lwjgl-opengl-natives-windows.jar",
        "CollaBot-Core-1.0.0.jar",
      ];
      const javaArgs = [
        "-Djdk.attach.allowAttachSelf=true",
        "-XX:+EnableDynamicAgentLoading",
        "-Djava.awt.headless=true",
        "-Davrix.mode=client",
        "-Dzomboid.steam=1",
        "-Dzomboid.znetlog=1",
        `-Dargs.server.connect=${CONFIG.serverAddress}`,
        `-Dargs.server.password=${CONFIG.serverPassword}`,
        "-XX:+UseZGC",
        `-Xms${mem}`,
        `-Xmx${mem}`,
        "-XX:+AlwaysPreTouch",
        "-XX:-CreateCoredumpOnCrash",
        "-XX:-OmitStackTraceInFastThrow",
        "-Djava.library.path=./;win64/",
        "-cp",
        classPath.join(";"),
        "com.avrix.Launcher",
      ];

      updateStatus(`${APP_NAME} 실행 중`, 0);
      const child = childProcess.spawn(javaPath, javaArgs, {
        cwd: installPath,
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      updateStatus(`${APP_NAME} 실행 중`, 100);
    } catch (e) {
      updateStatus(e.name ? `${e.name}: ${e.message}` : `${e}`, -1);
    }
  });

  ipcMain.on("show-menu", (e) => {
    const window = BrowserWindow.fromWebContents(e.sender);
    const template = [
      {
        label: "개발자 도구 열기",
        click: () => {
          window.webContents.toggleDevTools();
        },
      },
      {
        label: "패치 파일 삭제",
        click: async () => {
          const installPath = await findInstallPath(window);
          const totalFiles = CONFIG.files.length;
          for (let i = 0; i < totalFiles; i++) {
            updateStatus(
              `파일 삭제 중 (${i + 1}/${totalFiles})`,
              (i / totalFiles) * 100
            );
            const file = CONFIG.files[i];
            const filePath = path.join(installPath, file.path);
            try {
              await fsPromises.rm(filePath, { force: true });
              const backup = `${filePath}.bak`;
              if (fs.existsSync(backup)) {
                await fsPromises.rename(backup, filePath);
              }
            } catch {}
          }
          updateStatus("파일 삭제 완료", 100);
        },
      },
    ];
    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window });
  });

  try {
    const res = await net.fetch(`${DIST_URL}config.json`, { cache: "no-cache" });
    if (!res.ok) {
      throw new Error(`Failed to fetch config: ${res.status}`);
    }
    CONFIG = await res.json();
  } catch (e) {
    updateStatus(e.name ? `${e.name}: ${e.message}` : `${e}`, -1);
  }
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on("ready", createWindow);

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on("web-contents-created", (event, contents) => {
  contents.on("will-navigate", (e, navigationUrl) => {
    e.preventDefault();
  });
  contents.setWindowOpenHandler((details) => ({ action: "deny" }));
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
