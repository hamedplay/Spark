import { useState, useEffect, useRef } from 'react';
import { Search, X } from 'lucide-react';

const RECENT_KEY = 'chat_recent_emojis';

const EMOJI_CATEGORIES = [
  {
    id: 'recent',
    label: 'اخیر',
    icon: '🕐',
    emojis: [] as string[],
  },
  {
    id: 'smileys',
    label: 'احساسات',
    icon: '😀',
    emojis: [
      '😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩',
      '😘','😗','😚','😙','🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐',
      '🤨','😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒',
      '🤕','🤢','🤮','🤧','🥵','🥶','🥴','😵','🤯','🤠','🥳','🥸','😎','🤓','🧐','😕',
      '😟','🙁','☹️','😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱',
      '😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿','💀','☠️','💩',
      '🤡','👹','👺','👻','👽','👾','🤖',
    ],
  },
  {
    id: 'people',
    label: 'آدم‌ها',
    icon: '👤',
    emojis: [
      '👋','🤚','🖐️','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆',
      '👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','✍️','💅',
      '🤳','💪','🦾','🦵','🦶','👂','🦻','👃','👀','👁️','👅','🦷','🦴','👤','👥',
      '🧑','👱','👨','🧔','👩','🧓','👴','👵','🧒','👦','👧','👶','🧑‍💼','👨‍💼','👩‍💼',
      '🧑‍🔧','👨‍🔧','👩‍🔧','🧑‍🏫','👨‍🏫','👩‍🏫','🧑‍⚕️','👨‍⚕️','👩‍⚕️','🧑‍🍳','👨‍🍳','👩‍🍳',
      '🧑‍🎨','👨‍🎨','👩‍🎨','🧑‍🚀','👨‍🚀','👩‍🚀','🧑‍✈️','👨‍✈️','👩‍✈️','👮','💂','🕵️',
      '👷','🤴','👸','🧙','🧝','🧛','🧟','🧞','🧜','🧚','👼','🎅','🤶','🦸','🦹',
    ],
  },
  {
    id: 'nature',
    label: 'طبیعت',
    icon: '🌿',
    emojis: [
      '🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈',
      '🙉','🙊','🐔','🐧','🐦','🐤','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🪱',
      '🐛','🦋','🐌','🐞','🐜','🦟','🦗','🦂','🐢','🐍','🦎','🦖','🦕','🐊','🐸','🦈',
      '🐬','🐋','🐳','🦭','🐟','🐠','🐡','🦑','🐙','🦐','🦞','🦀','🌸','🌺','🌻','🌹',
      '🌷','🌱','🌿','🍀','🍁','🍂','🍃','🌾','🌵','🌴','🌳','🌲','🎋','🎍','🍄','🌊',
      '🌈','☀️','🌤️','⛅','🌦️','🌧️','⛈️','🌩️','❄️','🌬️','💨','🌪️','🌫️','🌈','🌙','⭐',
    ],
  },
  {
    id: 'food',
    label: 'غذا',
    icon: '🍕',
    emojis: [
      '🍎','🍊','🍋','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🥑','🍆',
      '🌽','🥕','🧄','🧅','🥔','🍠','🥐','🥖','🫓','🥨','🧀','🍳','🥚','🍞','🥞','🧇',
      '🥓','🥩','🍗','🍖','🌭','🍔','🍟','🍕','🫔','🌮','🌯','🥙','🧆','🥗','🥘','🫕',
      '🍲','🍛','🍜','🍝','🍠','🍱','🍘','🍙','🍚','🍛','🍣','🍤','🦐','🦞','🦀','🍦',
      '🍧','🍨','🍩','🍪','🎂','🍰','🧁','🥧','🍫','🍬','🍭','🍮','🍯','🫖','☕','🧋',
      '🥤','🍹','🍸','🍷','🍺','🍻','🥂','🥃','🫗','🥛','🍼','🫙','🧃','🥤','🧉','🍶',
    ],
  },
  {
    id: 'travel',
    label: 'سفر',
    icon: '✈️',
    emojis: [
      '🚗','🚕','🚙','🚌','🚎','🏎️','🚓','🚑','🚒','🚐','🛻','🚚','🚛','🚜','🏍️','🛵',
      '🛺','🚲','🛴','🛹','🛼','🚏','🛣️','🛤️','⛽','🚨','🚥','🚦','🚧','⚓','🛟','⛵',
      '🚤','🛥️','🛳️','⛴️','🚢','✈️','🛩️','🛫','🛬','🪂','💺','🚁','🚟','🚠','🚡','🛸',
      '🚀','🛰️','🏠','🏡','🏢','🏣','🏤','🏥','🏦','🏧','🏨','🏩','🏪','🏫','🏬','🏭',
      '🗼','🗽','⛪','🕌','🛕','🕍','⛩️','🕋','⛲','⛺','🏕️','🌁','🌃','🏙️','🌄','🌅',
      '🌆','🌇','🌉','🎠','🎡','🎢','🎪','🗺️','🗾','🌐','🗻','🏔️','⛰️','🌋','🏖️','🏝️',
    ],
  },
  {
    id: 'activities',
    label: 'ورزش',
    icon: '⚽',
    emojis: [
      '⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🪀','🏓','🏸','🏒','🥊','🥋',
      '🎽','🛹','🛼','🛷','⛸️','🥌','🎿','⛷️','🏂','🪂','🏋️','🤼','🤸','⛹️','🤺','🏇',
      '🧘','🏄','🚣','🧗','🚵','🚴','🏆','🥇','🥈','🥉','🏅','🎖️','🎗️','🎫','🎟️','🎪',
      '🤹','🎭','🎬','🎨','🖼️','🎠','🎡','🎢','🎮','🕹️','🎲','♟️','🃏','🀄','🎯','🎳',
      '🎰','🎻','🎸','🎹','🥁','🎺','🎷','🪗','🎵','🎶','🎤','🎧','📻','🎙️','🎚️','🎛️',
    ],
  },
  {
    id: 'objects',
    label: 'اشیاء',
    icon: '💡',
    emojis: [
      '💡','🔦','🕯️','🪔','🧯','🛢️','💰','💵','💴','💶','💷','💸','💳','🪙','💹','📈',
      '📉','📊','💼','👜','👝','🎒','🧳','💍','💎','👓','🕶️','🥽','🌂','☂️','🧵','🪡',
      '📱','💻','⌨️','🖥️','🖨️','🖱️','💾','💿','📀','📷','📸','📹','🎥','📞','☎️','📟',
      '📠','📺','📻','🧭','⏱️','⏰','⌚','⏲️','🕰️','⌛','⏳','📡','🔋','🔌','💡','🔧',
      '🔨','⛏️','⚒️','🛠️','🔩','⚙️','🧲','🪜','🧱','⚗️','🔭','🔬','🩺','🩻','🩹','🩸',
      '💊','💉','🩼','🩴','🪛','🔑','🗝️','🔐','🔏','🔓','🔒','🚪','🪞','🪟','🛋️','🪑',
    ],
  },
  {
    id: 'symbols',
    label: 'نمادها',
    icon: '❤️',
    emojis: [
      '❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖',
      '💘','💝','💟','☮️','✝️','☪️','🕉️','✡️','🔯','🕎','☯️','☦️','🛐','⛎','♈','♉',
      '♊','♋','♌','♍','♎','♏','♐','♑','♒','♓','🆔','🈴','🈺','🈹','🈲','🉐',
      '✅','❎','🆗','🆙','🆒','🆕','🆓','🔝','🔛','🔜','🔚','⭕','❌','❓','❗','❕',
      '🔥','💥','🌊','🌀','⭐','🌟','💫','✨','🎆','🎇','🧨','🎉','🎊','🎋','🎍','🎎',
      '🎏','🎐','🧧','🎁','🎀','🎗️','🎟️','🏮','🪔','🧿','🗿','🗺️','🧭','🪬','🪩','🪅',
    ],
  },
];

