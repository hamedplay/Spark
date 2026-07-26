import { Plus, Save, Mic } from 'lucide-react';

export function CreateNoteForm({
  newNote,
  setNewNote,
  onSubmit,
  onToggleForm,
  isFormRecording,
  onToggleRecording,
}: {
  newNote: { title: string; content: string };
  setNewNote: React.Dispatch<React.SetStateAction<{ title: string; content: string }>>;
  onSubmit: (e: React.FormEvent) => void;
  onToggleForm: () => void;
  isFormRecording: boolean;
  onToggleRecording: () => void;
}) {
  return (
    <form onSubmit={onSubmit} className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 mb-6">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            عنوان
          </label>
          <input
            type="text"
            value={newNote.title}
            onChange={(e) => setNewNote({ ...newNote, title: e.target.value })}
            className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
            required
          />
        </div>
        <div>
          <div className="flex justify-between items-center mb-1">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              متن یادداشت
            </label>
            <button
              type="button"
              onClick={onToggleRecording}
              className={`p-2 rounded-full ${
                isFormRecording ? 'bg-red-500 animate-pulse' : 'bg-blue-500 hover:bg-blue-600'
              } text-white transition-colors`}
              title={isFormRecording ? 'توقف ضبط' : 'شروع ضبط صدا'}
            >
              <Mic className="w-5 h-5" />
            </button>
          </div>
          <textarea
            value={newNote.content}
            onChange={(e) => setNewNote({ ...newNote, content: e.target.value })}
            rows={4}
            className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
            required
          ></textarea>
        </div>
        <button
          type="submit"
          className="w-full flex items-center justify-center gap-2 bg-blue-500 text-white py-2 rounded-lg hover:bg-blue-600"
        >
          <Save className="w-5 h-5" />
          ذخیره یادداشت
        </button>
      </div>
    </form>
  );
}

export function CreateNoteButton({ onClick, showCreateForm }: { onClick: () => void; showCreateForm: boolean }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 transition-colors"
    >
      <Plus className="w-5 h-5" />
      یادداشت جدید
    </button>
  );
}
