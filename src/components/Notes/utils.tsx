import { Image as ImageIcon, FileText, Video, File } from 'lucide-react';

export const getFileIcon = (fileType: string) => {
  switch (fileType) {
    case 'image':
      return <ImageIcon className="w-5 h-5" />;
    case 'pdf':
      return <FileText className="w-5 h-5" />;
    case 'video':
      return <Video className="w-5 h-5" />;
    default:
      return <File className="w-5 h-5" />;
  }
};

export const formatFileSize = (bytes: number) => {
  if (!bytes) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(1)} ${units[unitIndex]}`;
};
