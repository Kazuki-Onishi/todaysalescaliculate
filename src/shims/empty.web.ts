export const DocumentDirectoryPath = '/';

export async function readFile(uri: string, encoding: string = 'utf8'): Promise<string> {
  const response = await fetch(uri);
  if (!response.ok) {
    throw new Error(`Failed to read file: ${response.status} ${response.statusText}`);
  }
  if (encoding === 'base64') {
    const buffer = await response.arrayBuffer();
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i += 1) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
  return await response.text();
}

export async function writeFile(_path: string, _data: string): Promise<void> {
  console.warn('writeFile stub called in web shim – no-op');
}

export const fs = {
  readFile,
  writeFile,
};

const shim = {
  DocumentDirectoryPath,
  readFile,
  writeFile,
  fs,
};

export default shim;
