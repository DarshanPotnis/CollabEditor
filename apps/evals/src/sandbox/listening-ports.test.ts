import { describe, expect, it } from 'vitest';
import { listeningPorts } from './listening-ports.js';

// Real rows, trimmed: a server on 3000 (IPv4 and IPv6), one established connection, a header.
const PROC_NET_TCP = `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 00000000:0BB8 00000000:0000 0A 00000000:00000000 00:00000000 00000000   501        0 12345 1 0000000000000000 100 0 0 10 0
   1: 0100007F:0BB8 0100007F:A1C2 01 00000000:00000000 00:00000000 00000000   501        0 12346 1 0000000000000000 20 4 30 10 -1
  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 00000000000000000000000000000000:0BB8 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000   501        0 12347 1 0000000000000000 100 0 0 10 0
   1: 00000000000000000000000000000000:1F90 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000   501        0 12348 1 0000000000000000 100 0 0 10 0`;

describe('listeningPorts', () => {
  it('finds the ports in LISTEN state, once each, from IPv4 and IPv6 rows', () => {
    expect(listeningPorts(PROC_NET_TCP)).toEqual([3000, 8080]);
  });

  it('finds none when nothing listens', () => {
    expect(listeningPorts('')).toEqual([]);
    expect(listeningPorts(PROC_NET_TCP.replaceAll(' 0A ', ' 01 '))).toEqual([]);
  });
});
