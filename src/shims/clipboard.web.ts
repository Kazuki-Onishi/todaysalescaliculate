export async function setString(value: string): Promise<void> {
  if (navigator?.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
    } catch (error) {
      console.warn('Clipboard write failed in web shim', error);
    }
  }
}

export async function getString(): Promise<string> {
  if (navigator?.clipboard?.readText) {
    try {
      return await navigator.clipboard.readText();
    } catch (error) {
      console.warn('Clipboard read failed in web shim', error);
    }
  }
  return '';
}

export async function getStringOfType(): Promise<string> {
  return await getString();
}

export async function getStringWithOptions(): Promise<string> {
  return await getString();
}

export async function hasString(): Promise<boolean> {
  return (await getString()).length > 0;
}

export async function hasURL(): Promise<boolean> {
  return false;
}

export async function hasNumber(): Promise<boolean> {
  return false;
}

export async function hasImage(): Promise<boolean> {
  return false;
}

const Clipboard = {
  setString,
  getString,
  getStringOfType,
  getStringWithOptions,
  hasString,
  hasURL,
  hasNumber,
  hasImage,
};

export default Clipboard;
