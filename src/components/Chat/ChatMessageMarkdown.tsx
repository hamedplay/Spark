import type { ReactNode } from 'react';
import type { UserProfile } from './types';
import { FALLBACK_NAME } from '../../lib/useOrgUsers';

type InlineToken =
  | { type: 'bold'; content: string }
  | { type: 'italic'; content: string }
  | { type: 'strike'; content: string }
  | { type: 'code'; content: string }
  | { type: 'link'; text: string; url: string }
  | { type: 'mention'; user: UserProfile }
  | { type: 'text'; content: string };

const INLINE_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: 'bold', regex: /\*\*(.+?)\*\*/ },
  { name: 'italic', regex: /_([^_\n]+?)_/ },
  { name: 'strike', regex: /~~(.+?)~~/ },
  { name: 'code', regex: /`([^`\n]+)`/ },
  { name: 'link', regex: /\[([^\]\n]+)\]\((https?:\/\/[^)\n]+)\)/ },
];

function renderInline(
  text: string,
  currentUserId: string,
  allUsers: UserProfile[],
  onMentionClick?: (user: UserProfile) => void,
  keyOffset = 0,
): ReactNode {
  if (!text) return null;

  const sortedUsers = allUsers
    .filter(user => user.full_name || user.username || user.email)
    .sort((a, b) => ((b.full_name || b.username || b.email || '').length) - ((a.full_name || a.username || a.email || '').length));

  const tokens: InlineToken[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    let earliest: { index: number; length: number; token: InlineToken } | null = null;

    for (const { name, regex } of INLINE_PATTERNS) {
      const match = regex.exec(remaining);
      if (match !== null && (earliest === null || match.index < earliest.index)) {
        let token: InlineToken;
        if (name === 'bold') token = { type: 'bold', content: match[1] };
        else if (name === 'italic') token = { type: 'italic', content: match[1] };
        else if (name === 'strike') token = { type: 'strike', content: match[1] };
        else if (name === 'code') token = { type: 'code', content: match[1] };
        else token = { type: 'link', text: match[1], url: match[2] };
        earliest = { index: match.index, length: match[0].length, token };
      }
    }

    const atIdx = remaining.indexOf('@');
    if (atIdx >= 0) {
      const afterAt = remaining.slice(atIdx + 1);
      const matched = sortedUsers.find(user => {
        const name = user.full_name || user.username || user.email || '';
        return name && afterAt.startsWith(name);
      });
      if (matched && (earliest === null || atIdx < earliest.index)) {
        const name = matched.full_name || matched.username || matched.email || '';
        earliest = { index: atIdx, length: 1 + name.length, token: { type: 'mention', user: matched } };
      }
    }

    if (earliest === null) {
      tokens.push({ type: 'text', content: remaining });
      break;
    }
    if (earliest.index > 0) tokens.push({ type: 'text', content: remaining.slice(0, earliest.index) });
    tokens.push(earliest.token);
    remaining = remaining.slice(earliest.index + earliest.length);
  }

  return tokens.map((token, index) => {
    const key = keyOffset + index;
    switch (token.type) {
      case 'bold':
        return <strong key={key} className="font-semibold">{token.content}</strong>;
      case 'italic':
        return <em key={key} className="italic">{token.content}</em>;
      case 'strike':
        return <s key={key} className="line-through opacity-75">{token.content}</s>;
      case 'code':
        return <code key={key} className="bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 px-1.5 py-0.5 rounded text-[0.85em] font-mono">{token.content}</code>;
      case 'link':
        return (
          <a
            key={key}
            href={token.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 dark:text-blue-400 hover:underline break-all"
            onClick={event => event.stopPropagation()}
          >
            {token.text}
          </a>
        );
      case 'mention': {
        const isMe = token.user.user_id === currentUserId;
        const name = token.user.full_name || FALLBACK_NAME;
        return (
          <span
            key={key}
            onClick={onMentionClick ? event => { event.stopPropagation(); onMentionClick(token.user); } : undefined}
            className={`inline-flex items-center gap-0.5 px-1 py-0.5 rounded font-semibold text-xs cursor-pointer hover:opacity-80 transition-opacity ${isMe
              ? 'bg-teal-100 dark:bg-teal-900/50 text-teal-700 dark:text-teal-300'
              : 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'}`}
          >
            @{name}
          </span>
        );
      }
      case 'text':
        return <span key={key}>{token.content}</span>;
    }
  });
}

export function renderMarkdownBody(
  body: string,
  currentUserId: string,
  allUsers: UserProfile[],
  onMentionClick?: (user: UserProfile) => void,
): ReactNode {
  const lines = body.split('\n');
  return (
    <>
      {lines.map((line, lineIndex) => {
        const baseKey = lineIndex * 10000;
        if (line === '') return <div key={lineIndex} className="h-[1em]" />;

        if (line.startsWith('> ')) {
          return (
            <div key={lineIndex} className="border-r-2 border-gray-400 dark:border-gray-500 pr-2 my-0.5 italic text-gray-600 dark:text-gray-400">
              {renderInline(line.slice(2), currentUserId, allUsers, onMentionClick, baseKey)}
            </div>
          );
        }

        if (line.startsWith('• ')) {
          return (
            <div key={lineIndex} className="flex items-start gap-1.5">
              <span className="text-gray-500 dark:text-gray-400 flex-shrink-0 mt-[0.15em] text-xs leading-5">●</span>
              <span className="flex-1 min-w-0">{renderInline(line.slice(2), currentUserId, allUsers, onMentionClick, baseKey)}</span>
            </div>
          );
        }

        const numMatch = line.match(/^(\d+)\. (.*)/);
        if (numMatch) {
          return (
            <div key={lineIndex} className="flex items-start gap-1.5">
              <span className="text-gray-500 dark:text-gray-400 flex-shrink-0 text-xs font-semibold min-w-[1.4rem] mt-[0.15em]">{numMatch[1]}.</span>
              <span className="flex-1 min-w-0">{renderInline(numMatch[2], currentUserId, allUsers, onMentionClick, baseKey)}</span>
            </div>
          );
        }

        return <div key={lineIndex}>{renderInline(line, currentUserId, allUsers, onMentionClick, baseKey)}</div>;
      })}
    </>
  );
}
