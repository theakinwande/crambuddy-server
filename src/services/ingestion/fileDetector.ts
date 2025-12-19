export type FileType = 'pdf' | 'image' | 'audio' | 'unknown';

export function detectFileType(mimeType: string): FileType {
  if (mimeType === 'application/pdf') {
    return 'pdf';
  }
  
  if (mimeType.startsWith('image/')) {
    return 'image';
  }
  
  if (mimeType.startsWith('audio/')) {
    return 'audio';
  }
  
  return 'unknown';
}

export function getFileExtension(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    'application/pdf': '.pdf',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'audio/mpeg': '.mp3',
    'audio/wav': '.wav',
    'audio/ogg': '.ogg',
    'audio/webm': '.webm'
  };
  
  return mimeToExt[mimeType] || '';
}
