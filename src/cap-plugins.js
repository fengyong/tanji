/**
 * TanJi · Capacitor 插件桥接入口(打包为 www/cap-plugins.js)
 *
 * 以 IIFE 形式把 @capacitor/core 与 5 个插件打进一个文件,
 * 页面无需打包器即可通过 window.TanjiCap 访问完整插件 API。
 * 纯 Web(非 Capacitor)环境下运行时同样安全:
 * 插件的 native 调用只会由 UI 层按 isNativePlatform() 触发。
 */
import { Capacitor } from '@capacitor/core';
import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Share } from '@capacitor/share';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Clipboard } from '@capacitor/clipboard';

window.TanjiCap = {
  Capacitor,
  CapacitorSQLite,
  SQLiteConnection,
  LocalNotifications,
  Share,
  Filesystem,
  Directory,
  Encoding,
  Clipboard,
};
