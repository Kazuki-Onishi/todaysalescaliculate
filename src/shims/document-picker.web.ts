export type DocumentPickerResponse = {
  uri: string;
  name?: string;
  size?: number;
  type?: string;
};

type PickOptions = {
  type?: string[];
  copyTo?: 'cachesDirectory';
};

export const types = {
  csv: 'text/csv',
  plainText: 'text/plain',
};

export function isCancel(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export async function pickSingle(_options?: PickOptions): Promise<DocumentPickerResponse> {
  return new Promise<DocumentPickerResponse>((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = (_options?.type ?? []).join(',');
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        reject(new Error('No file selected'));
        return;
      }
      const uri = URL.createObjectURL(file);
      resolve({
        uri,
        name: file.name,
        size: file.size,
        type: file.type,
      });
    };
    input.onerror = () => reject(input.error ?? new Error('File selection error'));
    input.click();
  });
}

const DocumentPicker = {
  pickSingle,
  isCancel,
  types,
};

export default DocumentPicker;
