import path from "node:path";

// Supported Windows Node distribution layout. Adjacent npm bytes still require
// toolchain admission; absence fails rather than selecting another executable.
export function getNpmCommand(args) {
  if (process.platform === "win32") {
    return {
      command: process.execPath,
      args: [path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"), ...args],
    };
  }
  return { command: "npm", args: [...args] };
}
