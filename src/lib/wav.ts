// Minimal WAV helpers. Pure module (no imports) so it can be unit-tested.
// Sarvam recordings are 16-bit PCM stereo (caller and agent on separate channels).
// Mixing them to mono keeps both voices and halves the stored size.

export interface WavInfo {
  format: number;
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  dataOffset: number;
  dataLength: number;
}

export function parseWav(buf: Uint8Array): WavInfo | null {
  if (buf.length < 44) return null;
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tag = (o: number) => String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let off = 12;
  let fmt: Omit<WavInfo, 'dataOffset' | 'dataLength'> | null = null;
  while (off + 8 <= buf.length) {
    const id = tag(off);
    let size = v.getUint32(off + 4, true);
    const body = off + 8;
    if (id === 'fmt ' && body + 16 <= buf.length) {
      fmt = { format: v.getUint16(body, true), channels: v.getUint16(body + 2, true), sampleRate: v.getUint32(body + 4, true), bitsPerSample: v.getUint16(body + 14, true) };
    } else if (id === 'data' && fmt) {
      if (size === 0 || body + size > buf.length) size = buf.length - body; // streamed files may leave size unset
      return { ...fmt, dataOffset: body, dataLength: size - (size % 2) };
    }
    off = body + size + (size % 2);
  }
  return null;
}

/** Seconds of audio, or null when the file is not a WAV we understand. */
export function wavDurationSeconds(buf: Uint8Array): number | null {
  const w = parseWav(buf);
  if (!w || !w.sampleRate || !w.channels || !w.bitsPerSample) return null;
  return w.dataLength / (w.sampleRate * w.channels * (w.bitsPerSample / 8));
}

function header(dataLength: number, channels: number, sampleRate: number, bits: number): Uint8Array {
  const h = new Uint8Array(44);
  const v = new DataView(h.buffer);
  const put = (o: number, s: string) => [...s].forEach((c, i) => (h[o + i] = c.charCodeAt(0)));
  put(0, 'RIFF');
  v.setUint32(4, 36 + dataLength, true);
  put(8, 'WAVE');
  put(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * channels * (bits / 8), true);
  v.setUint16(32, channels * (bits / 8), true);
  v.setUint16(34, bits, true);
  put(36, 'data');
  v.setUint32(40, dataLength, true);
  return h;
}

/** Mixes 16-bit PCM stereo to mono. Returns the input unchanged for any other layout. */
export function stereoToMono(buf: Uint8Array): Uint8Array {
  const w = parseWav(buf);
  if (!w || w.format !== 1 || w.channels !== 2 || w.bitsPerSample !== 16) return buf;
  const frames = Math.floor(w.dataLength / 4);
  const out = new Uint8Array(44 + frames * 2);
  out.set(header(frames * 2, 1, w.sampleRate, 16), 0);
  const src = new DataView(buf.buffer, buf.byteOffset + w.dataOffset, frames * 4);
  const dst = new DataView(out.buffer, 44, frames * 2);
  for (let i = 0; i < frames; i++) {
    const m = src.getInt16(i * 4, true) + src.getInt16(i * 4 + 2, true);
    dst.setInt16(i * 2, Math.max(-32768, Math.min(32767, m)), true); // sum: both voices stay audible
  }
  return out;
}
