import React, { useState } from 'react';
import { X, Hash, Users, Lock, Globe } from 'lucide-react';
import { ChannelType } from './types';

interface Props {
  type: ChannelType;
  onClose: () => void;
  onCreate: (data: { name: string; description: string; type: ChannelType; is_private: boolean }) => Promise<void>;
}

export function CreateChannelModal({ type, onClose, onCreate }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [loading, setLoading] = useState(false);

  const isChannel = type === 'channel';

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setLoading(true);
    try {
      await onCreate({ name: name.trim(), description: description.trim(), type, is_private: isPrivate });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center">
              {isChannel ? <Hash className="w-4 h-4 text-teal-600" /> : <Users className="w-4 h-4 text-teal-600" />}
            </div>
            <h3 className="text-base font-bold dark:text-white">{isChannel ? 'کانال جدید' : 'گروه جدید'}</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">نام {isChannel ? 'کانال' : 'گروه'}</label>
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              placeholder={`نام ${isChannel ? 'کانال' : 'گروه'}...`}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">توضیحات (اختیاری)</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={2}
              placeholder="توضیحات..."
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500 resize-none"
            />
          </div>

          <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl">
            <button
              onClick={() => setIsPrivate(false)}
              className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${!isPrivate ? 'bg-white dark:bg-gray-600 shadow-sm text-teal-600 dark:text-teal-400 font-medium' : 'text-gray-500 dark:text-gray-400'}`}
            >
              <Globe className="w-4 h-4" />
              عمومی
            </button>
            <button
              onClick={() => setIsPrivate(true)}
              className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${isPrivate ? 'bg-white dark:bg-gray-600 shadow-sm text-teal-600 dark:text-teal-400 font-medium' : 'text-gray-500 dark:text-gray-400'}`}
            >
              <Lock className="w-4 h-4" />
              خصوصی
            </button>
          </div>
        </div>

        <div className="flex gap-3 px-5 pb-5">
          <button
            onClick={handleSubmit}
            disabled={loading || !name.trim()}
            className="flex-1 py-2.5 bg-teal-500 hover:bg-teal-600 text-white text-sm font-semibold rounded-xl disabled:opacity-50 transition-colors"
          >
            {loading ? 'در حال ایجاد...' : `ایجاد ${isChannel ? 'کانال' : 'گروه'}`}
          </button>
          <button onClick={onClose} className="px-5 py-2.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-colors">
            انصراف
          </button>
        </div>
      </div>
    </div>
  );
}
