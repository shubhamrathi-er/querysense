import { CheckCheck } from 'lucide-react';

interface Props {
  content: string;
  createdAt?: string;
}

function formatTime(iso?: string) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function UserMessage({ content, createdAt }: Props) {
  return (
    <div className="flex justify-end">
      <div className="max-w-xl rounded-2xl rounded-tr-md bg-gradient-to-br from-[#5B4FF7] to-[#7C6BFF] px-4 py-2.5 text-white shadow-lg shadow-[#5B4FF7]/20">
        <p className="text-sm leading-relaxed">{content}</p>
        <div className="mt-1 flex items-center justify-end gap-1 text-[11px] text-white/70">
          {formatTime(createdAt)}
          {/* <CheckCheck className="h-3 w-3" /> */}
        </div>
      </div>
    </div>
  );
}
