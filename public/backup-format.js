(() => {
  const kind = manifest => typeof manifest?.format === 'string' ? manifest.format.split('-').at(-1) : '';
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const header = (name, size) => {
    const bytes = new Uint8Array(512);
    const write = (offset, length, value) => bytes.set(encoder.encode(String(value)).slice(0, length), offset);
    const octal = (offset, length, value) => write(offset, length, Math.floor(value).toString(8).padStart(length - 1, '0') + '\0');
    write(0, 100, name); octal(100, 8, 0o644); octal(108, 8, 0); octal(116, 8, 0); octal(124, 12, size); octal(136, 12, Date.now() / 1000);
    bytes.fill(32, 148, 156); bytes[156] = 48; write(257, 6, 'ustar\0'); write(263, 2, '00');
    const checksum = bytes.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0');
    write(148, 8, `${checksum}\0 `);
    return bytes;
  };
  globalThis.LogbuchBackupFormat = Object.freeze({
    isProjectManifest: manifest => manifest?.version === 1 && ['projects', 'backup'].includes(kind(manifest)),
    isUserManifest: manifest => manifest?.version === 1 && kind(manifest) === 'users',
  });
  globalThis.LogbuchBackupArchive = Object.freeze({
    async create(files) {
      const chunks = [];
      for (const [name, content] of files) {
        const data = typeof content === 'string' ? encoder.encode(content) : content instanceof Uint8Array ? content : new Uint8Array(await content.arrayBuffer());
        chunks.push(header(name, data.length), data);
        const padding = (512 - data.length % 512) % 512;
        if (padding) chunks.push(new Uint8Array(padding));
      }
      chunks.push(new Uint8Array(1024));
      return new Blob(chunks, { type:'application/x-tar' });
    },
    parse(buffer) {
      const bytes = new Uint8Array(buffer);
      const files = new Map();
      let offset = 0;
      while (offset + 512 <= bytes.length) {
        const current = bytes.slice(offset, offset + 512);
        if (current.every(byte => byte === 0)) break;
        const text = (start, length) => decoder.decode(current.slice(start, start + length)).replace(/\0.*$/, '').trim();
        const name = text(0, 100);
        const size = Number.parseInt(text(124, 12) || '0', 8);
        if (!name || !Number.isFinite(size) || size < 0 || offset + 512 + size > bytes.length) throw new Error('Das TAR-Archiv ist beschädigt');
        files.set(name, bytes.slice(offset + 512, offset + 512 + size));
        offset += 512 + Math.ceil(size / 512) * 512;
      }
      return files;
    },
  });
})();
