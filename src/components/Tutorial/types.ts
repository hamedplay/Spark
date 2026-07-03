import type { ElementType } from 'react';

export interface IconItem {
  icon: ElementType;
  name: string;
  desc: string;
  color?: string;
}

export interface GuideSection {
  id: string;
  title: string;
  icon: ElementType;
  color: string;
  gradient: string;
  overview: string;
  icons: IconItem[];
  steps: { title: string; items: string[] }[];
  tips: string[];
  sparkQuestions: string[];
}
