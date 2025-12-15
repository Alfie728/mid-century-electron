// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

// Note: This project currently uses contextIsolation: false and nodeIntegration: true,
// which allows the renderer process to import ipcRenderer directly from "electron".
//
// Available IPC channels:
// - getSources: Get available screen/window sources for capture
// - showSaveDialog: Show native save dialog
// - getOperatingSystem: Get current OS platform
// - startInputCapture: Start global input capture (sessionId, sessionStartTime)
// - stopInputCapture: Stop global input capture
// - checkAccessibilityPermission: Check if accessibility permission is granted (macOS)
// - action: (listen) Receive captured input actions from main process
//
// TODO: For production, enable contextIsolation and use contextBridge:
// contextBridge.exposeInMainWorld("electronAPI", {
//   getSources: () => ipcRenderer.invoke("getSources"),
//   showSaveDialog: () => ipcRenderer.invoke("showSaveDialog"),
//   getOperatingSystem: () => ipcRenderer.invoke("getOperatingSystem"),
//   startInputCapture: (sessionId, sessionStartTime) =>
//     ipcRenderer.invoke("startInputCapture", sessionId, sessionStartTime),
//   stopInputCapture: () => ipcRenderer.invoke("stopInputCapture"),
//   checkAccessibilityPermission: () => ipcRenderer.invoke("checkAccessibilityPermission"),
//   onAction: (callback) => ipcRenderer.on("action", (_, action) => callback(action)),
//   removeActionListener: (callback) => ipcRenderer.removeListener("action", callback),
// });