interface Props {
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

export function EmojiPicker({ onSelect, onClose }: Props) {
  const [activeCategory, setActiveCategory] = useState(1);
  const [search, setSearch] = useState('');
  const [recentEmojis, setRecentEmojis] = useState<string[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(RECENT_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as string[];
        setRecentEmojis(parsed);
        EMOJI_CATEGORIES[0].emojis = parsed;
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const handleSelect = (emoji: string) => {
    // Update recents
    const updated = [emoji, ...recentEmojis.filter(e => e !== emoji)].slice(0, 24);
    setRecentEmojis(updated);
    EMOJI_CATEGORIES[0].emojis = updated;
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(updated)); } catch { /* ignore */ }
    onSelect(emoji);
  };

  const allEmojis = EMOJI_CATEGORIES.slice(1).flatMap(c => c.emojis);
  const searchResults = search ? allEmojis.filter(e => e.includes(search)) : null;

  const displayCategory = EMOJI_CATEGORIES[activeCategory];
  const displayEmojis = searchResults || (activeCategory === 0 ? recentEmojis : displayCategory.emojis);

  return (
    <div
      ref={ref}
      className="w-72 max-w-[calc(100vw-1rem)] bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-700 z-50 overflow-hidden"
      dir="rtl"
    >
      {/* Search */}
      <div className="px-3 pt-3 pb-2">
        <div className="relative">
          <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="جستجوی ایموجی..."
            className="w-full pr-8 pl-3 py-1.5 text-xs bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg outline-hidden focus:ring-2 focus:ring-teal-500 dark:text-white dark:placeholder-gray-400"
          />
        </div>
      </div>

      {/* Category tabs */}
      {!search && (
        <div className="flex items-center px-2 pb-1 gap-0 overflow-x-auto scrollbar-hide border-b border-gray-100 dark:border-gray-700">
          {EMOJI_CATEGORIES.map((cat, i) => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(i)}
              title={cat.label}
              className={`shrink-0 w-9 h-8 flex items-center justify-center text-base rounded-lg transition-colors ${
                activeCategory === i
                  ? 'bg-teal-50 dark:bg-teal-900/30 text-teal-600'
                  : 'text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              {cat.icon}
            </button>
          ))}
        </div>
      )}

      {/* Category label */}
      {!search && (
        <div className="px-3 pt-2 pb-1">
          <span className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">
            {displayCategory.label}
          </span>
        </div>
      )}

      {/* Emoji grid */}
      <div className="h-48 overflow-y-auto px-2 pb-2">
        {displayEmojis.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-gray-400">
            {activeCategory === 0 ? 'هنوز ایموجی‌ای استفاده نشده' : 'نتیجه‌ای یافت نشد'}
          </div>
        ) : (
          <div className="grid grid-cols-7 gap-0.5">
            {displayEmojis.map((emoji, i) => (
              <button
                key={i}
                onClick={() => handleSelect(emoji)}
                className="w-8 h-8 flex items-center justify-center text-xl hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors hover:scale-110 active:scale-95"
                style={{ fontFamily: '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif' }}
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 px-3 py-2 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
        <span className="text-xs text-gray-400 flex-1">{search ? `${displayEmojis.length} نتیجه` : displayCategory.label}</span>
        <button onClick={onClose} className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors">
          <X className="w-3.5 h-3.5 text-gray-400" />
        </button>
      </div>
    </div>
  );
}
