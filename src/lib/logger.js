export function createLogger(stream = process.stdout) {
  const write = (severity) => (message, fields = {}) => {
    stream.write(`${JSON.stringify({ severity, message, time: new Date().toISOString(), ...fields })}\n`);
  };
  return { info: write('INFO'), warn: write('WARNING'), error: write('ERROR') };
}

export const silentLogger = { info() {}, warn() {}, error() {} };
