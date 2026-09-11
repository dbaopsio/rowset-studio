const ROW_BACKUP_KEY = "rowset.editor.backupRows";

// Saving rows before UPDATE/DELETE is on unless the user turned it off.
export function rowBackupEnabled() {
  return localStorage.getItem(ROW_BACKUP_KEY) !== "off";
}

export function setRowBackupEnabled(on: boolean) {
  localStorage.setItem(ROW_BACKUP_KEY, on ? "on" : "off");
}
