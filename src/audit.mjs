import { createWriteStream } from 'node:fs';

export function createAuditLogger(logPath) {
  let stream = null;
  if (logPath) {
    stream = createWriteStream(logPath, { flags: 'a' });
  }

  return {
    log(entry) {
      const record = {
        ts: new Date().toISOString(),
        ...entry
      };
      const line = JSON.stringify(record);

      if (stream) {
        stream.write(line + '\n');
      } else {
        console.log(`[audit] ${line}`);
      }
    },

    close() {
      if (stream) stream.end();
    }
  };
}
