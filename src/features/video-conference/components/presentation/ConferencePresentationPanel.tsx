import { useRef } from 'react';
import { FileText, Loader2, Play, RefreshCw, Trash2, Upload, XCircle } from 'lucide-react';
import type { Room } from 'livekit-client';
import { useConferenceClient } from '../../../../components/VideoConference/conferenceClient';
import { useConferencePresentations } from '../../hooks/useConferencePresentations';
import type { ConferenceAuthorization, ConferencePresentationItem } from '../../types/conference.types';
import { ConferencePresentationViewer } from './ConferencePresentationViewer';

interface Props {
  room: Room;
  roomId: string;
  currentUserId: string;
  currentUserName: string;
  authorization: ConferenceAuthorization;
}

function statusLabel(item: ConferencePresentationItem) {
  if (item.status === 'UPLOADING') return 'در حال بارگذاری';
  if (item.status === 'CONVERTING') return 'در حال تبدیل';
  if (item.status === 'FAILED') return 'تبدیل ناموفق';
  if (item.status === 'READY') return 'آماده';
  return item.status;
}

export function ConferencePresentationPanel({
  room,
  roomId,
  currentUserId,
  currentUserName,
  authorization,
}: Props) {
  const client = useConferenceClient();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const presentation = useConferencePresentations({
    client,
    room,
    roomId,
    currentUserId,
    currentUserName,
    authorization,
  });

  if (!presentation.canUse) {
    return <div className="p-6 text-sm text-slate-300">برای مشاهده ارائه باید عضو فعال جلسه باشید.</div>;
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-3 p-3 lg:grid-cols-[280px_minmax(0,1fr)]">
      <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-white/10 bg-slate-950/70">
        <div className="flex items-center justify-between border-b border-white/10 p-3">
          <div>
            <div className="text-sm font-bold">فایل‌های ارائه</div>
            <div className="mt-1 text-[11px] text-slate-400">PDF، تصویر، PowerPoint و اسناد Office</div>
          </div>
          {presentation.canUpload && (
            <>
              <input
                ref={inputRef}
                type="file"
                className="hidden"
                accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.ppt,.pptx,.odp,.doc,.docx,.odt"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.currentTarget.value = '';
                  if (file) void presentation.upload(file);
                }}
              />
              <button
                onClick={() => inputRef.current?.click()}
                disabled={presentation.busy === 'upload'}
                className="rounded-lg bg-sky-600 p-2 text-white disabled:opacity-50"
                aria-label="بارگذاری فایل ارائه"
              >
                {presentation.busy === 'upload'
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Upload className="h-4 w-4" />}
              </button>
            </>
          )}
        </div>

        {presentation.errorMessage && (
          <div className="m-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-2 text-xs text-rose-200">
            {presentation.errorMessage}
          </div>
        )}

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
          {presentation.presentations.length === 0 && (
            <div className="p-6 text-center text-xs text-slate-500">هنوز فایلی برای ارائه ثبت نشده است.</div>
          )}

          {presentation.presentations.map((item) => {
            const selected = presentation.selectedId === item.id;
            const active = presentation.state.isActive
              && presentation.state.presentationId === item.id;

            return (
              <div
                key={item.id}
                className={`rounded-xl border p-2 ${selected
                  ? 'border-sky-500/60 bg-sky-500/10'
                  : 'border-white/10 bg-white/[0.03]'}`}
              >
                <button
                  onClick={() => presentation.selectPresentation(item.id)}
                  className="flex w-full items-start gap-2 text-right"
                >
                  <FileText className="mt-0.5 h-4 w-4 shrink-0 text-sky-300" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-bold">{item.title}</span>
                    <span className="mt-1 block truncate text-[10px] text-slate-400">{item.originalFileName}</span>
                    <span className="mt-1 inline-flex rounded-full bg-white/10 px-2 py-0.5 text-[9px]">
                      {active ? 'در حال ارائه' : statusLabel(item)}
                    </span>
                  </span>
                </button>

                <div className="mt-2 flex flex-wrap gap-1">
                  {presentation.canManage && item.status === 'READY' && !active && (
                    <button
                      onClick={() => void presentation.activate(item.id)}
                      className="flex items-center gap-1 rounded-lg bg-emerald-600 px-2 py-1 text-[10px]"
                    >
                      <Play className="h-3 w-3" /> ارائه
                    </button>
                  )}
                  {presentation.canManage && active && (
                    <button
                      onClick={() => void presentation.deactivate(item.id)}
                      className="flex items-center gap-1 rounded-lg bg-amber-600 px-2 py-1 text-[10px]"
                    >
                      <XCircle className="h-3 w-3" /> توقف
                    </button>
                  )}
                  {item.status === 'FAILED' && item.canDelete && (
                    <button
                      onClick={() => void presentation.retryConversion(item.id)}
                      className="flex items-center gap-1 rounded-lg bg-violet-600 px-2 py-1 text-[10px]"
                    >
                      <RefreshCw className="h-3 w-3" /> تلاش مجدد
                    </button>
                  )}
                  {item.canDelete && (
                    <button
                      onClick={() => void presentation.deletePresentation(item.id)}
                      className="flex items-center gap-1 rounded-lg bg-rose-700 px-2 py-1 text-[10px]"
                    >
                      <Trash2 className="h-3 w-3" /> حذف
                    </button>
                  )}
                </div>

                {item.conversionError && (
                  <div className="mt-2 break-all text-[9px] text-rose-300">{item.conversionError}</div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="min-h-0">
        {!presentation.selected
          ? <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-white/10 text-sm text-slate-500">یک فایل ارائه را انتخاب کنید.</div>
          : presentation.selected.status !== 'READY'
            ? <div className="flex h-full items-center justify-center rounded-xl border border-white/10 text-sm text-slate-400">{statusLabel(presentation.selected)}</div>
            : !presentation.assetUrl
              ? <div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>
              : (
                <ConferencePresentationViewer
                  presentation={presentation.selected}
                  url={presentation.assetUrl}
                  page={presentation.page}
                  canManage={presentation.canManage && presentation.activeSelected}
                  canAnnotate={presentation.canAnnotate && presentation.annotation.canAnnotate}
                  annotationElements={presentation.annotation.elements}
                  lasers={presentation.lasers}
                  busy={Boolean(presentation.busy)}
                  onNavigate={presentation.navigate}
                  onPersistStroke={presentation.upsertAnnotation}
                  onClear={presentation.clearAnnotation}
                  onLaser={presentation.publishLaser}
                />
              )}
      </div>
    </div>
  );
}
