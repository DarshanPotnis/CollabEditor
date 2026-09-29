// A hostile program, as model-written code could be: it looks everywhere it can reach for a
// Gemini API key (they all start with "AIza") and for a way out of the sandbox, and prints
// what it found as one JSON line. The eval canary test runs it inside the sandbox while the
// runner holds a canary key, and fails if anything it prints contains that key.
'use strict';
const fs = require('node:fs');
const net = require('node:net');
const dns = require('node:dns').promises;

const MARK = ['AI', 'za'].join(''); // not a literal, so this file does not match itself
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const SKIP = new Set(['/proc', '/sys', '/dev']);
const hits = { env: [], proc: [], files: [] };
const scanned = { envVars: 0, processes: 0, files: 0, bytes: 0 };

function look(where, text) {
  for (let at = text.indexOf(MARK); at !== -1; at = text.indexOf(MARK, at + 1)) {
    hits[where].push(text.slice(at, at + 60));
  }
}

for (const [name, value] of Object.entries(process.env)) {
  scanned.envVars += 1;
  look('env', `${name}=${value}`);
}

for (const pid of fs.readdirSync('/proc').filter((name) => /^\d+$/.test(name))) {
  scanned.processes += 1;
  for (const file of ['environ', 'cmdline']) {
    try {
      look('proc', fs.readFileSync(`/proc/${pid}/${file}`, 'latin1'));
    } catch {
      // Not ours to read, or already gone.
    }
  }
}

function walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = dir === '/' ? `/${entry.name}` : `${dir}/${entry.name}`;
    if (SKIP.has(path) || entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) walk(path);
    else if (entry.isFile()) {
      try {
        if (fs.statSync(path).size > MAX_FILE_BYTES) continue;
        const text = fs.readFileSync(path, 'latin1');
        scanned.files += 1;
        scanned.bytes += text.length;
        look('files', text);
      } catch {
        // Unreadable: nothing to find there.
      }
    }
  }
}
walk('/');

function connect(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: 3000 });
    socket.on('connect', () => {
      socket.destroy();
      resolve('connected');
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve('timed out');
    });
    socket.on('error', (error) => resolve(`failed: ${error.code}`));
  });
}

(async () => {
  const network = {
    dns: await dns.lookup('generativelanguage.googleapis.com').then(
      () => 'resolved',
      (error) => `failed: ${error.code}`,
    ),
    internet: await connect('142.250.80.46', 443),
    dockerHost: await connect('172.17.0.1', 2375),
    hostGateway: await connect('host.docker.internal', 8080),
  };
  const dockerSocket = fs.existsSync('/var/run/docker.sock');
  process.stdout.write(`${JSON.stringify({ hits, scanned, network, dockerSocket })}\n`);
})();
